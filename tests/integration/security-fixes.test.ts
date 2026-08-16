import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { setSetting } from '../../src/main/database/services/settings-service';
import { requestResetCode } from '../../src/main/services/auth-service';

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(d);
      d.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
  setDatabaseForTest(d);
  return d;
}

describe('批 2 安全加固回归（v1.7.1）', () => {
  beforeEach(() => { db = freshDb(); });

  it('防枚举：未设置恢复邮箱时 requestResetCode 静默返回（不报错不发送）', async () => {
    await expect(requestResetCode('anyone@example.com')).resolves.toBeUndefined();
  });

  it('防枚举：邮箱不匹配时同样静默返回（与匹配路径无法区分）', async () => {
    setSetting('auth.recovery_email', 'real@example.com');
    await expect(requestResetCode('wrong@example.com')).resolves.toBeUndefined();
    // 不匹配路径不产生任何验证码相关写入（仅迁移回填键与恢复邮箱键）
    const keys = (db.prepare('SELECT key FROM app_settings').all() as any[]).map((r) => r.key);
    expect(keys).toContain('auth.recovery_email');
    expect(keys.filter((k) => k.startsWith('auth.') && k !== 'auth.recovery_email')).toHaveLength(0);
  });
});