import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { recordUsage, getUsageToday } from '../../src/main/services/ai-service';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

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

describe('AI 用量持久化（v1.10.5）', () => {
  it('记录后今日用量可读回；多次调用累加', () => {
    const db = freshDb();
    recordUsage(100, 50);
    let today = getUsageToday();
    expect(today.calls).toBe(1);
    expect(today.promptTokens).toBe(100);
    expect(today.completionTokens).toBe(50);

    recordUsage(30, 10);
    today = getUsageToday();
    expect(today.calls).toBe(2);
    expect(today.promptTokens).toBe(130);
    expect(today.completionTokens).toBe(60);
    db.close();
  });

  it('指定日期记录互不影响（跨天隔离，日期在保留期内）', () => {
    const db = freshDb();
    const y = daysAgo(1); // 昨天（在 7 天保留期内）
    recordUsage(100, 50, 1, y);
    expect(getUsageToday(y).calls).toBe(1);
    expect(getUsageToday(y).promptTokens).toBe(100);
    const today = getUsageToday();
    expect(today.calls).toBe(0);
    expect(today.promptTokens).toBe(0);
    db.close();
  });
});
