import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { parseBankRows } from '../../src/main/services/bank-statement-parser';
import { classifyBankRecord } from '../../src/main/services/statement-classifier';

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

function seedFormat(db: Database.Database, name: string, mapping: string): void {
  // 关键词需命中样例文本（表头含「日期」），否则格式匹配会被跳过
  db.prepare(`
    INSERT INTO custom_bank_formats (name, keywords, column_mapping, has_header)
    VALUES (?, ?, ?, 1)
  `).run(name, '日期', mapping);
}

/** 用户样例：港银日结单——支出/收入分列 + 结余，无方向列，日期 DD/MM/YYYY 与中文「X月Y日」 */
const SAMPLE_ROWS: string[][] = [
  ['日期', '摘要', '支出金额', '收入金额', '结余'],
  ['18/08/2026', 'NEW TERM DEP             4114913018330033', '300,000.00', '', '59,792.70'],
  ['18/08/2026', 'YUAN WEI                 HC12681838654154   18AUG', '', '50,000.00', '359,792.70'],
  ['17/08/2026', 'CREDIT CARD PAYMENT      4966040520961350', '2,299.60', '', '309,792.70'],
  ['10月8日', 'APC COLL-WATER BILLS     00403315112', '1,000.00', '', '460,706.00'],
];

const SPLIT_MAPPING = JSON.stringify([
  { position: 0, field: 'date' },
  { position: 1, field: 'description' },
  { position: 2, field: 'expense' },
  { position: 3, field: 'income' },
  { position: 4, field: 'balance' },
]);

describe('银行日结单：收入/支出分列 + 结余（v1.10.1，用户样例）', () => {
  it('分列格式解析：支出列/收入列分别识别方向，千分位/中文日期/结余正常', () => {
    const db = freshDb();
    seedFormat(db, '汇丰-分列格式', SPLIT_MAPPING);
    const result = parseBankRows(SAMPLE_ROWS, '汇丰-分列格式');
    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(4);

    const [r0, r1, r2, r3] = result.records;
    // NEW TERM DEP -300,000（支出）
    expect(r0.type).toBe('withdraw');
    expect(r0.amount).toBeCloseTo(300000, 2);
    expect(r0.date).toBe('2026-08-18');
    expect(r0.description).toContain('NEW TERM DEP');
    expect(r0.balance).toBeCloseTo(59792.7, 2);
    // YUAN WEI +50,000（收入）
    expect(r1.type).toBe('deposit');
    expect(r1.amount).toBeCloseTo(50000, 2);
    expect(r1.date).toBe('2026-08-18');
    // 信用卡还款 2,299.60（支出）
    expect(r2.type).toBe('withdraw');
    expect(r2.amount).toBeCloseTo(2299.6, 2);
    // 中文日期行（支出）
    expect(r3.type).toBe('withdraw');
    expect(r3.amount).toBeCloseTo(1000, 2);
    expect(['2026-08-10', '2026-10-08']).toContain(r3.date);
    expect(r3.balance).toBeCloseTo(460706, 2);
    db.close();
  });

  it('分列解析结果可直接用于定期分类：NEW TERM DEP → fd_out；TERM DEP W\\D 存入 → fd_in', () => {
    const db = freshDb();
    seedFormat(db, '汇丰-分列格式', SPLIT_MAPPING);
    const rows: string[][] = [
      ['日期', '摘要', '支出金额', '收入金额', '结余'],
      ['18/08/2026', 'NEW TERM DEP 4114913018330033', '300,000.00', '', '59,792.70'],
      ['13/08/2026', 'TERM DEP W\\D 4114913018330026', '', '251,386.30', '312,092.30'],
      ['17/08/2026', 'CREDIT CARD PAYMENT 4966040520961350', '2,299.60', '', '309,792.70'],
    ];
    const result = parseBankRows(rows, '汇丰-分列格式');
    const cls = result.records.map((r) => classifyBankRecord(r));
    expect(cls[0]).toBe('fd_out');
    expect(cls[1]).toBe('fd_in');
    expect(cls[2]).toBe('normal');
    db.close();
  });

  it('单列带符号金额 + 无方向列：按正负号推断方向', () => {
    const db = freshDb();
    seedFormat(db, '单列带符号', JSON.stringify([
      { position: 0, field: 'date' },
      { position: 1, field: 'description' },
      { position: 2, field: 'amount' },
      { position: 3, field: 'currency' },
    ]));
    const rows: string[][] = [
      ['日期', '摘要', '金额', '币种'],
      ['18/08/2026', 'NEW TERM DEP 4114', '-300,000.00', 'HKD'],
      ['18/08/2026', 'YUAN WEI', '50,000.00', 'HKD'],
    ];
    const result = parseBankRows(rows, '单列带符号');
    expect(result.records[0].type).toBe('withdraw');
    expect(result.records[0].amount).toBeCloseTo(300000, 2);
    expect(result.records[0].currency).toBe('HKD');
    expect(result.records[1].type).toBe('deposit');
    expect(result.records[1].amount).toBeCloseTo(50000, 2);
    db.close();
  });
});
