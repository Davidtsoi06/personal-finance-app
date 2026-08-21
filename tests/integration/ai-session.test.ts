import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import {
  createSessionInDb, listSessionsInDb, deleteSessionInDb, appendMessageInDb,
  listMessagesInDb, saveReportInDb, listReportsInDb, getReportInDb, deleteReportInDb,
  sessionToMarkdown, mdToHtml,
} from '../../src/main/database/services/ai-session-service';

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

describe('AI 会话与报告持久化（v1.10.6）', () => {
  it('会话创建/消息追加/读取/删除（级联删消息）', () => {
    const db = freshDb();
    const sid = createSessionInDb(db, '第一次对话');
    expect(sid).toBeGreaterThan(0);
    appendMessageInDb(db, sid, 'user', '你好');
    appendMessageInDb(db, sid, 'assistant', '你好！有什么可以帮你？');
    appendMessageInDb(db, sid, 'user', '分析我的持仓');

    const msgs = listMessagesInDb(db, sid);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].content).toContain('你好');

    const list = listSessionsInDb(db);
    expect(list).toHaveLength(1);
    expect(list[0].message_count).toBe(3);

    expect(deleteSessionInDb(db, sid)).toBe(true);
    expect(listMessagesInDb(db, sid)).toHaveLength(0); // 级联删除
    expect(listSessionsInDb(db)).toHaveLength(0);
    db.close();
  });

  it('报告保存/列表/读取/删除', () => {
    const db = freshDb();
    const sid = createSessionInDb(db, '会话');
    appendMessageInDb(db, sid, 'user', '问题');
    appendMessageInDb(db, sid, 'assistant', '# 分析结果\n\n组合健康。');
    const rid = saveReportInDb(db, sid, '我的报告', sessionToMarkdown('我的报告', listMessagesInDb(db, sid)));
    expect(rid).toBeGreaterThan(0);
    const list = listReportsInDb(db);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('我的报告');
    expect(list[0].content).toContain('分析结果');
    const got = getReportInDb(db, rid)!;
    expect(got.content).toContain('AI：**'); // sessionToMarkdown 中为 **🤖 AI：**
    expect(deleteReportInDb(db, rid)).toBe(true);
    expect(listReportsInDb(db)).toHaveLength(0);
    db.close();
  });

  it('mdToHtml 转义与基础结构', () => {
    const html = mdToHtml('# 标题\n\n**粗体** <script>alert(1)</script>\n\n- 项目1\n- 项目2');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<b>粗体</b>');
    expect(html).toContain('&lt;script&gt;'); // 转义防注入
    expect(html).toContain('<li>项目1</li>');
  });
});
