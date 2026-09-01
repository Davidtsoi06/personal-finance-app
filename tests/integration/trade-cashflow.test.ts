import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { registerAssetIpcHandlers } from '../../src/main/ipc/asset-ipc';
import { createInvestmentAccount } from '../../src/main/database/services/investment-account-service';
import { initAuthService } from '../../src/main/services/auth-service';
import { adjustCashBalance } from '../../src/main/database/services/investment-cash-flow-service';

// mock electron：捕获 ipcMain.handle 注册的 handler，供测试直接调用
const mockHandlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: any[]) => any) => { mockHandlers.set(ch, fn); } },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  BrowserWindow: class { static getAllWindows = () => [] },
  app: { getPath: () => '', on: () => {}, quit: () => {}, getVersion: () => '1.10.11' },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1280, height: 720 } }) },
}));

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  setDatabaseForTest(db);
  return db;
}

describe('trade:record 券商现金流（v1.10.11 修复固化）', () => {
  let db: Database.Database;
  let record: (data: any) => any;

  beforeEach(() => {
    db = freshDb();
    // 未启用启动密码 → 视为已解锁（业务 IPC 门禁）
    initAuthService();
    mockHandlers.clear();
    // 注册全部 IPC handler（含 trade:record）
    registerAssetIpcHandlers();
    record = mockHandlers.get('trade:record')!;
    expect(record).toBeTruthy();
  });

  it('首次买入美股（新资产）：现金流扣款 + 券商现金余额减少', async () => {
    const inv = createInvestmentAccount({ name: '美股券商', currency: 'USD', cash_balance: 10000 });
    const res = await record({}, {
      investmentAccountId: inv.id, type: 'buy', code: 'AAPL', name: '苹果',
      quantity: 10, price: 200, fee: 1, currency: 'USD', date: '2026-08-29',
    });
    expect(res.success).toBe(true);
    const flows = db.prepare('SELECT * FROM investment_cash_flows WHERE investment_account_id = ? ORDER BY id ASC').all(inv.id) as any[];
    expect(flows).toHaveLength(2);
    expect(flows[0].type).toBe('adjust'); // 期初余额流水（v1.10.12）
    expect(flows[0].amount).toBeCloseTo(10000, 2);
    expect(flows[1].amount).toBeCloseTo(-2001, 2); // 10×200 + 1 手续费
    const account = db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(account.cash_balance).toBeCloseTo(7999, 2); // 10000 - 2001
  });

  it('继续买入同一只（已有资产）：继续扣款', async () => {
    const inv = createInvestmentAccount({ name: '美股券商2', currency: 'USD', cash_balance: 10000 });
    await record({}, { investmentAccountId: inv.id, type: 'buy', code: 'AAPL', name: '苹果', quantity: 10, price: 200, fee: 1, currency: 'USD', date: '2026-08-29' });
    const res2 = await record({}, { investmentAccountId: inv.id, type: 'buy', code: 'AAPL', name: '苹果', quantity: 5, price: 210, fee: 0, currency: 'USD', date: '2026-08-30' });
    expect(res2.success).toBe(true);
    const account = db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(account.cash_balance).toBeCloseTo(10000 - 2001 - 1050, 2);
  });

  it('卖出回笼现金', async () => {
    const inv = createInvestmentAccount({ name: '美股券商3', currency: 'USD', cash_balance: 10000 });
    await record({}, { investmentAccountId: inv.id, type: 'buy', code: 'AAPL', name: '苹果', quantity: 10, price: 200, fee: 0, currency: 'USD', date: '2026-08-29' });
    const res = await record({}, { investmentAccountId: inv.id, type: 'sell', code: 'AAPL', name: '苹果', quantity: 4, price: 220, fee: 2, currency: 'USD', date: '2026-08-30' });
    expect(res.success).toBe(true);
    const account = db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(account.cash_balance).toBeCloseTo(10000 - 2000 + (4 * 220 - 2), 2); // 买入-2000 卖出+878
  });
});
describe('adjustCashBalance 币种（v1.10.13）', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('校正流水使用账户币种（USD 而非 CNY）', () => {
    const inv = createInvestmentAccount({ name: '美股券商币种', currency: 'USD', cash_balance: 12500 });
    const target = 5000;
    const balance = adjustCashBalance(inv.id, target, '测试校正');
    expect(balance).toBeCloseTo(5000, 2);
    const flow = db.prepare("SELECT * FROM investment_cash_flows WHERE investment_account_id = ? AND type = 'adjust' ORDER BY id DESC").get(inv.id) as any;
    expect(flow).toBeTruthy();
    expect(flow.currency).toBe('USD'); // 修复前默认 CNY
    expect(flow.amount).toBeCloseTo(-7500, 2); // 12500 → 5000
  });
});