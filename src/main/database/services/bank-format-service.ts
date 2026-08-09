/**
 * Bank statement format service — CRUD for user-defined bank statement formats.
 */
import { getDatabase } from '../index';

export interface BankFormatRow {
  id: number;
  name: string;
  keywords: string;
  column_mapping: string; // JSON array of {position: number, field: string}
  has_header: number;
  created_at: string;
}

export function listBankFormats(): BankFormatRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM custom_bank_formats ORDER BY id DESC').all() as BankFormatRow[];
}

export function createBankFormat(data: {
  name: string;
  keywords: string;
  column_mapping: string;
  has_header?: number;
}): BankFormatRow {
  const db = getDatabase();
  const r = db.prepare(`
    INSERT INTO custom_bank_formats (name, keywords, column_mapping, has_header)
    VALUES (?, ?, ?, ?)
  `).run(data.name, data.keywords, data.column_mapping, data.has_header ?? 1);
  return db.prepare('SELECT * FROM custom_bank_formats WHERE id = ?').get(r.lastInsertRowid) as BankFormatRow;
}

export function deleteBankFormat(id: number): boolean {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM custom_bank_formats WHERE id = ?').run(id);
  return r.changes > 0;
}
