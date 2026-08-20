import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { getAccountHoldings, getAccountSummary } from '../../src/main/database/services/investment-account-service';

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
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  setDatabaseForTest(db);
  return db;
}

function seedAccount(db: Database.Database): number {
  const r = db.prepare("INSERT INTO investment_accounts (name, currency, cash_balance) VALUES ('券商A', 'HKD', 0)").run();
  return Number(r.lastInsertRowid);
}

function seedAsset(db: Database.Database, accId: number, name: string, code: string, quantity: number): number {
  const r = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, investment_account_id)
    VALUES (?, ?, 'stock', 'hk_stock', 'HKD', ?, 10, 11, ?)
  `).run(name, code, quantity, accId);
  return Number(r.lastInsertRowid);
}

describe('券商持仓明细只显示现有持仓（v1.10.2）', () => {
  it('getAccountHoldings 过滤 quantity=0 的股票', () => {
    const db = freshDb();
    const acc = seedAccount(db);
    seedAsset(db, acc, '已清仓股', '00001', 0);
    seedAsset(db, acc, '持有股', '00002', 100);
    seedAsset(db, acc, '另一只持有', '00003', 5);

    const holdings = getAccountHoldings(acc);
    expect(holdings).toHaveLength(2);
    expect(holdings.some((h: any) => h.quantity === 0)).toBe(false);
    expect(holdings.map((h: any) => h.code)).toEqual(expect.arrayContaining(['00002', '00003']));
    db.close();
  });

  it('getAccountSummary 的持仓计数只计现有持仓（0 持仓不计入）', () => {
    const db = freshDb();
    const acc = seedAccount(db);
    seedAsset(db, acc, '已清仓股', '00001', 0);
    seedAsset(db, acc, '持有股', '00002', 100);

    const summary = getAccountSummary(acc);
    expect(summary.assetCount).toBe(1);
    db.close();
  });

  it('全部清仓时持仓明细为空', () => {
    const db = freshDb();
    const acc = seedAccount(db);
    seedAsset(db, acc, '已清仓股', '00001', 0);
    expect(getAccountHoldings(acc)).toHaveLength(0);
    db.close();
  });
});
