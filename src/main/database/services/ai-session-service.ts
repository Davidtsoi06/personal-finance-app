/**
 * ai-session-service — AI 会话与报告持久化（v1.10.6）。
 * 会话（ai_sessions）/消息（ai_messages）/报告（ai_reports）三张表，纯 DB 操作。
 */
import type Database from 'better-sqlite3';
import { getDatabase } from '../index';

export interface AiSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface AiMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AiReport {
  id: number;
  session_id: number | null;
  title: string;
  content: string;
  created_at: string;
}

function db(): Database.Database {
  return getDatabase();
}

export function createSessionInDb(d: Database.Database, title: string): number {
  const r = d.prepare('INSERT INTO ai_sessions (title) VALUES (?)').run(title);
  return Number(r.lastInsertRowid);
}

export function listSessionsInDb(d: Database.Database): AiSession[] {
  return d.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.session_id = s.id) as message_count
    FROM ai_sessions s ORDER BY s.updated_at DESC, s.id DESC
  `).all() as AiSession[];
}

export function deleteSessionInDb(d: Database.Database, id: number): boolean {
  return d.prepare('DELETE FROM ai_sessions WHERE id = ?').run(id).changes > 0;
}

export function appendMessageInDb(d: Database.Database, sessionId: number, role: 'user' | 'assistant', content: string): number {
  const r = d.prepare(
    "INSERT INTO ai_messages (session_id, role, content) VALUES (?, ?, ?)"
  ).run(sessionId, role, content);
  d.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  return Number(r.lastInsertRowid);
}

export function listMessagesInDb(d: Database.Database, sessionId: number): AiMessage[] {
  return d.prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY id ASC').all(sessionId) as AiMessage[];
}

export function saveReportInDb(d: Database.Database, sessionId: number | null, title: string, content: string): number {
  const r = d.prepare(
    'INSERT INTO ai_reports (session_id, title, content) VALUES (?, ?, ?)'
  ).run(sessionId, title, content);
  return Number(r.lastInsertRowid);
}

export function listReportsInDb(d: Database.Database): AiReport[] {
  return d.prepare('SELECT * FROM ai_reports ORDER BY created_at DESC, id DESC').all() as AiReport[];
}

export function getReportInDb(d: Database.Database, id: number): AiReport | undefined {
  return d.prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as AiReport | undefined;
}

export function deleteReportInDb(d: Database.Database, id: number): boolean {
  return d.prepare('DELETE FROM ai_reports WHERE id = ?').run(id).changes > 0;
}

// ── 薄封装（生产单例） ──

export function createSession(title: string): number {
  return createSessionInDb(db(), title);
}

export function listSessions(): AiSession[] {
  return listSessionsInDb(db());
}

export function deleteSession(id: number): boolean {
  return deleteSessionInDb(db(), id);
}

export function appendMessage(sessionId: number, role: 'user' | 'assistant', content: string): number {
  return appendMessageInDb(db(), sessionId, role, content);
}

export function listMessages(sessionId: number): AiMessage[] {
  return listMessagesInDb(db(), sessionId);
}

export function saveReport(sessionId: number | null, title: string, content: string): number {
  return saveReportInDb(db(), sessionId, title, content);
}

export function listReports(): AiReport[] {
  return listReportsInDb(db());
}

export function getReport(id: number): AiReport | undefined {
  return getReportInDb(db(), id);
}

export function deleteReport(id: number): boolean {
  return deleteReportInDb(db(), id);
}

/** 简单 Markdown → HTML（PDF 导出用；转义防注入，支持标题/粗体/列表/代码/表格/引用） */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      if (inCode) { out.push('</pre>'); inCode = false; }
      else { out.push('<pre>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) { out.push('</ul>'); inList = false; }
      const level = h[1].length;
      out.push(`<h${level}>${esc(h[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${esc(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.startsWith('|')) {
      out.push(`<div>${esc(line)}</div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${esc(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (!line.trim()) { out.push('<div style="height:8px"></div>'); continue; }
    const bold = esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    out.push(`<p>${bold}</p>`);
  }
  if (inCode) out.push('</pre>');
  if (inList) out.push('</ul>');
  return out.join('\n');
}

/** 将会话消息组装为 Markdown 报告文本 */
export function sessionToMarkdown(sessionTitle: string, messages: AiMessage[]): string {
  const parts: string[] = [`# ${sessionTitle}`, ''];
  for (const m of messages) {
    parts.push(m.role === 'user' ? `**👤 我：**\n\n${m.content}` : `**🤖 AI：**\n\n${m.content}`, '');
  }
  return parts.join('\n');
}
