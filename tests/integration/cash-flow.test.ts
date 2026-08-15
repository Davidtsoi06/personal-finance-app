import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import {
  insertCashFlowInDb, recomputeCashBalanceInDb,
  syncFlowForTransactionInDb, removeFlowsForTransactionInDb,
} from '../../src/main/database/services/cash-flow-core';

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

function seedAccount(db: Database.Database, cash = 500): number {
  const r = db.prepare(
    "INSERT INTO investment_accounts (name, broker, currency, cash_balance) VALUES ('富途', '富途', 'HKD', ?)"
  ).run(cash);
  return Number(r.lastInsertRowid);
}

function seedAsset(db: Database.Database, accountId: number): number {
  const r = db.prepare(
    "INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id)" +
    " VALUES ('腾讯', '00700', 'stock', 'hk_stock', 'HKD', 100, 300, 300, 30000, 30000, 0, 0, ?)"
  ).run(accountId);
  return Number(r.lastInsertRowid);
}

describe('迁移 v14：现金流水表 + 期初快照', () => {
  it('有现金余额的券商账户生成 adjust 快照流水', () => {
    // 迁移前手动造数据（v13 阶段）
    const db = new Database(':memory:');
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    for (const m of MIGRATIONS.filter((x) => x.version <= 13)) {
      db.exec('BEGIN');
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    }
    const accId = seedAccount(db, 500);
    const v14 = MIGRATIONS.find((x) => x.version === 14)!;
    db.exec('BEGIN');
    db.exec(v14.sql);
    v14.migrate!(db);
    db.exec('COMMIT');
    const rows = db.prepare('SELECT * FROM investment_cash_flows WHERE investment_account_id = ?').all(accId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('adjust');
    expect(rows[0].amount).toBe(500);
    expect(rows[0].balance_after).toBe(500);
    // 零余额账户不生成快照
    const acc2 = seedAccount(db, 0);
    const rows2 = db.prepare('SELECT COUNT(*) as c FROM investment_cash_flows WHERE investment_account_id = ?').get(acc2) as any;
    expect(rows2.c).toBe(0);
    db.close();
  });
});

describe('cash-flow-core：流水派生余额', () => {
  it('插入流水 → 重算余额与 balance_after 链', () => {
    const db = freshDb();
    const accId = seedAccount(db, 0);
    insertCashFlowInDb(db, { investmentAccountId: accId, type: 'deposit', amount: 1000, currency: 'HKD' });
    insertCashFlowInDb(db, { investmentAccountId: accId, type: 'buy', amount: -600, currency: 'HKD' });
    insertCashFlowInDb(db, { investmentAccountId: accId, type: 'sell', amount: 250, currency: 'HKD' });
    const balance = recomputeCashBalanceInDb(db, accId);
    expect(balance).toBe(650);
    const col = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(accId) as any;
    expect(col.cash_balance).toBe(650);
    const rows = db.prepare('SELECT balance_after FROM investment_cash_flows WHERE investment_account_id = ? ORDER BY id').all(accId) as any[];
    expect(rows.map((r: any) => r.balance_after)).toEqual([1000, 400, 650]);
  });

  it('交易同步：买入负流水 / 改卖出后重建 / 删除交易冲销', () => {
    const db = freshDb();
    const accId = seedAccount(db, 1000);
    const assetId = seedAsset(db, accId);
    const txInsert = db.prepare(
      'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)' +
      " VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?)"
    );
    const txId = Number(txInsert.run(assetId, 'buy', 50, 300, 10, 15010, 'HKD', '测试买入').lastInsertRowid);
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;

    syncFlowForTransactionInDb(db, tx, asset);
    let flows = db.prepare('SELECT * FROM investment_cash_flows WHERE transaction_id = ?').all(txId) as any[];
    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('buy');
    expect(flows[0].amount).toBe(-15010);

    // 改为卖出 → 重建为正流水
    db.prepare("UPDATE transactions SET type='sell', total_amount=14990 WHERE id=?").run(txId);
    const tx2 = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
    syncFlowForTransactionInDb(db, tx2, asset);
    flows = db.prepare('SELECT * FROM investment_cash_flows WHERE transaction_id = ?').all(txId) as any[];
    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('sell');
    expect(flows[0].amount).toBe(14990);

    // 删除交易 → 流水冲销
    removeFlowsForTransactionInDb(db, txId);
    flows = db.prepare('SELECT * FROM investment_cash_flows WHERE transaction_id = ?').all(txId) as any[];
    expect(flows).toHaveLength(0);
  });

  it('无投资账户关联的持仓不产生流水', () => {
    const db = freshDb();
    const accId = seedAccount(db, 1000);
    const assetId = seedAsset(db, accId);
    // 断开投资账户关联
    db.prepare('UPDATE assets SET investment_account_id = NULL WHERE id = ?').run(assetId);
    const txId = Number(db.prepare(
      'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date)' +
      " VALUES (?, 'buy', 1, 10, 0, 10, 'CNY', date('now'))"
    ).run(assetId).lastInsertRowid);
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;
    syncFlowForTransactionInDb(db, tx, asset);
    const flows = db.prepare('SELECT COUNT(*) as c FROM investment_cash_flows WHERE transaction_id = ?').get(txId) as any;
    expect(flows.c).toBe(0);
  });
});
