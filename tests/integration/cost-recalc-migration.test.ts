import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';

/** 建库到 v20（不跑 v21），供手动触发 v21 验证 */
function dbUpTo(db: Database.Database, maxVersion: number): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS.filter((x) => x.version <= maxVersion)) {
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
}

function seedAsset(db: Database.Database, name: string, code: string, quantity: number, costPrice: number, currentPrice: number): number {
  const r = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price)
    VALUES (?, ?, 'stock', 'a_stock', 'CNY', ?, ?, ?)
  `).run(name, code, quantity, costPrice, currentPrice);
  return Number(r.lastInsertRowid);
}

function seedTrade(db: Database.Database, assetId: number, type: 'buy' | 'sell', date: string, quantity: number, totalAmount: number) {
  db.prepare(`
    INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date)
    VALUES (?, ?, ?, 0, 0, ?, 'CNY', ?)
  `).run(assetId, type, quantity, totalAmount, date);
}

function runV21(db: Database.Database): void {
  const v21 = MIGRATIONS.find((x) => x.version === 21)!;
  db.exec('BEGIN');
  try {
    db.exec(v21.sql);
    if (v21.migrate) v21.migrate(db);
    db.prepare('INSERT INTO _migrations (version) VALUES (21)').run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

describe('迁移 v21：成本价历史重放修复（v1.9.1）', () => {
  it('有买卖历史的资产：数量/成本价/总成本/盈亏全部按重放刷新', () => {
    const db = new Database(':memory:');
    dbUpTo(db, 20);
    const a = seedAsset(db, '漂移持仓', '000001', 200, 9.5, 13); // 错误成本价 9.5（正确应为 11）
    seedTrade(db, a, 'buy', '2026-08-01', 100, 1000);
    seedTrade(db, a, 'buy', '2026-08-02', 100, 1200);

    runV21(db);

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(a) as any;
    expect(row.quantity).toBeCloseTo(200, 6);
    expect(row.cost_price).toBeCloseTo(11, 6);
    expect(row.total_cost).toBeCloseTo(2200, 2);
    expect(row.market_value).toBeCloseTo(2600, 2);
    expect(row.profit_loss).toBeCloseTo(400, 2);
    expect(row.profit_loss_pct).toBeCloseTo(18.18, 2);
    db.close();
  });

  it('有卖出历史：净数量与冲销后均价', () => {
    const db = new Database(':memory:');
    dbUpTo(db, 20);
    const a = seedAsset(db, '部分卖出', '000002', 50, 7, 12);
    seedTrade(db, a, 'buy', '2026-08-01', 100, 1000);
    seedTrade(db, a, 'sell', '2026-08-03', 50, 600);

    runV21(db);

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(a) as any;
    expect(row.quantity).toBeCloseTo(50, 6);
    expect(row.cost_price).toBeCloseTo(10, 6);
    expect(row.total_cost).toBeCloseTo(500, 2);
    db.close();
  });

  it('无交易记录的资产（手工成本价）完全不动', () => {
    const db = new Database(':memory:');
    dbUpTo(db, 20);
    const a = seedAsset(db, '手工录入', '000003', 10, 8.88, 9);

    runV21(db);

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(a) as any;
    expect(row.cost_price).toBeCloseTo(8.88, 6);
    expect(row.quantity).toBeCloseTo(10, 6);
    db.close();
  });

  it('数量与历史净额不一致（拆分/手工调整）：保留现数量，仅刷新成本价并留痕', () => {
    const db = new Database(':memory:');
    dbUpTo(db, 20);
    const a = seedAsset(db, '拆股持仓', '000004', 200, 5, 10); // 历史净额 100，现数量 200（拆股）
    seedTrade(db, a, 'buy', '2026-08-01', 100, 1000);

    runV21(db);

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(a) as any;
    expect(row.quantity).toBeCloseTo(200, 6); // 数量保留
    expect(row.cost_price).toBeCloseTo(10, 6); // 均价刷新为 1000/100
    expect(row.total_cost).toBeCloseTo(2000, 2); // 均价 × 现数量
    const snap = db.prepare("SELECT value FROM app_settings WHERE key = 'cost_recalc.snapshot'").get() as any;
    expect(snap).toBeTruthy();
    const parsed = JSON.parse(snap.value);
    expect(parsed.qtyMismatchIds).toContain(a);
    expect(parsed.assets.find((x: any) => x.id === a).old.cost_price).toBeCloseTo(5, 6);
    db.close();
  });

  it('历史已清仓的资产不写入', () => {
    const db = new Database(':memory:');
    dbUpTo(db, 20);
    const a = seedAsset(db, '已清仓', '000005', 0, 3, 10);
    seedTrade(db, a, 'buy', '2026-08-01', 100, 1000);
    seedTrade(db, a, 'sell', '2026-08-02', 100, 1100);

    runV21(db);

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(a) as any;
    expect(row.quantity).toBeCloseTo(0, 6);
    expect(row.cost_price).toBeCloseTo(3, 6); // 原值不动
    db.close();
  });
});
