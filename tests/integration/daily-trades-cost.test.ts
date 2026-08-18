import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { getDailyTrades } from '../../src/main/services/report-export-service';

/** 纯 DB 环境（与 fixed-deposit.test.ts 同构） */
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

/** 建一个股票资产（cost_price 可指定，模拟“缺成本价=0”或“有成本价”） */
function seedAsset(db: Database.Database, name: string, code: string, costPrice = 0): number {
  const r = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, cost_price, current_price)
    VALUES (?, ?, 'stock', 'a_stock', 'CNY', ?, ?)
  `).run(name, code, costPrice, costPrice || 10);
  return Number(r.lastInsertRowid);
}

function seedTrade(db: Database.Database, assetId: number, type: 'buy' | 'sell', date: string, quantity: number, price: number, totalAmount: number) {
  db.prepare(`
    INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date)
    VALUES (?, ?, ?, ?, 0, ?, 'CNY', ?)
  `).run(assetId, type, quantity, price, totalAmount, date);
}

describe('每日交易报表成本价（v1.8.4）', () => {
  it('买入行成本价 = 本笔含费均价（总金额÷数量）', () => {
    const db = freshDb();
    const a = seedAsset(db, '含费买入', '000001');
    seedTrade(db, a, 'buy', '2026-08-02', 100, 12, 1200);
    const { rows, summary } = getDailyTrades('2026-08-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('buy');
    expect(rows[0].cost_price).toBeCloseTo(12, 4);
    expect(rows[0].realized_pnl).toBeNull();
    expect(summary.unknownPnlCount).toBe(0);
    db.close();
  });

  it('卖出成本基础 = 当日(含)前买入加权平均（后续买卖不稀释历史盈亏）', () => {
    const db = freshDb();
    const a = seedAsset(db, '加权平均', '000002');
    seedTrade(db, a, 'buy', '2026-08-01', 100, 10, 1000);
    seedTrade(db, a, 'buy', '2026-08-02', 100, 12, 1200);
    seedTrade(db, a, 'sell', '2026-08-03', 50, 13, 650);
    const { rows, summary } = getDailyTrades('2026-08-03');
    const sell = rows.find((r) => r.type === 'sell');
    expect(sell.cost_price).toBeCloseTo(11, 4);
    expect(sell.realized_pnl).toBeCloseTo(100, 2); // 650 − 11×50
    expect(summary.realizedPnl).toBeCloseTo(100, 2);
    db.close();
  });

  it('卖出无买入且资产无成本价 → 盈亏显示 null、计入 unknownPnlCount（不污染汇总）', () => {
    const db = freshDb();
    const b = seedAsset(db, '无成本价', '000003', 0);
    seedTrade(db, b, 'sell', '2026-08-03', 10, 5, 50);
    const { rows, summary } = getDailyTrades('2026-08-03');
    const sell = rows[0];
    expect(sell.cost_price).toBeNull();
    expect(sell.realized_pnl).toBeNull();
    expect(summary.unknownPnlCount).toBe(1);
    expect(summary.realizedPnl).toBe(0);
    db.close();
  });

  it('卖出无买入但资产有成本价 → 回退资产表成本价', () => {
    const db = freshDb();
    const c = seedAsset(db, '有成本价', '000004', 8);
    seedTrade(db, c, 'sell', '2026-08-03', 10, 10, 100);
    const { rows, summary } = getDailyTrades('2026-08-03');
    const sell = rows[0];
    expect(sell.cost_price).toBeCloseTo(8, 4);
    expect(sell.realized_pnl).toBeCloseTo(20, 2); // 100 − 8×10
    expect(summary.realizedPnl).toBeCloseTo(20, 2);
    db.close();
  });

  it('同日先卖后买：晚于卖出的买入不计入该笔成本基础（按 id 顺序推进）', () => {
    const db = freshDb();
    const d = seedAsset(db, '同日顺序', '000005', 0);
    seedTrade(db, d, 'buy', '2026-08-01', 10, 10, 100); // 早前买入 成本10
    const s = db.prepare(`
      INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date)
      VALUES (?, 'sell', 10, 15, 0, 150, 'CNY', '2026-08-03')
    `).run(d);
    const sellId = Number(s.lastInsertRowid);
    // 同日更晚的买入（id 更大），若误计入会使均价=(100+300)/20=20
    seedTrade(db, d, 'buy', '2026-08-03', 10, 30, 300);
    const { rows } = getDailyTrades('2026-08-03');
    const sell = rows.find((r) => r.id === sellId);
    expect(sell.cost_price).toBeCloseTo(10, 4);
    expect(sell.realized_pnl).toBeCloseTo(50, 2); // 150 − 10×10
    db.close();
  });
});
