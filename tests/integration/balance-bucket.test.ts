import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { deleteAccountBalanceBucket, createAccount, getAccountBalances } from '../../src/main/database/services/account-service';

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

describe('多币种余额桶删除（v1.10.9）', () => {
  it('余额为 0 的桶可删除，删除后不再出现', () => {
    const db = freshDb();
    const acc = createAccount({ name: '测试账户', type: 'bank_card', asset_type: 'bank', currency: 'CNY', balance: 100 });
    // 构造 USD 零余额桶（模拟已清空的美金）
    db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, 0)').run(acc.id, 'USD');
    expect(getAccountBalances(acc.id).some((b: any) => b.currency === 'USD')).toBe(true);
    const r = deleteAccountBalanceBucket(acc.id, 'USD');
    expect(r.success).toBe(true);
    expect(getAccountBalances(acc.id).some((b: any) => b.currency === 'USD')).toBe(false);
    db.close();
  });

  it('有余额的桶拒绝删除（防误删数据）', () => {
    const db = freshDb();
    const acc = createAccount({ name: '测试账户2', type: 'bank_card', asset_type: 'bank', currency: 'CNY', balance: 0 });
    db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, 500)').run(acc.id, 'USD');
    const r = deleteAccountBalanceBucket(acc.id, 'USD');
    expect(r.success).toBe(false);
    expect(r.error).toContain('不能删除');
    expect(getAccountBalances(acc.id).some((b: any) => b.currency === 'USD')).toBe(true);
    db.close();
  });

  it('不存在的桶返回错误', () => {
    const db = freshDb();
    const acc = createAccount({ name: '测试账户3', type: 'bank_card', asset_type: 'bank', currency: 'CNY', balance: 0 });
    const r = deleteAccountBalanceBucket(acc.id, 'EUR');
    expect(r.success).toBe(false);
    db.close();
  });
});