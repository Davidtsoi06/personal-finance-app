/**
 * Account service — CRUD operations for accounts table.
 */
import { getDatabase } from '../index';

export interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string;
  balance: number;
  bank_name: string | null;
  card_number: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function listAccounts(): AccountRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY sort_order, id').all() as AccountRow[];
}

export function getAccount(id: number): AccountRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

export function createAccount(data: {
  name: string;
  type: string;
  currency?: string;
  balance?: number;
  bank_name?: string;
  card_number?: string;
  sort_order?: number;
}): AccountRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO accounts (name, type, currency, balance, bank_name, card_number, sort_order)
    VALUES (@name, @type, @currency, @balance, @bank_name, @card_number, @sort_order)
  `);
  const result = stmt.run({
    name: data.name,
    type: data.type,
    currency: data.currency || 'CNY',
    balance: data.balance || 0,
    bank_name: data.bank_name || null,
    card_number: data.card_number || null,
    sort_order: data.sort_order || 0,
  });
  return getAccount(result.lastInsertRowid as number) as AccountRow;
}

export function updateAccount(id: number, data: Partial<AccountRow>): AccountRow | undefined {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...data, id, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE accounts SET name=?, type=?, currency=?, balance=?, bank_name=?, card_number=?, is_active=?, sort_order=?, updated_at=?
    WHERE id=?
  `).run(
    merged.name, merged.type, merged.currency, merged.balance,
    merged.bank_name, merged.card_number, merged.is_active,
    merged.sort_order, merged.updated_at, id
  );

  return getAccount(id);
}

export function deleteAccount(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getTotalBalance(currency?: string): number {
  const db = getDatabase();
  if (currency) {
    const row = db.prepare(
      'SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE is_active = 1 AND currency = ?'
    ).get(currency) as any;
    return row.total;
  }
  const row = db.prepare(
    'SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE is_active = 1'
  ).get() as any;
  return row.total;
}
