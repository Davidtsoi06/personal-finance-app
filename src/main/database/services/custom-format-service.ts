/**
 * Custom statement format service — CRUD for user-defined broker statement formats.
 */
import { getDatabase } from '../index';

export interface CustomFormatRow {
  id: number;
  name: string;
  keywords: string;
  column_mapping: string; // JSON array of {position: number, field: string}
  has_header: number;
  created_at: string;
}

export function listCustomFormats(): CustomFormatRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM custom_statement_formats ORDER BY id DESC').all() as CustomFormatRow[];
}

export function createCustomFormat(data: {
  name: string;
  keywords: string;
  column_mapping: string;
  has_header?: number;
}): CustomFormatRow {
  const db = getDatabase();
  const r = db.prepare(`
    INSERT INTO custom_statement_formats (name, keywords, column_mapping, has_header)
    VALUES (?, ?, ?, ?)
  `).run(data.name, data.keywords, data.column_mapping, data.has_header ?? 1);
  return db.prepare('SELECT * FROM custom_statement_formats WHERE id = ?').get(r.lastInsertRowid) as CustomFormatRow;
}

export function deleteCustomFormat(id: number): boolean {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM custom_statement_formats WHERE id = ?').run(id);
  return r.changes > 0;
}
