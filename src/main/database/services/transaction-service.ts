/**
 * Transaction service — CRUD for investment transaction records.
 */
import { getDatabase } from '../index';
import { updateCurrentPrice } from './asset-service';

export interface TransactionRow {
  id: number;
  asset_id: number;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  total_amount: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
}

export function listTransactions(assetId?: number, limit?: number): TransactionRow[] {
  const db = getDatabase();
  if (assetId) {
    return db
      .prepare('SELECT * FROM transactions WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT ?')
      .all(assetId, limit || 50) as TransactionRow[];
  }
  return db
    .prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ?')
    .all(limit || 50) as TransactionRow[];
}

export function getTransaction(id: number): TransactionRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
}

export function createTransaction(data: {
  asset_id: number;
  type: string;
  quantity: number;
  price: number;
  fee?: number;
  currency?: string;
  date?: string;
  notes?: string;
}): TransactionRow {
  const db = getDatabase();
  const fee = data.fee || 0;
  const totalAmount = data.quantity * data.price + fee;

  const stmt = db.prepare(`
    INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
    VALUES (@asset_id, @type, @quantity, @price, @fee, @total_amount, @currency, @date, @notes)
  `);
  const result = stmt.run({
    asset_id: data.asset_id,
    type: data.type,
    quantity: data.quantity,
    price: data.price,
    fee,
    total_amount: totalAmount,
    currency: data.currency || 'CNY',
    date: data.date || new Date().toISOString().slice(0, 10),
    notes: data.notes || null,
  });

  // Update the asset's current price after a transaction
  updateCurrentPrice(data.asset_id, data.price);

  return getTransaction(result.lastInsertRowid as number) as TransactionRow;
}

export function deleteTransaction(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Get all today's transactions with asset names. */
export function getTodayTransactions(): (TransactionRow & { assetName: string })[] {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`
    SELECT t.*, a.name as assetName
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date = ?
    ORDER BY t.created_at DESC
  `).all(today) as (TransactionRow & { assetName: string })[];
}
