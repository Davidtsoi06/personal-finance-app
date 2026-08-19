import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { getRecentSellPnl, localDateStr } from '../../src/main/services/report-export-service';

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

function seedAsset(db: Database.Database, name: string, code: string, costPrice = 10): number {
  const r = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price)
    VALUES (?, ?, 'stock', 'a_stock', 'CNY', 100, ?, 11)
  `).run(name, code, costPrice);
  return Number(r.lastInsertRowid);
}

function seedTrade(db: Database.Database, assetId: number, type: 'buy' | 'sell', date: string, quantity: number, totalAmount: number, price = 0) {
  db.prepare(`
    INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date)
    VALUES (?, ?, ?, ?, 0, ?, 'CNY', ?)
  `).run(assetId, type, quantity, price, totalAmount, date);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

describe('投资收益明细 getRecentSellPnl（v1.10.0）', () => {
  it('只返回卖出交易，按今天/昨天/前天分组，成本价=买入加权平均、收益率正确', () => {
    const db = freshDb();
    const a = seedAsset(db, '测试股', '000001');
    // 早期买入：100×10 + 100×12 → 均价 11
    seedTrade(db, a, 'buy', daysAgo(5), 100, 1000);
    seedTrade(db, a, 'buy', daysAgo(4), 100, 1200);
    // 今天卖出 50 @13 → 盈亏 = 650 − 11×50 = 100
    seedTrade(db, a, 'sell', daysAgo(0), 50, 650, 13);
    // 昨天卖出 30 @11 → 盈亏 = 330 − 11×30 = 0
    seedTrade(db, a, 'sell', daysAgo(1), 30, 330, 11);
    // 前天卖出 20 @12 → 盈亏 = 240 − 11×20 = 20
    seedTrade(db, a, 'sell', daysAgo(2), 20, 240, 12);
    // 今天晚些时候还买入（id 更大，不计入今天卖出的成本基础，也不出现在卖出明细里）
    seedTrade(db, a, 'buy', daysAgo(0), 10, 100);

    const days = getRecentSellPnl(3);
    expect(days).toHaveLength(3);
    expect(days[0].date).toBe(daysAgo(0));
    expect(days[1].date).toBe(daysAgo(1));
    expect(days[2].date).toBe(daysAgo(2));

    // 今天：1 笔卖出，盈亏 +100，收益率 = 100/550 = 18.18%
    expect(days[0].sellCount).toBe(1);
    expect(days[0].sells).toHaveLength(1);
    expect(days[0].realizedPnl).toBeCloseTo(100, 2);
    expect(days[0].sellAmount).toBeCloseTo(650, 2);
    const t0 = days[0].sells[0];
    expect(t0.name).toBe('测试股');
    expect(t0.cost_price).toBeCloseTo(11, 6);
    expect(t0.quantity).toBeCloseTo(50, 6);
    expect(t0.price).toBeCloseTo(13, 6);
    expect(t0.realized_pnl).toBeCloseTo(100, 2);
    expect(t0.rate_pct).toBeCloseTo(18.18, 2);

    // 昨天：只 1 笔卖出（买入不显示）
    expect(days[1].sellCount).toBe(1);
    expect(days[1].sells).toHaveLength(1);
    expect(days[1].realizedPnl).toBeCloseTo(0, 2);

    // 前天
    expect(days[2].sellCount).toBe(1);
    expect(days[2].realizedPnl).toBeCloseTo(20, 2);
    db.close();
  });

  it('无卖出的天 sellCount=0；全部为空时 days 结构完整', () => {
    const db = freshDb();
    const a = seedAsset(db, '无交易', '000002');
    seedTrade(db, a, 'buy', daysAgo(5), 100, 1000);
    const days = getRecentSellPnl(3);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.sellCount === 0)).toBe(true);
    expect(days[0].sells).toHaveLength(0);
    db.close();
  });

  it('无成本价的卖出：盈亏与收益率显示 null（不参与汇总）', () => {
    const db = freshDb();
    const a = seedAsset(db, '无成本', '000003', 0);
    seedTrade(db, a, 'sell', daysAgo(0), 10, 100); // 无任何买入
    const days = getRecentSellPnl(1);
    expect(days[0].sellCount).toBe(1);
    expect(days[0].sells[0].cost_price).toBeNull();
    expect(days[0].sells[0].realized_pnl).toBeNull();
    expect(days[0].sells[0].rate_pct).toBeNull();
    expect(days[0].realizedPnl).toBe(0);
    db.close();
  });
});
