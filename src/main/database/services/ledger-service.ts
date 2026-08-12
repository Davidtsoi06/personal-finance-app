/**
 * Ledger service — CRUD for daily income/expense records.
 */
import { getDatabase } from '../index';
import { updateAccountBalance } from './account-service';

export interface LedgerRow {
  id: number;
  type: string;
  amount: number;
  currency: string;
  category_id: number;
  subcategory_id: number | null;
  account_id: number | null;
  date: string;
  description: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export function listLedgers(params?: {
  type?: string;
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  accountId?: number;
  limit?: number;
}): LedgerRow[] {
  const db = getDatabase();
  let sql = 'SELECT l.*, c.name as category_name FROM ledgers l LEFT JOIN categories c ON l.category_id = c.id WHERE 1=1';
  const args: any[] = [];

  if (params?.type) {
    sql += ' AND l.type = ?';
    args.push(params.type);
  }
  if (params?.startDate) {
    sql += ' AND l.date >= ?';
    args.push(params.startDate);
  }
  if (params?.endDate) {
    sql += ' AND l.date <= ?';
    args.push(params.endDate);
  }
  if (params?.categoryId) {
    sql += ' AND l.category_id = ?';
    args.push(params.categoryId);
  }
  if (params?.accountId) {
    sql += ' AND l.account_id = ?';
    args.push(params.accountId);
  }

  sql += ' ORDER BY l.date DESC, l.id DESC LIMIT ?';
  args.push(params?.limit || 100);

  return db.prepare(sql).all(...args) as LedgerRow[];
}

export function getLedger(id: number): LedgerRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM ledgers WHERE id = ?').get(id) as LedgerRow | undefined;
}

export function createLedger(data: {
  type: string;
  amount: number;
  currency?: string;
  category_id: number;
  subcategory_id?: number;
  account_id?: number;
  date?: string;
  description: string;
  tags?: string;
}): LedgerRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';

  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO ledgers (type, amount, currency, category_id, subcategory_id, account_id, date, description, tags)
      VALUES (@type, @amount, @currency, @category_id, @subcategory_id, @account_id, @date, @description, @tags)
    `);
    const result = stmt.run({
      type: data.type,
      amount: data.amount,
      currency,
      category_id: data.category_id,
      subcategory_id: data.subcategory_id || null,
      account_id: data.account_id || null,
      date: data.date || new Date().toISOString().slice(0, 10),
      description: data.description,
      tags: data.tags || null,
    });

    // Update account balance — both accounts.balance cache AND account_balances
    if (data.account_id) {
      const sign = data.type === 'income' ? 1 : -1;
      const delta = sign * data.amount;
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(delta, data.account_id);
      updateAccountBalance(data.account_id, currency, delta);
    }

    return result.lastInsertRowid as number;
  });

  const newId = tx();
  return getLedger(newId) as LedgerRow;
}

export function updateLedger(id: number, data: Partial<LedgerRow>): LedgerRow | undefined {
  const db = getDatabase();
  const existing = getLedger(id);
  if (!existing) return undefined;

  const tx = db.transaction(() => {
    // Revert old account balance
    if (existing.account_id) {
      const oldSign = existing.type === 'income' ? 1 : -1;
      const oldDelta = oldSign * existing.amount;
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(oldDelta, existing.account_id);
      updateAccountBalance(existing.account_id, existing.currency || 'CNY', -oldDelta);
    }

    const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
    db.prepare(`
      UPDATE ledgers SET type=?, amount=?, currency=?, category_id=?, subcategory_id=?, account_id=?, date=?, description=?, tags=?, updated_at=?
      WHERE id=?
    `).run(
      merged.type, merged.amount, merged.currency, merged.category_id,
      merged.subcategory_id, merged.account_id, merged.date,
      merged.description, merged.tags, merged.updated_at, id
    );

    // Apply new account balance
    if (merged.account_id) {
      const newSign = merged.type === 'income' ? 1 : -1;
      const newDelta = newSign * merged.amount;
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(newDelta, merged.account_id);
      updateAccountBalance(merged.account_id, (merged.currency as string) || 'CNY', newDelta);
    }
  });

  tx();
  return getLedger(id);
}

export function deleteLedger(id: number): boolean {
  const db = getDatabase();
  const existing = getLedger(id);
  if (!existing) return false;

  const tx = db.transaction(() => {
    // Revert account balance
    if (existing.account_id) {
      const sign = existing.type === 'income' ? 1 : -1;
      const delta = sign * existing.amount;
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(delta, existing.account_id);
      updateAccountBalance(existing.account_id, existing.currency || 'CNY', -delta);
    }

    const result = db.prepare('DELETE FROM ledgers WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}

export function getMonthlySummary(year: number, month: number): { income: number; expense: number } {
  const db = getDatabase();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  const income = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM ledgers WHERE type = 'income' AND date >= ? AND date <= ?"
  ).get(startDate, endDate) as any;

  const expense = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM ledgers WHERE type = 'expense' AND date >= ? AND date <= ?"
  ).get(startDate, endDate) as any;

  return { income: income.total, expense: expense.total };
}
