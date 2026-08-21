import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { createAlipayFamily, listAccountsAsTree } from '../../src/main/database/services/account-service';

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

describe('支付宝多区域模板（v1.10.6）', () => {
  it('创建父账户 + 国内/香港两个子账户（币种/类型正确，树形可见）', () => {
    const db = freshDb();
    const { parentId, children } = createAlipayFamily();
    expect(children).toHaveLength(2);
    const tree = listAccountsAsTree();
    const parent = tree.find((a: any) => a.id === parentId);
    expect(parent).toBeTruthy();
    expect(parent.name).toBe('支付宝');
    expect(parent.children).toHaveLength(2);
    const cn = parent.children.find((c: any) => c.name === '支付宝（国内）');
    const hk = parent.children.find((c: any) => c.name === '支付宝（香港）');
    expect(cn).toBeTruthy();
    expect(cn.currency).toBe('CNY');
    expect(cn.asset_type).toBe('e_wallet');
    expect(hk).toBeTruthy();
    expect(hk.currency).toBe('HKD');
    db.close();
  });
});
