import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { parseBankRows } from '../../src/main/services/bank-statement-parser';
import { parseRows } from '../../src/main/services/statement-parser';
import { rowsToSampleText } from '../../src/main/services/ai-service';
import { normalizeDate } from '../../src/main/services/data-normalizer';

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

/** 生成真实 xlsx：第 1 列数据行设为「日期格式」单元格（序列号 46251 = 2026-08-17），模拟 Excel 日期单元格 */
function makeXlsxWithDateCell(rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell) {
      cell.t = 'n';
      cell.v = 46251; // 2026-08-17 的 Excel 序列号
      cell.z = 'd/m/yyyy'; // 日期格式
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 与应用相同的方式读取 Excel（无 cellDates，日期单元格 → 序列号数字） */
function readRows(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];
}

describe('Excel 日期格式单元格（序列号 46251）解析（v1.10.3）', () => {
  it('normalizeDate 直接支持 number 序列号与 Date 对象', () => {
    expect(normalizeDate(46251)).toBe('2026-08-17');
    expect(normalizeDate(46251.5)).toBe('2026-08-17');
    expect(normalizeDate(new Date(Date.UTC(2026, 7, 17)))).toBe('2026-08-17');
    expect(normalizeDate('46251')).toBe('2026-08-17');
  });

  it('银行日结单 Excel：日期格式单元格读取为 46251，解析后转为 2026-08-17', () => {
    const db = freshDb();
    const buf = makeXlsxWithDateCell([
      ['日期', '金额', '收支方向', '摘要', '币种'],
      [46251, 5000, '存入', '工资', 'CNY'],
    ]);
    const rows = readRows(buf);
    // 模拟 xlsx 读取：日期单元格是数字 46251
    expect(rows[1][0]).toBe(46251);
    const result = parseBankRows(rows as string[][]);
    expect(result.success).toBe(true);
    expect(result.records[0].date).toBe('2026-08-17');
    expect(result.records[0].amount).toBeCloseTo(5000, 2);
    expect(result.records[0].type).toBe('deposit');
    db.close();
  });

  it('券商日结单 Excel：标准格式日期单元格序列号也转为 2026-08-17', () => {
    const db = freshDb();
    const buf = makeXlsxWithDateCell([
      ['date', 'code', 'name', 'type', 'quantity', 'price', 'fee', 'currency'],
      [46251, '00001', '腾讯控股', 'buy', 100, 350, 5, 'HKD'],
    ]);
    const rows = readRows(buf);
    expect(rows[1][0]).toBe(46251);
    const result = parseRows(rows as string[][]);
    expect(result.success).toBe(true);
    expect(result.trades[0].date).toBe('2026-08-17');
    expect(result.trades[0].code).toBe('00001');
    db.close();
  });

  it('AI 样例文本：序列号与 Date 对象转真实日期，字符串与普通数字不变', () => {
    expect(rowsToSampleText([[46251, '工资', 5000]])).toBe('2026-08-17\t工资\t5000');
    expect(rowsToSampleText([[new Date(Date.UTC(2026, 7, 17)), 'desc']])).toBe('2026-08-17\tdesc');
    expect(rowsToSampleText([['17/8/2026']])).toBe('17/8/2026'); // 字符串原样
    expect(rowsToSampleText([[123456]])).toBe('123456'); // 非序列号范围原样
  });
});
