/**
 * Social obligation service — 人情债 CRUD.
 * Independent of asset/net-worth calculations.
 */
import { getDatabase } from '../index';

export interface SocialObligationRow {
  id: number;
  type: 'owe' | 'owed';
  person: string;
  item: string;
  status: 'pending' | 'done';
  amount: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── CRUD ──

export function listObligations(type?: 'owe' | 'owed'): SocialObligationRow[] {
  const db = getDatabase();
  if (type) {
    return db.prepare(
      'SELECT * FROM social_obligations WHERE type = ? ORDER BY created_at DESC'
    ).all(type) as SocialObligationRow[];
  }
  return db.prepare(
    'SELECT * FROM social_obligations ORDER BY created_at DESC'
  ).all() as SocialObligationRow[];
}

export function getObligation(id: number): SocialObligationRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM social_obligations WHERE id = ?').get(id) as SocialObligationRow | undefined;
}

export function createObligation(data: {
  type: string;
  person: string;
  item: string;
  amount?: number;
  currency?: string;
  notes?: string;
}): SocialObligationRow {
  const db = getDatabase();
  const result = db.prepare(
    `INSERT INTO social_obligations (type, person, item, amount, currency, notes)
     VALUES (@type, @person, @item, @amount, @currency, @notes)`
  ).run({
    type: data.type,
    person: data.person,
    item: data.item,
    amount: data.amount || 0,
    currency: data.currency || 'CNY',
    notes: data.notes || null,
  });
  return getObligation(result.lastInsertRowid as number)!;
}

export function updateObligation(
  id: number,
  data: { person?: string; item?: string; status?: string; amount?: number; currency?: string; notes?: string }
): SocialObligationRow | undefined {
  const db = getDatabase();
  const existing = getObligation(id);
  if (!existing) return undefined;

  const person = data.person ?? existing.person;
  const item = data.item ?? existing.item;
  const status = data.status ?? existing.status;
  const amount = data.amount ?? existing.amount;
  const currency = data.currency ?? existing.currency;
  const notes = data.notes !== undefined ? (data.notes || null) : existing.notes;

  db.prepare(
    `UPDATE social_obligations
     SET person = @person, item = @item, status = @status, amount = @amount, currency = @currency, notes = @notes,
         updated_at = datetime('now')
     WHERE id = @id`
  ).run({ person, item, status, amount, currency, notes, id });
  return getObligation(id);
}

export function deleteObligation(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM social_obligations WHERE id = ?').run(id);
}
