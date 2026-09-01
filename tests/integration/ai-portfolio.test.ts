import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { setPortfolioFolder, exportPortfolioSnapshot } from '../../src/main/services/ai-portfolio-service';
import { createInvestmentAccount } from '../../src/main/database/services/investment-account-service';

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

describe('aiPortfolio 导出快照结构（v1.10.15）', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = freshDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-portfolio-'));
    setPortfolioFolder(tmpDir);
    // 造数据：券商账户 + 持仓 + 交易 + 净值
    const inv = createInvestmentAccount({ name: '富途证券', broker: '富途', currency: 'USD', cash_balance: 5000 });
    db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id) VALUES ('苹果','AAPL','stock','us_stock','USD',10,150,180,1800,1500,300,20,?)").run(inv.id);
    const assetId = db.prepare("SELECT id FROM assets WHERE code = 'AAPL'").get() as any;
    db.prepare("INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes) VALUES (?, 'buy', 10, 150, 1, 1501, 'USD', '2026-08-28', '买入')").run(assetId.id);
    db.prepare("INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES ('2026-08-20', 10000, 20000, 30000)").run();
    db.prepare("INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES ('2026-08-21', 11000, 21000, 32000)").run();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    db.close();
  });

  it('导出包含 accounts / transactions / netWorth / netWorthHistory，camelCase 字段，version 动态读取', () => {
    exportPortfolioSnapshot(true);
    const file = path.join(tmpDir, 'portfolio_snapshot.json');
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // 根节点
    expect(data.app).toBe('personal-finance');
    const pkg = require('../../package.json');
    expect(data.version).toBe(pkg.version); // 动态读取，非硬编码
    expect(data.count).toBe(1);
    // holdings 向后兼容（旧字段不变）
    expect(data.holdings).toHaveLength(1);
    expect(data.holdings[0].code).toBe('AAPL');
    expect(data.holdings[0].costPrice).toBe(150);
    expect(data.holdings[0].broker).toBe('富途证券'); // 兼容旧字段：取券商账户名（原逻辑）
    // accounts（camelCase）
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].name).toBe('富途证券');
    expect(data.accounts[0].broker).toBe('富途');
    expect(data.accounts[0].currency).toBe('USD');
    expect(data.accounts[0].cashBalance).toBeCloseTo(5000, 2);
    // transactions（camelCase）
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0].assetCode).toBe('AAPL');
    expect(data.transactions[0].assetName).toBe('苹果');
    expect(data.transactions[0].type).toBe('buy');
    expect(data.transactions[0].totalAmount).toBeCloseTo(1501, 2);
    expect(data.transactions[0].date).toBe('2026-08-28');
    // netWorth：最近一条
    expect(data.netWorth).toBeTruthy();
    expect(data.netWorth.date).toBe('2026-08-21');
    expect(data.netWorth.totalCash).toBe(11000);
    expect(data.netWorth.totalInvestments).toBe(21000);
    expect(data.netWorth.netWorth).toBe(32000);
    // netWorthHistory：升序
    expect(data.netWorthHistory).toHaveLength(2);
    expect(data.netWorthHistory[0].date).toBe('2026-08-20');
    expect(data.netWorthHistory[1].date).toBe('2026-08-21');
    expect(data.netWorthHistory[1].totalCash).toBe(11000);
  });
});