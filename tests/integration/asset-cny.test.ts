import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { getAssetCnyTotalsInDb } from '../../src/main/database/services/asset-cny-core';

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
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

describe('asset-cny-core：跨币种市值/盈亏换算聚合', () => {
  it('CNY 账户 + HKD 持仓按汇率换算后聚合', () => {
    const db = freshDb();
    // 迁移不含种子数据：手动插入汇率（与 seedDefaults 一致）
    const insCur = db.prepare(
      'INSERT INTO currencies (code, name, symbol, rate_to_base, is_base) VALUES (?, ?, ?, ?, ?)'
    );
    insCur.run('CNY', '人民币', '¥', 1.0, 1);
    insCur.run('HKD', '港币', 'HK$', 0.92, 0);
    insCur.run('USD', '美元', '$', 7.25, 0);

    const accId = Number(db.prepare(
      "INSERT INTO investment_accounts (name, broker, currency, cash_balance) VALUES ('混合账户', '测试', 'CNY', 1000)"
    ).run().lastInsertRowid);
    const mkAsset = (code: string, cur: string, mv: number, pl: number) =>
      db.prepare(
        "INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id)" +
        " VALUES (?, ?, 'stock', 'other', ?, 1, 0, 0, ?, 0, ?, 0, ?)"
      ).run(code, code, cur, mv, pl, accId);
    mkAsset('600519', 'CNY', 1000, 100);      // CNY 持仓：1:1
    mkAsset('00700', 'HKD', 500, -50);        // HKD 持仓：×0.92
    mkAsset('AAPL', 'USD', 200, 20);          // USD 持仓：×7.25

    const r = getAssetCnyTotalsInDb(db, 'WHERE a.investment_account_id = ?', [accId]);
    expect(r.marketValueCny).toBeCloseTo(1000 + 500 * 0.92 + 200 * 7.25, 2);
    expect(r.profitLossCny).toBeCloseTo(100 + -50 * 0.92 + 20 * 7.25, 2);
    expect(r.assetCount).toBe(3);
  });

  it('无币种记录的持仓按 1:1 兜底（不丢数据）', () => {
    const db = freshDb();
    const accId = Number(db.prepare(
      "INSERT INTO investment_accounts (name, currency, cash_balance) VALUES ('无汇率', 'XXX', 0)"
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id)" +
      " VALUES ('未知币种', 'UNKNOWN', 'stock', 'other', 'XXX', 1, 0, 0, 888, 0, 0, 0, ?)"
    ).run(accId);
    const r = getAssetCnyTotalsInDb(db, 'WHERE a.investment_account_id = ?', [accId]);
    expect(r.marketValueCny).toBe(888);
  });
});
