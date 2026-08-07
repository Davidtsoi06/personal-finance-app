/**
 * Category service — CRUD for ledger categories.
 */
import { getDatabase } from '../index';

export interface CategoryRow {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
  icon: string | null;
  sort_order: number;
  is_default: number;
}

export function listCategories(type?: string): CategoryRow[] {
  const db = getDatabase();
  if (type) {
    return db.prepare('SELECT * FROM categories WHERE type = ? ORDER BY sort_order').all(type) as CategoryRow[];
  }
  return db.prepare('SELECT * FROM categories ORDER BY type, sort_order').all() as CategoryRow[];
}

export function getCategory(id: number): CategoryRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
}

export function createCategory(data: {
  name: string;
  type: string;
  parent_id?: number;
  icon?: string;
  sort_order?: number;
}): CategoryRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO categories (name, type, parent_id, icon, sort_order)
    VALUES (@name, @type, @parent_id, @icon, @sort_order)
  `);
  const result = stmt.run({
    name: data.name,
    type: data.type,
    parent_id: data.parent_id || null,
    icon: data.icon || null,
    sort_order: data.sort_order || 0,
  });
  return getCategory(result.lastInsertRowid as number) as CategoryRow;
}

export function updateCategory(id: number, data: Partial<CategoryRow>): CategoryRow | undefined {
  const db = getDatabase();
  const existing = getCategory(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data };
  db.prepare('UPDATE categories SET name=?, type=?, parent_id=?, icon=?, sort_order=? WHERE id=?')
    .run(merged.name, merged.type, merged.parent_id, merged.icon, merged.sort_order, id);
  return getCategory(id);
}

export function deleteCategory(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM categories WHERE id = ? AND is_default = 0').run(id);
  return result.changes > 0;
}
