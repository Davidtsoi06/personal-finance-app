/**
 * Fixed deposit service — term deposits linked to bank accounts.
 * Creating/editing/deleting a fixed deposit adjusts the parent bank account balance.
 */
import { getDatabase } from '../index';
import { updateAccountBalance } from './account-service';

export interface FixedDepositRow {
  id: number;
  account_id: number;
  amount: number;
  currency: string;
  interest_rate: number;
  start_date: string;
  maturity_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listByAccount(accountId: number): FixedDepositRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM fixed_deposits WHERE account_id = ? ORDER BY start_date DESC'
  ).all(accountId) as FixedDepositRow[];
}

export function getFixedDeposit(id: number): FixedDepositRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM fixed_deposits WHERE id = ?').get(id) as FixedDepositRow | undefined;
}

/** Create a fixed deposit and deduct the amount from the linked bank account. */
export function createFixedDeposit(data: {
  account_id: number;
  amount: number;
  currency?: string;
  interest_rate?: number;
  start_date: string;
  maturity_date: string;
  notes?: string;
}): FixedDepositRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';
  const amount = data.amount;
  const rate = data.interest_rate || 0;

  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes)
      VALUES (@account_id, @amount, @currency, @interest_rate, @start_date, @maturity_date, @notes)
    `);
    const result = stmt.run({
      account_id: data.account_id,
      amount,
      currency,
      interest_rate: rate,
      start_date: data.start_date,
      maturity_date: data.maturity_date,
      notes: data.notes || null,
    });

    // Deduct from bank account balance
    db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
      .run(amount, data.account_id);
    updateAccountBalance(data.account_id, currency, -amount);

    return result.lastInsertRowid as number;
  });

  const newId = tx();
  return getFixedDeposit(newId) as FixedDepositRow;
}

/** Update a fixed deposit, adjusting bank balance for amount changes. */
export function updateFixedDeposit(id: number, data: {
  amount?: number;
  currency?: string;
  interest_rate?: number;
  start_date?: string;
  maturity_date?: string;
  notes?: string;
}): FixedDepositRow | undefined {
  const db = getDatabase();
  const existing = getFixedDeposit(id);
  if (!existing) return undefined;

  const newAmount = data.amount ?? existing.amount;
  const newCurrency = data.currency || existing.currency;
  const newRate = data.interest_rate ?? existing.interest_rate;
  const newStartDate = data.start_date || existing.start_date;
  const newMaturityDate = data.maturity_date || existing.maturity_date;
  const newNotes = data.notes !== undefined ? data.notes : existing.notes;

  const tx = db.transaction(() => {
    // If amount changed, adjust bank balance
    const amountDelta = existing.amount - newAmount;
    if (amountDelta !== 0) {
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(amountDelta, existing.account_id);
      // If currency also changed, we need to reverse old and apply new
      if (newCurrency !== existing.currency) {
        updateAccountBalance(existing.account_id, existing.currency, existing.amount);
        updateAccountBalance(existing.account_id, newCurrency, -newAmount);
      } else {
        updateAccountBalance(existing.account_id, existing.currency, amountDelta);
      }
    }

    db.prepare(`
      UPDATE fixed_deposits SET amount=?, currency=?, interest_rate=?, start_date=?, maturity_date=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(newAmount, newCurrency, newRate, newStartDate, newMaturityDate, newNotes, id);
  });

  tx();
  return getFixedDeposit(id);
}

/** Delete a fixed deposit and restore the amount to the linked bank account. */
export function deleteFixedDeposit(id: number): boolean {
  const db = getDatabase();
  const existing = getFixedDeposit(id);
  if (!existing) return false;

  const tx = db.transaction(() => {
    // Restore bank balance
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(existing.amount, existing.account_id);
    updateAccountBalance(existing.account_id, existing.currency, existing.amount);

    const result = db.prepare('DELETE FROM fixed_deposits WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}
