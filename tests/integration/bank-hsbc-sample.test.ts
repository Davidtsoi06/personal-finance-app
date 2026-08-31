import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { parseBankRows } from '../../src/main/services/bank-statement-parser';
import { xlsxSheetToTextRows } from '../../src/main/services/excel-utils';
import { normalizeDate, normalizeCurrency } from '../../src/main/services/data-normalizer';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'hsbc-transaction-history.xlsx');

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

function loadRows(): string[][] {
  const buf = fs.readFileSync(FIXTURE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  return xlsxSheetToTextRows(wb.Sheets[wb.SheetNames[0]]);
}

describe('HSBC 6 列银行日结单（v1.10.10 修复固化）', () => {
  it('表头 Date/Description/Billing amount/Billing currency/Balance/Balance currency 正确解析', () => {
    const rows = loadRows();
    const result = parseBankRows(rows);
    expect(result.format).not.toBe('标准 CSV 格式'); // 6 列表头顺序不符 → 不走按位置硬编码
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(6);
    const rec = result.records;
    // ① 日期正确：文本日期 18/08/2026 与序列号日期 46334/46303 都精确
    expect(rec[0].date).toBe('2026-08-18');
    expect(rec[1].date).toBe('2026-08-18');
    expect(rec[2].date).toBe('2026-08-17');
    expect(rec[3].date).toBe('2026-08-13');
    expect(rec[4].date).toBe('2026-08-11'); // 46334 序列号（显示 11/8/26 美式歧义）
    expect(rec[5].date).toBe('2026-08-10'); // 46303 序列号
    // ② 金额正确（千分位/负号）
    expect(rec[0].amount).toBeCloseTo(300000, 2);
    expect(rec[1].amount).toBeCloseTo(50000, 2);
    expect(rec[2].amount).toBeCloseTo(2299.6, 2);
    expect(rec[3].amount).toBeCloseTo(251386.3, 2);
    expect(rec[4].amount).toBeCloseTo(400000, 2);
    expect(rec[5].amount).toBeCloseTo(1000, 2);
    // ③ 方向正确（负号=支出）
    expect(rec[0].type).toBe('withdraw');
    expect(rec[1].type).toBe('deposit');
    expect(rec[4].type).toBe('withdraw');
    // ④ 币种全部 HKD（Billing currency 列）
    for (const r of rec) expect(r.currency).toBe('HKD');
    // ⑤ 摘要不含币种
    expect(rec[0].description).toContain('NEW TERM DEP');
    expect(rec[1].description).toContain('YUAN WEI');
  });

  it('AI 模板缺 currency 映射时自动补齐（HKD 不再变 CNY）', () => {
    const db = freshDb();
    // 模拟 AI 生成的模板：映射了 date/description/amount/balance，唯独漏了 currency（历史 AI 行为）
    db.prepare(
      "INSERT INTO custom_bank_formats (name, keywords, column_mapping, has_header) VALUES (?, ?, ?, 1)"
    ).run(
      'HSBC-个人流水',
      'Date, Billing',
      JSON.stringify([
        { position: 0, field: 'date' },
        { position: 1, field: 'description' },
        { position: 2, field: 'amount' },
        { position: 3, field: 'ignore' },
        { position: 4, field: 'balance' },
        { position: 5, field: 'ignore' },
      ]),
    );
    const result = parseBankRows(loadRows(), 'HSBC-个人流水');
    expect(result.format).toBe('HSBC-个人流水');
    expect(result.records).toHaveLength(6);
    // 币种自动补齐：Billing currency 列（position 3）→ HKD，而非回退 CNY
    for (const r of result.records) expect(r.currency).toBe('HKD');
    db.close();
  });

  it('斜杠日期晚于今天回退日月（11/8/26 → 2026-08-11）', () => {
    expect(normalizeDate('11/8/26')).toBe('2026-08-11');
    expect(normalizeDate('10/8/26')).toBe('2026-08-10');
    expect(normalizeDate('18/08/2026')).toBe('2026-08-18'); // 月 18 无效回退不受影响
    expect(normalizeDate('8/16/2026')).toBe('2026-08-16'); // 过去的美式日期不受影响
    expect(normalizeDate('8/16/26')).toBe('2026-08-16');
  });

  it('币种识别回归', () => {
    expect(normalizeCurrency('HKD')).toBe('HKD');
    expect(normalizeCurrency('人民币元')).toBe('CNY');
  });
});