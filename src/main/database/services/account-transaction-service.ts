/**
 * Account transaction service — deposit/withdraw records for bank/cash accounts.
 * Each transaction adjusts the linked account balance automatically.
 */
import { getDatabase } from '../index';

export interface AccountTransactionRow {
  id: number;
  account_id: number;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
}

/** List transactions for an account, newest first */
export function listAccountTransactions(accountId: number, limit?: number): AccountTransactionRow[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM account_transactions WHERE account_id = ? ORDER BY date DESC, id DESC LIMIT ?')
    .all(accountId, limit || 100) as AccountTransactionRow[];
}

export function getAccountTransaction(id: number): AccountTransactionRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM account_transactions WHERE id = ?').get(id) as AccountTransactionRow | undefined;
}

/** Create a deposit or withdraw record, adjusting account balance */
export function createAccountTransaction(data: {
  account_id: number;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency?: string;
  date?: string;
  notes?: string;
}): AccountTransactionRow {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes)
    VALUES (@account_id, @type, @amount, @currency, @date, @notes)
  `);
  const result = stmt.run({
    account_id: data.account_id,
    type: data.type,
    amount: data.amount,
    currency: data.currency || 'CNY',
    date: data.date || new Date().toISOString().slice(0, 10),
    notes: data.notes || null,
  });

  // Adjust account balance: deposit adds, withdraw subtracts
  const sign = data.type === 'deposit' ? 1 : -1;
  db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
    .run(sign * data.amount, data.account_id);

  return getAccountTransaction(result.lastInsertRowid as number) as AccountTransactionRow;
}

export function deleteAccountTransaction(id: number): boolean {
  const db = getDatabase();
  const existing = getAccountTransaction(id);
  if (!existing) return false;

  // Reverse the balance adjustment
  const sign = existing.type === 'deposit' ? -1 : 1;
  db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
    .run(sign * existing.amount, existing.account_id);

  const result = db.prepare('DELETE FROM account_transactions WHERE id = ?').run(id);
  return result.changes > 0;
}
