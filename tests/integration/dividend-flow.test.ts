import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { registerAssetIpcHandlers } from '../../src/main/ipc/asset-ipc';
import { registerSettingsIpcHandlers } from '../../src/main/ipc/settings-ipc';
import { registerReportIpcHandlers } from '../../src/main/ipc/report-ipc';
import { createInvestmentAccount } from '../../src/main/database/services/investment-account-service';
import { createAccount } from '../../src/main/database/services/account-service';
import { parseRows } from '../../src/main/services/statement-parser';
import { initAuthService } from '../../src/main/services/auth-service';

const mockHandlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: any[]) => any) => { mockHandlers.set(ch, fn); } },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
  BrowserWindow: class { static getAllWindows = () => []; static fromWebContents = () => null },
  app: { getPath: () => '', on: () => {}, quit: () => {}, getVersion: () => '1.10.21', getAppPath: () => process.cwd() },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1280, height: 720 } }) },
  shell: { openPath: async () => '' },
}));

function freshDb(): Database.Database {
  const db = new Database(':memory:');
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

describe('股息登记全链路（v1.10.21）', () => {
  let db: Database.Database;
  let recordDividend: (data: any) => any;
  let updateDividend: (id: number, data: any) => any;
  let deleteDividend: (id: number) => any;
  let dividendIncome: (year: number) => any;
  let tradeRecord: (data: any) => any;

  beforeEach(() => {
    db = freshDb();
    initAuthService();
    mockHandlers.clear();
    registerAssetIpcHandlers();
    registerSettingsIpcHandlers();
    registerReportIpcHandlers();
    recordDividend = mockHandlers.get('investmentAccount:recordDividend')!;
    updateDividend = mockHandlers.get('investmentAccount:updateDividend')!;
    deleteDividend = mockHandlers.get('investmentAccount:deleteDividend')!;
    dividendIncome = mockHandlers.get('report:dividendIncome')!;
    tradeRecord = mockHandlers.get('trade:record')!;
    expect(recordDividend && updateDividend && deleteDividend && dividendIncome).toBeTruthy();
  });

  it('未关联银行的券商：写交易 + 券商流水 + 记账，持仓成本不变', async () => {
    const inv = createInvestmentAccount({ name: '券商A', currency: 'HKD', cash_balance: 10000 });
    await tradeRecord({}, { investmentAccountId: inv.id, type: 'buy', code: '00700', name: '腾讯控股', quantity: 10, price: 300, currency: 'HKD', date: '2026-06-01' });
    const before = db.prepare("SELECT quantity, cost_price FROM assets WHERE code = '00700'").get() as any;

    const res = await recordDividend({}, {
      investmentAccountId: inv.id, code: '00700', name: '腾讯控股', currency: 'HKD',
      date: '2026-06-20', grossAmount: 500, taxAmount: 50, writeLedger: true,
    });
    expect(res.success).toBe(true);
    expect(res.net).toBe(450);

    const tx = db.prepare("SELECT * FROM transactions WHERE type = 'dividend'").get() as any;
    expect(tx.total_amount).toBe(450);
    expect(tx.fee).toBe(50);
    expect(tx.quantity).toBe(0);
    expect(tx.notes).toContain('税前 500.00');

    // 现金进券商流动金
    const flow = db.prepare("SELECT * FROM investment_cash_flows WHERE type = 'dividend'").get() as any;
    expect(flow.amount).toBe(450);
    expect(flow.transaction_id).toBe(tx.id);
    const acc = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    // 10000 − 买入 3000 + 股息 450
    expect(acc.cash_balance).toBe(7450);

    // 记账「股息收入」（投资收入分类，不联动账户余额）
    const ledger = db.prepare("SELECT l.*, c.name as cat FROM ledgers l LEFT JOIN categories c ON l.category_id = c.id WHERE l.source_type = 'dividend'").get() as any;
    expect(ledger.type).toBe('income');
    expect(ledger.amount).toBe(450);
    expect(ledger.cat).toBe('投资收入');
    expect(ledger.account_id).toBeNull();
    expect(ledger.description).toContain('股息收入 00700');

    // 持仓数量/成本价不变
    const after = db.prepare("SELECT quantity, cost_price FROM assets WHERE code = '00700'").get() as any;
    expect(after.quantity).toBe(before.quantity);
    expect(after.cost_price).toBe(before.cost_price);
  });

  it('关联银行的券商：股息直达银行余额 + 生成银行存取记录（不重复记券商流水）', async () => {
    const bank = createAccount({ name: '汇丰银行', type: 'bank_card', currency: 'HKD', balance: 0 });
    const inv = createInvestmentAccount({ name: '银行内嵌券商', currency: 'HKD', cash_balance: 0, funding_account_id: bank.id });
    await tradeRecord({}, { investmentAccountId: inv.id, type: 'buy', code: '00005', name: '汇丰控股', quantity: 100, price: 60, currency: 'HKD', date: '2026-06-01' });
    const balBefore = (db.prepare('SELECT balance FROM account_balances WHERE account_id = ? AND currency = ?').get(bank.id, 'HKD') as any).balance;

    const res = await recordDividend({}, {
      investmentAccountId: inv.id, code: '00005', name: '汇丰控股', currency: 'HKD',
      date: '2026-06-20', grossAmount: 1000, taxAmount: 0,
    });
    expect(res.net).toBe(1000);

    const bankRows = db.prepare("SELECT * FROM account_transactions WHERE statement_hash = ?").all('broker:' + res.transactionId) as any[];
    expect(bankRows).toHaveLength(1);
    expect(bankRows[0].type).toBe('deposit');
    expect(bankRows[0].amount).toBe(1000);
    expect(bankRows[0].notes).toContain('股息');
    const bal = db.prepare('SELECT balance FROM account_balances WHERE account_id = ? AND currency = ?').get(bank.id, 'HKD') as any;
    // 银行余额正好增加股息实收（买入的扣款已在此之前发生）
    expect(bal.balance - balBefore).toBe(1000);
    expect(db.prepare("SELECT COUNT(*) as c FROM investment_cash_flows WHERE type = 'dividend'").get()).toEqual({ c: 0 });
  });

  it('修改股息：金额/记账/现金同步更新', async () => {
    const inv = createInvestmentAccount({ name: '券商B', currency: 'CNY', cash_balance: 0 });
    const rec = await recordDividend({}, { investmentAccountId: inv.id, code: '600519', name: '贵州茅台', currency: 'CNY', date: '2026-06-20', grossAmount: 500, taxAmount: 100 });
    expect(rec.net).toBe(400);

    const upd = await updateDividend({}, rec.transactionId, { grossAmount: 300, taxAmount: 0 });
    expect(upd.net).toBe(300);
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(rec.transactionId) as any;
    expect(tx.total_amount).toBe(300);
    expect(tx.fee).toBe(0);
    const flow = db.prepare("SELECT * FROM investment_cash_flows WHERE type = 'dividend'").get() as any;
    expect(flow.amount).toBe(300);
    const ledger = db.prepare("SELECT * FROM ledgers WHERE source_type = 'dividend'").get() as any;
    expect(ledger.amount).toBe(300);
    const acc = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(acc.cash_balance).toBe(300);
  });

  it('删除股息：交易/流水/记账全部清理，占位持仓一并删除', async () => {
    const inv = createInvestmentAccount({ name: '券商C', currency: 'USD', cash_balance: 1000 });
    const rec = await recordDividend({}, { investmentAccountId: inv.id, code: 'AAPL', name: '苹果', currency: 'USD', date: '2026-06-20', grossAmount: 50 });
    await deleteDividend({}, rec.transactionId);
    expect(db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'dividend'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM investment_cash_flows WHERE type = 'dividend'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM ledgers WHERE source_type = 'dividend'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM assets WHERE code = 'AAPL'").get()).toEqual({ c: 0 });
    const acc = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(acc.cash_balance).toBe(1000);
  });

  it('报表：股息收入按「代码+币种」跨账户合并（税前/税/实收/笔数）', async () => {
    const a = createInvestmentAccount({ name: '券商A', currency: 'HKD', cash_balance: 0 });
    const b = createInvestmentAccount({ name: '券商B', currency: 'HKD', cash_balance: 0 });
    await recordDividend({}, { investmentAccountId: a.id, code: '00700', name: '腾讯控股', currency: 'HKD', date: '2026-06-20', grossAmount: 500, taxAmount: 50 });
    await recordDividend({}, { investmentAccountId: b.id, code: '00700', name: '腾讯控股', currency: 'HKD', date: '2026-07-20', grossAmount: 1000, taxAmount: 0 });

    const r = await dividendIncome({}, 2026);
    expect(r.count).toBe(2);
    expect(r.net).toBe(1450);
    expect(r.tax).toBe(50);
    expect(r.gross).toBe(1500);
    expect(r.byAsset).toHaveLength(1);
    expect(r.byAsset[0].accountCount).toBe(2);
  });
});

describe('日结单股息识别与导入（v1.10.21）', () => {
  let db: Database.Database;
  let importParsed: (trades: any[], accountId: number) => any;

  beforeEach(() => {
    db = freshDb();
    initAuthService();
    mockHandlers.clear();
    registerAssetIpcHandlers();
    importParsed = mockHandlers.get('trade:importParsed')!;
  });

  it('解析：股息行（无数量/价格）识别为 dividend，实收取发生金额', () => {
    const rows: string[][] = [
      ['日期', '代码', '名称', '业务名称', '数量', '价格', '发生金额', '币种'],
      ['2026/6/20', '00700', '腾讯控股', '股息', '', '', '450.00', 'HKD'],
    ];
    const r = parseRows(rows);
    expect(r.success).toBe(true);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].type).toBe('dividend');
    expect(r.trades[0].net_amount).toBe(450);
  });

  it('导入：股息行进股息流程（交易+流水+记账）', async () => {
    const inv = createInvestmentAccount({ name: '券商D', currency: 'HKD', cash_balance: 0 });
    const res = await importParsed({}, [
      { date: '2026-06-20', code: '00700', name: '腾讯控股', type: 'dividend', quantity: 0, price: 0, fee: 0, currency: 'HKD', net_amount: 450 },
    ], inv.id);
    expect(res.imported).toBe(1);
    expect(db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'dividend'").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) as c FROM investment_cash_flows WHERE type = 'dividend'").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) as c FROM ledgers WHERE source_type = 'dividend'").get()).toEqual({ c: 1 });
    const acc = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(inv.id) as any;
    expect(acc.cash_balance).toBe(450);
  });

  it('未识别的公司行动行不再写 type=other（回归：此前抛 CHECK 约束错误）', async () => {
    const inv = createInvestmentAccount({ name: '券商E', currency: 'HKD', cash_balance: 0 });
    const res = await importParsed({}, [
      { date: '2026-06-20', code: '00700', name: '腾讯控股', type: 'other', quantity: 0, price: 0, fee: 0, currency: 'HKD' },
    ], inv.id);
    expect(res.imported).toBe(0);
    expect(res.errors.join('')).toContain('未识别的公司行动');
    expect(res.errors.join('')).not.toContain('CHECK');
  });
});
