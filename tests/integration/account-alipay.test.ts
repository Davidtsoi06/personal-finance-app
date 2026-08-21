import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import {
  createAlipayFamily, ensureAlipayFamily, listAccountsAsTree, getAllAssetsSummary,
  createAccount, getAccount,
} from '../../src/main/database/services/account-service';

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

describe('支付宝账户归类升级 ensureAlipayFamily（v1.10.7）', () => {
  it('现有「支付宝」账户 → 改名「支付宝（国内）」挂父 + 自动补建「支付宝（香港）」', () => {
    const db = freshDb();
    // 模拟用户现状：v12 迁移已自动创建种子「支付宝」账户，用户录入了余额（102.4）
    const alipay = db.prepare("SELECT * FROM accounts WHERE name = '支付宝' AND asset_type = 'e_wallet'").get() as any;
    db.prepare("UPDATE accounts SET balance = 102.4 WHERE id = ?").run(alipay.id);
    db.prepare("UPDATE accounts SET balance = 7854.62 WHERE name = '微信'").run();

    const { parentId, children } = ensureAlipayFamily();
    expect(children).toHaveLength(2);

    // 原账户改名为「支付宝（国内）」并挂到父下，余额保留
    const renamed = getAccount(alipay.id);
    expect(renamed?.name).toBe('支付宝（国内）');
    expect(renamed?.parent_account_id).toBe(parentId);
    expect(renamed?.balance).toBeCloseTo(102.4, 2);

    // 父账户存在，微信保持独立不受影响
    const parent = getAccount(parentId);
    expect(parent?.name).toBe('支付宝');
    expect(parent?.parent_account_id).toBeNull();
    const wechat = db.prepare("SELECT * FROM accounts WHERE name = '微信'").get() as any;
    expect(wechat.parent_account_id).toBeNull();

    // 树形可见：支付宝 ▸ 支付宝（国内）+ 支付宝（香港）
    const tree = listAccountsAsTree();
    const p = tree.find((a: any) => a.id === parentId);
    expect(p?.children.map((c: any) => c.name).sort()).toEqual(['支付宝（国内）', '支付宝（香港）']);
    const hk = p?.children.find((c: any) => c.name === '支付宝（香港）');
    expect(hk.currency).toBe('HKD');
    db.close();
  });

  it('幂等：重复调用不重复创建、不重复改名', () => {
    const db = freshDb();
    db.prepare("UPDATE accounts SET balance = 50 WHERE name = '支付宝' AND asset_type = 'e_wallet'").run();
    ensureAlipayFamily();
    const r2 = ensureAlipayFamily();
    expect(r2.children).toHaveLength(2);
    const count = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE asset_type = 'e_wallet' AND is_active = 1").get() as { c: number };
    expect(count.c).toBe(4); // 种子微信 + 支付宝（国内）+ 支付宝（父）+ 支付宝（香港）
    const dups = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE name = '支付宝（国内）' AND is_active = 1").get() as { c: number };
    expect(dups.c).toBe(1);
    db.close();
  });

  it('已有 createAlipayFamily 树时不重复建（兼容 v1.10.6 用户）', () => {
    const db = freshDb();
    const { parentId, children } = createAlipayFamily();
    const before = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE asset_type = 'e_wallet' AND is_active = 1").get() as { c: number };
    ensureAlipayFamily();
    const after = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE asset_type = 'e_wallet' AND is_active = 1").get() as { c: number };
    expect(after.c).toBe(before.c);
    expect(children).toHaveLength(2);
    const parent = getAccount(parentId);
    expect(parent?.name).toBe('支付宝');
    db.close();
  });

  it('资产管理汇总：支付宝父条目 = 可展开分组，余额 = 子账户合计（不重复计入总资产）', () => {
    const db = freshDb();
    // 模拟用户编辑余额：accounts.balance 与 account_balances（总览真源）同步
    db.prepare("UPDATE accounts SET balance = 100 WHERE name = '支付宝' AND asset_type = 'e_wallet'").run();
    db.prepare("INSERT INTO account_balances (account_id, currency, balance) SELECT id, 'CNY', 100 FROM accounts WHERE name = '支付宝' AND asset_type = 'e_wallet'").run();
    db.prepare("UPDATE accounts SET balance = 200 WHERE name = '微信'").run();
    db.prepare("INSERT INTO account_balances (account_id, currency, balance) SELECT id, 'CNY', 200 FROM accounts WHERE name = '微信'").run();
    ensureAlipayFamily();

    const summary = getAllAssetsSummary();
    const wallets = summary.filter((s) => s.asset_type === 'e_wallet');
    // 分组父 + 微信 = 2 个条目
    expect(wallets).toHaveLength(2);
    const parentItem = wallets.find((w) => w.name === '支付宝');
    expect(parentItem).toBeTruthy();
    expect(parentItem!.children).toHaveLength(2);
    // 父条目余额 = 国内子账户 100 + 香港 0
    expect(parentItem!.market_value_cny).toBeCloseTo(100, 2);
    // 总资产 = 支付宝分组 100 + 微信 200（子账户不单独重复计入）
    const total = summary.reduce((s, item) => s + (item.market_value_cny || 0), 0);
    expect(total).toBeCloseTo(300, 2);
    db.close();
  });
});

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
