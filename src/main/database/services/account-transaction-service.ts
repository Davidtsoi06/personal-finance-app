/**
 * Account transaction service — deposit/withdraw records for bank/cash accounts.
 * Each transaction adjusts both the accounts.balance cache AND account_balances.
 * When withdrawing to a linked investment account, cash_balance is auto-tracked.
 */
import { getDatabase } from '../index';
import { updateAccountBalance } from './account-service';
import { addCashBalance, withdrawCashBalance } from './investment-account-service';

export interface AccountTransactionRow {
  id: number;
  account_id: number;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  date: string;
  notes: string | null;
  investment_account_id: number | null;
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

/** Create a deposit or withdraw record, adjusting account balance across both tables */
export function createAccountTransaction(data: {
  account_id: number;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency?: string;
  date?: string;
  notes?: string;
  investment_account_id?: number | null;
}): AccountTransactionRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';
  const sign = data.type === 'deposit' ? 1 : -1;
  const delta = sign * data.amount;

  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, investment_account_id)
      VALUES (@account_id, @type, @amount, @currency, @date, @notes, @investment_account_id)
    `);
    const result = stmt.run({
      account_id: data.account_id,
      type: data.type,
      amount: data.amount,
      currency,
      date: data.date || new Date().toISOString().slice(0, 10),
      notes: data.notes || null,
      investment_account_id: data.investment_account_id || null,
    });

    // Adjust account balance: deposit adds, withdraw subtracts
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(delta, data.account_id);

    // Also sync multi-currency balances
    updateAccountBalance(data.account_id, currency, delta);

    // Auto-track broker cash: withdraw to investment account → increase cash_balance
    if (data.type === 'withdraw' && data.investment_account_id) {
      addCashBalance(data.investment_account_id, data.amount);
    }

    return result.lastInsertRowid as number;
  });

  const newId = tx();
  return getAccountTransaction(newId) as AccountTransactionRow;
}

export function deleteAccountTransaction(id: number): boolean {
  const db = getDatabase();
  const existing = getAccountTransaction(id);
  if (!existing) return false;

  const tx = db.transaction(() => {
    // Reverse the balance adjustment
    const sign = existing.type === 'deposit' ? -1 : 1;
    const reversed = sign * existing.amount;

    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(reversed, existing.account_id);

    // Also reverse multi-currency balances
    updateAccountBalance(existing.account_id, existing.currency, reversed);

    // Reverse broker cash tracking
    if (existing.type === 'withdraw' && existing.investment_account_id) {
      withdrawCashBalance(existing.investment_account_id, existing.amount);
    }

    const result = db.prepare('DELETE FROM account_transactions WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}

/** Update a transaction, recalculating balances for both old and new values. */
export function updateAccountTransaction(id: number, data: {
  type?: string; amount?: number; currency?: string; date?: string; notes?: string;
}): AccountTransactionRow | undefined {
  const db = getDatabase();
  const existing = getAccountTransaction(id);
  if (!existing) return undefined;

  const newType = (data.type || existing.type) as 'deposit' | 'withdraw';
  const newAmount = data.amount ?? existing.amount;
  const newCurrency = data.currency || existing.currency;
  const newDate = data.date || existing.date;
  const newNotes = data.notes !== undefined ? data.notes : existing.notes;

  const tx = db.transaction(() => {
    // 1. Reverse old balance adjustment
    const oldSign = existing.type === 'deposit' ? -1 : 1;
    const oldReversed = oldSign * existing.amount;
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(oldReversed, existing.account_id);
    updateAccountBalance(existing.account_id, existing.currency, oldReversed);

    // 2. Update the row
    db.prepare(`UPDATE account_transactions SET type=?, amount=?, currency=?, date=?, notes=? WHERE id=?`)
      .run(newType, newAmount, newCurrency, newDate, newNotes, id);

    // 3. Apply new balance adjustment
    const newSign = newType === 'deposit' ? 1 : -1;
    const newDelta = newSign * newAmount;
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(newDelta, existing.account_id);
    updateAccountBalance(existing.account_id, newCurrency, newDelta);
  });

  tx();
  return getAccountTransaction(id);
}
