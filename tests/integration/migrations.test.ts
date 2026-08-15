import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';

/** 在内存库上按序执行迁移（v13 的 migrate 依赖 electron 环境，单独处理） */
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return db;
}

function apply(db: Database.Database, version: number): void {
  const m = MIGRATIONS.find((x) => x.version === version)!;
  db.exec('BEGIN');
  try {
    db.exec(m.sql);
    if (m.migrate && version !== 13) m.migrate(db);
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

describe('迁移体系（v1 ~ v12）', () => {
  it('按序执行全部迁移后业务表全部存在', () => {
    const db = freshDb();
    for (const m of MIGRATIONS.filter((x) => x.version <= 12)) {
      apply(db, m.version);
    }
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((r) => r.name);
    const expected = [
      'currencies', 'exchange_rates', 'accounts', 'categories', 'assets', 'asset_prices',
      'transactions', 'ledgers', 'account_transactions', 'custom_statement_formats',
      'app_settings', 'budgets', 'alert_config', 'social_obligations', 'account_balances',
      'custom_bank_formats', 'fixed_deposits', 'investment_accounts', 'net_worth_history',
      'insurance_policies', 'premium_payments', '_migrations',
    ];
    for (const t of expected) {
      expect(tables).toContain(t);
    }
  });

  it('外键约束生效', () => {
    const db = freshDb();
    apply(db, 1);
    apply(db, 3);
    expect(() =>
      db.prepare("INSERT INTO account_transactions (account_id, type, amount) VALUES (999, 'deposit', 100)").run()
    ).toThrow();
  });

  it('v13 为无结构变化的 JS 迁移（SQL 为 no-op）', () => {
    const m = MIGRATIONS.find((x) => x.version === 13)!;
    expect(m.migrate).toBeDefined();
    expect(m.sql).not.toContain('CREATE TABLE');
    expect(m.sql).not.toContain('ALTER TABLE');
  });

  it('v16 定期存款资金交互列 + 存量回填', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    // 先跑 v1~v15，再插入存量定存行（模拟 v16 之前的用户数据）
    for (const m of MIGRATIONS.filter((x) => x.version <= 15)) {
      db.exec('BEGIN');
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    }
    db.prepare("INSERT INTO accounts (name, type, asset_type, currency) VALUES ('中行卡', 'bank_card', 'bank', 'CNY')").run();
    const accId = db.prepare("SELECT id FROM accounts WHERE name = '中行卡'").get() as { id: number };
    db.prepare("INSERT INTO fixed_deposits (account_id, amount, currency, start_date, maturity_date) VALUES (?, 10000, 'CNY', '2026-01-01', '2027-01-01')").run(accId.id);
    // 再跑 v16（含回填 migrate）
    const v16 = MIGRATIONS.find((x) => x.version === 16)!;
    db.exec('BEGIN');
    db.exec(v16.sql);
    v16.migrate!(db);
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM fixed_deposits LIMIT 1').get() as any;
    expect(row.deduct_mode).toBe('deduct');
    expect(row.deduct_account_id).toBe(accId.id);
    db.close();
  });

  it('v15 检测孤儿持仓并写入计数', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    for (const m of MIGRATIONS) {
      db.exec('BEGIN');
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    }
    // 造一只孤儿持仓（无券商、无银行归属）
    db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity) VALUES ('孤儿股', 'ORPH', 'stock', 'other', 'CNY', 10)").run();
    const v15 = MIGRATIONS.find((x) => x.version === 15)!;
    db.exec('BEGIN');
    db.exec(v15.sql);
    v15.migrate!(db);
    db.exec('COMMIT');
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'orphan_assets.count'").get() as { value: string };
    expect(row.value).toBe('1');
    db.close();
  });

  it('v13 卡号截断 SQL 行为正确', () => {
    const db = freshDb();
    apply(db, 1);
    db.prepare("INSERT INTO accounts (name, type, currency, card_number) VALUES ('测试卡', 'bank_card', 'CNY', '6222 0212 3456 7890')").run();
    db.prepare("INSERT INTO accounts (name, type, currency, card_number) VALUES ('短卡号', 'bank_card', 'CNY', '1234')").run();
    db.exec([
      'UPDATE accounts',
      "SET card_number = substr(replace(replace(card_number, ' ', ''), '-', ''), -4)",
      'WHERE card_number IS NOT NULL',
      "AND length(replace(replace(card_number, ' ', ''), '-', '')) > 4",
    ].join(' '));
    const rows = db.prepare('SELECT card_number FROM accounts ORDER BY id').all() as { card_number: string }[];
    expect(rows[0].card_number).toBe('7890');
    expect(rows[1].card_number).toBe('1234'); // 已 ≤4 位不受影响
  });
});
