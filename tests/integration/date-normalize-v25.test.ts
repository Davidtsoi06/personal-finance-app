import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { parseRows } from '../../src/main/services/statement-parser';
import { parseBankRows } from '../../src/main/services/bank-statement-parser';

/** 建库：执行 v1 ~ v24（不含 v25），再单独验证 v25 的日期重整 */
function dbWithoutV25(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS.filter((x) => x.version !== 25)) {
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

function applyV25(db: Database.Database): void {
  const m = MIGRATIONS.find((x) => x.version === 25)!;
  expect(m).toBeDefined();
  db.exec('BEGIN');
  db.exec(m.sql);
  if (m.migrate) m.migrate(db);
  db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(25);
  db.exec('COMMIT');
}

describe('迁移 v25 —— 历史日期重整（v1.10.20）', () => {
  it('把历史脏日期统一重整为 ISO YYYY-MM-DD', () => {
    const db = dbWithoutV25();
    const accountId = (db.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }).id;

    db.prepare('INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES (?,?,?,?,?,?)')
      .run('expense', 10, 'CNY', accountId, '2026/8/7', '斜杠日期');
    db.prepare('INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES (?,?,?,?,?,?)')
      .run('expense', 20, 'CNY', accountId, '20260807', '紧凑日期');
    db.prepare('INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES (?,?,?,?,?,?)')
      .run('expense', 30, 'CNY', accountId, '待确认', '无法识别（保持原值）');
    db.prepare('INSERT INTO account_transactions (account_id, type, amount, currency, date, notes) VALUES (?,?,?,?,?,?)')
      .run(accountId, 'deposit', 100, 'CNY', '2026-08-16 12:30:45', '带时间');
    db.prepare('INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date) VALUES (?,?,?,?,?,?)')
      .run(accountId, 50000, 'CNY', 2.5, '2026年1月5日', '2026.07.05');
    db.prepare('INSERT INTO insurance_policies (name, start_date) VALUES (?,?)')
      .run('测试保单', '2026/6/1');

    applyV25(db);

    const dates = (db.prepare('SELECT date FROM ledgers ORDER BY id').all() as { date: string }[]).map((r) => r.date);
    expect(dates).toEqual(['2026-08-07', '2026-08-07', '待确认']);
    expect((db.prepare('SELECT date FROM account_transactions').get() as { date: string }).date).toBe('2026-08-16');
    const fd = db.prepare('SELECT start_date, maturity_date FROM fixed_deposits').get() as { start_date: string; maturity_date: string };
    expect(fd.start_date).toBe('2026-01-05');
    expect(fd.maturity_date).toBe('2026-07-05');
    expect((db.prepare('SELECT start_date FROM insurance_policies').get() as { start_date: string }).start_date).toBe('2026-06-01');
  });

  it('不触碰 updated_at / created_at 等时间戳列', () => {
    const db = dbWithoutV25();
    const accountId = (db.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }).id;
    db.prepare('INSERT INTO account_transactions (account_id, type, amount, currency, date, notes) VALUES (?,?,?,?,?,?)')
      .run(accountId, 'deposit', 1, 'CNY', '2026/8/7', 'x');
    const before = (db.prepare('SELECT created_at FROM account_transactions').get() as { created_at: string }).created_at;
    applyV25(db);
    const after = (db.prepare('SELECT created_at FROM account_transactions').get() as { created_at: string }).created_at;
    expect(after).toBe(before);
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2} /); // 仍是 datetime 文本，未被当成日期列改写
  });

  it('唯一约束冲突（exchange_rates.date）不阻断迁移', () => {
    const db = dbWithoutV25();
    db.prepare('INSERT INTO exchange_rates (from_currency, to_currency, rate, date) VALUES (?,?,?,?)').run('USD', 'CNY', 7.1, '2026-08-07');
    db.prepare('INSERT INTO exchange_rates (from_currency, to_currency, rate, date) VALUES (?,?,?,?)').run('HKD', 'CNY', 0.91, '2026/8/7');
    expect(() => applyV25(db)).not.toThrow();
    const rows = db.prepare("SELECT date FROM exchange_rates WHERE from_currency IN ('USD','HKD') ORDER BY id").all() as { date: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-08-07');
  });
});

describe('导入解析的日期严格化（v1.10.20）', () => {
  it('券商日结单：无法识别的日期行跳过并提示', () => {
    dbWithoutV25();
    const rows: string[][] = [
      ['日期', '代码', '名称', '买卖', '数量', '价格', '手续费', '币种'],
      ['2026/8/7', '00700', '腾讯控股', '买入', '100', '300', '5', 'HKD'],
      ['日期未知', '00001', '长和', '买入', '100', '50', '5', 'HKD'],
    ];
    const result = parseRows(rows);
    expect(result.success).toBe(true);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].date).toBe('2026-08-07');
    expect(result.errors.join('')).toContain('1 行日期无法识别');
  });

  it('银行日结单：无法识别的日期行跳过并提示', () => {
    dbWithoutV25();
    const rows: string[][] = [
      ['日期', '摘要', '支出金额', '收入金额', '结余'],
      ['2026/8/7', '超市购物', '100.00', '', '900.00'],
      ['日期未知', '无法识别行', '50.00', '', '850.00'],
    ];
    const result = parseBankRows(rows);
    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].date).toBe('2026-08-07');
    expect(result.errors.join('')).toContain('1 行日期无法识别');
  });
});
