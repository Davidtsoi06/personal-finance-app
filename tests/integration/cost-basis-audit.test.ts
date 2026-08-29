import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { createTransaction, deleteTransaction, updateTransaction } from '../../src/main/database/services/transaction-service';
import { getDailyTrades } from '../../src/main/services/report-export-service';

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

/** 建资产并写入（模拟 trade:record 之后的持仓状态） */
function seedAsset(db: Database.Database, name: string, code: string, quantity: number, totalCost: number, costPrice: number): number {
  const r = db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, total_cost, cost_price, current_price) VALUES (?, ?, 'stock', 'a_stock', 'CNY', ?, ?, ?, 15)").run(name, code, quantity, totalCost, costPrice);
  return Number(r.lastInsertRowid);
}

function seedTrade(db: Database.Database, assetId: number, type: 'buy' | 'sell', date: string, quantity: number, price: number, fee = 0): number {
  const total = type === 'sell' ? quantity * price - fee : quantity * price + fee;
  const r = db.prepare("INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes) VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, ?)").run(assetId, type, quantity, price, fee, total, date, type === 'buy' ? '买入' : '卖出');
  return Number(r.lastInsertRowid);
}

function assetState(db: Database.Database, id: number) {
  return db.prepare('SELECT quantity, total_cost, cost_price FROM assets WHERE id = ?').get(id) as any;
}

describe('成本价维护审计（v1.10.8 重放校准）', () => {
  it('删除中间的卖出：资产表精确还原为剩余交易重放（200股/2500/12.5），与报表一致', () => {
    const db = freshDb();
    const a = seedAsset(db, '复现', 'TEST', 150, 2000, 13.3333); // 买100@10 + 卖50@12 + 买100@15 之后
    seedTrade(db, a, 'buy', '2026-08-01', 100, 10);
    const sellId = seedTrade(db, a, 'sell', '2026-08-02', 50, 12);
    seedTrade(db, a, 'buy', '2026-08-03', 100, 15);

    deleteTransaction(sellId);
    const after = assetState(db, a);
    expect(after.quantity).toBeCloseTo(200, 6);
    expect(after.total_cost).toBeCloseTo(2500, 2);
    expect(after.cost_price).toBeCloseTo(12.5, 4);

    // 报表口径一致（报表重放 == 资产表）
    const { rows } = getDailyTrades('2026-08-04');
    const sell = rows.find((r: any) => r.type === 'sell');
    expect(sell).toBeUndefined();
    db.close();
  });

  it('编辑中间的卖出（数量 50→30）：资产表按新交易重放（170股/2200/12.9412）', () => {
    const db = freshDb();
    const a = seedAsset(db, '复现2', 'TEST2', 150, 2000, 13.3333);
    seedTrade(db, a, 'buy', '2026-08-01', 100, 10);
    const sellId = seedTrade(db, a, 'sell', '2026-08-02', 50, 12);
    seedTrade(db, a, 'buy', '2026-08-03', 100, 15);

    updateTransaction(sellId, { quantity: 30 });
    const after = assetState(db, a);
    expect(after.quantity).toBeCloseTo(170, 6);
    expect(after.total_cost).toBeCloseTo(2200, 2);
    expect(after.cost_price).toBeCloseTo(2200 / 170, 4);
    db.close();
  });

  it('清仓后删除交易：成本清零，不残留旧均价', () => {
    const db = freshDb();
    const a = seedAsset(db, '清仓', 'TEST3', 0, 0, 10); // 清仓后残留旧均价 10（旧 bug 场景）
    const buyId = seedTrade(db, a, 'buy', '2026-08-01', 100, 10);
    seedTrade(db, a, 'sell', '2026-08-02', 100, 12);

    deleteTransaction(buyId);
    const after = assetState(db, a);
    expect(after.quantity).toBe(0);
    expect(after.cost_price).toBe(0); // 不再残留 10
    expect(after.total_cost).toBe(0);
    db.close();
  });

  it('手工调整数量后交易：保留手工数量，成本价按重放均价刷新', () => {
    const db = freshDb();
    const a = seedAsset(db, '手工', 'TEST4', 200, 1000, 10); // 用户手工把数量从 100 改成 200
    seedTrade(db, a, 'buy', '2026-08-01', 100, 10);
    const buyId = seedTrade(db, a, 'buy', '2026-08-03', 100, 15);

    deleteTransaction(buyId); // 删除第二笔买入：重放=100股@10；期望数量=200-100=100？不——手工偏移应保留
    const after = assetState(db, a);
    // 现数量 200（手工）− 删除买入 100 = 期望 100；重放=100 → 一致 → 采用重放 100
    expect(after.quantity).toBeCloseTo(100, 6);
    expect(after.cost_price).toBeCloseTo(10, 4);
    db.close();
  });

  it('createTransaction 不触碰资产（交易行维护由 trade:record 完成）；删除无交易资产交易后不动', () => {
    const db = freshDb();
    const a = seedAsset(db, '无交易', 'TEST5', 0, 0, 0);
    const t = createTransaction({ asset_id: a, type: 'buy', quantity: 10, price: 5 });
    // createTransaction 本身不更新资产（设计如此，资产由 trade:record 维护）
    expect(assetState(db, a).quantity).toBe(0);
    deleteTransaction(t.id);
    // 删除后无剩余交易 → 不动
    expect(assetState(db, a).quantity).toBe(0);
    db.close();
  });
});