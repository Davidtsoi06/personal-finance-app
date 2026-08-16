import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import {
  recordNetWorthInDb, getNetWorthHistoryInDb,
} from '../../src/main/database/services/net-worth-core';
import type { AssetTotalsItem } from '../../src/shared/utils/asset-totals';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      // v13 的 migrate 依赖 electron 环境（crypto-util），Node 测试跳过
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

/** 与演示数据对应的总览形状（CNY）：总资产 713,350，含内嵌券商 225,400 */
const demoItems: AssetTotalsItem[] = [
  { asset_type: 'e_wallet', is_investment: false, market_value_cny: 5000 },
  { asset_type: 'e_wallet', is_investment: false, market_value_cny: 3000 },
  { asset_type: 'cash', is_investment: false, market_value_cny: 2000 },
  { asset_type: 'insurance', is_investment: false, market_value_cny: 83850 },
  { asset_type: 'bank', is_investment: false, market_value_cny: 367400, children: [
    { asset_type: 'bank', is_investment: false, market_value_cny: 92000 },
    { asset_type: 'investment', is_investment: true, market_value_cny: 225400 },
    { asset_type: 'bank', is_investment: false, market_value_cny: 50000 },
  ] },
  { asset_type: 'bank', is_investment: false, market_value_cny: 50000, children: [
    { asset_type: 'bank', is_investment: false, market_value_cny: 50000 },
  ] },
  { asset_type: 'investment', is_investment: true, market_value_cny: 145000 },
  { asset_type: 'broker_cash', is_investment: false, market_value_cny: 23700, children: [
    { asset_type: 'broker_cash', is_investment: false, market_value_cny: 9200 },
    { asset_type: 'broker_cash', is_investment: false, market_value_cny: 14500 },
  ] },
  { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 33400, children: [
    { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 18400 },
    { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 15000 },
  ] },
];

/** 相对今天偏移 offset 天的日期（与 recordNetWorthInDb 同日历规则：toISOString） */
function day(offset: number): string {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

describe("net-worth-core", () => {
  it("recordNetWorthInDb：net_worth = 总资产 713,350；total_cash 含券商流动金", () => {
    const db = freshDb();
    recordNetWorthInDb(db, demoItems);
    const row = db.prepare("SELECT * FROM net_worth_history WHERE date = ?").get(day(0)) as any;
    expect(row).toBeTruthy();
    expect(row.net_worth).toBeCloseTo(713350, 2);
    expect(row.total_investments).toBeCloseTo(403800, 2);
    expect(row.total_cash).toBeCloseTo(285850 + 23700, 2);
  });

  it("同日重复记录 → upsert 不产生重复行，数值被覆盖", () => {
    const db = freshDb();
    recordNetWorthInDb(db, demoItems);
    recordNetWorthInDb(db, [{ asset_type: "cash", is_investment: false, market_value_cny: 123 }]);
    const rows = db.prepare("SELECT * FROM net_worth_history WHERE date = ?").all(day(0));
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).net_worth).toBeCloseTo(123, 2);
  });

  it("回归 v1.6.1：getNetWorthHistoryInDb 返回最近 N 天（而非最早 N 天），升序排列", () => {
    const db = freshDb();
    const ins = db.prepare(
      "INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES (?, 1, 2, 3)"
    );
    for (let i = 40; i >= 1; i--) ins.run(day(i));
    recordNetWorthInDb(db, demoItems);

    const hist = getNetWorthHistoryInDb(db, 30);
    expect(hist).toHaveLength(30);
    expect(hist[0].date).toBe(day(29));
    expect(hist[hist.length - 1].date).toBe(day(0));
    expect(hist[hist.length - 1].net_worth).toBeCloseTo(713350, 2);
    // 升序：日期逐条递增
    for (let i = 1; i < hist.length; i++) {
      expect(hist[i].date > hist[i - 1].date).toBe(true);
    }
  });

  it("历史不足 N 天 → 返回全部可用记录（升序）", () => {
    const db = freshDb();
    const ins = db.prepare(
      "INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES (?, 1, 2, 3)"
    );
    ins.run(day(2));
    ins.run(day(1));
    const hist = getNetWorthHistoryInDb(db, 30);
    expect(hist).toHaveLength(2);
    expect(hist[0].date).toBe(day(2));
    expect(hist[1].date).toBe(day(1));
  });
});