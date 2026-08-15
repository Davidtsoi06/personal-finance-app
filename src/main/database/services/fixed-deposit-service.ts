/**
 * Fixed deposit service — term deposits linked to bank accounts.
 * v1.6.0：资金交互改为询问式——
 *   deduct_mode='deduct'：创建时从 deduct_account_id 扣款，删除恢复，编辑按差额调整；
 *   deduct_mode='record_only'：单纯记录，永不触碰任何账户余额。
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
  deduct_mode: string;
  deduct_account_id: number | null;
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

/**
 * Create a fixed deposit.
 * deductMode='deduct'：从 deductAccountId（默认 account_id）扣款；
 * deductMode='record_only'：只落记录，不动任何余额。
 */
export function createFixedDeposit(data: {
  account_id: number;
  amount: number;
  currency?: string;
  interest_rate?: number;
  start_date: string;
  maturity_date: string;
  notes?: string;
  deductMode?: 'deduct' | 'record_only';
  deductAccountId?: number | null;
}): FixedDepositRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';
  const amount = data.amount;
  const rate = data.interest_rate || 0;
  const deductMode = data.deductMode || 'deduct';
  // 落库的扣款账户：扣款型 = 指定账户（默认归属账户）；纯记录型 = NULL
  const deductAccountIdValue = deductMode === 'deduct' ? (data.deductAccountId ?? data.account_id) : null;

  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes, deduct_mode, deduct_account_id)
      VALUES (@account_id, @amount, @currency, @interest_rate, @start_date, @maturity_date, @notes, @deduct_mode, @deduct_account_id)
    `);
    const result = stmt.run({
      account_id: data.account_id,
      amount,
      currency,
      interest_rate: rate,
      start_date: data.start_date,
      maturity_date: data.maturity_date,
      notes: data.notes || null,
      deduct_mode: deductMode,
      deduct_account_id: deductAccountIdValue,
    });

    // 扣款型：从指定账户扣减（accounts.balance + account_balances）
    if (deductMode === 'deduct') {
      const deductAccount = data.deductAccountId ?? data.account_id;
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(amount, deductAccount);
      updateAccountBalance(deductAccount, currency, -amount);
    }

    return result.lastInsertRowid as number;
  });

  const newId = tx();
  return getFixedDeposit(newId) as FixedDepositRow;
}

/** Update a fixed deposit. 扣款型：金额变化按差额调整扣款账户；纯记录型：只改记录。 */
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
    // 仅扣款型定存调整余额
    if (existing.deduct_mode === 'deduct') {
      const deductAccount = existing.deduct_account_id ?? existing.account_id;
      const amountDelta = existing.amount - newAmount;
      if (amountDelta !== 0) {
        db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
          .run(amountDelta, deductAccount);
        if (newCurrency !== existing.currency) {
          updateAccountBalance(deductAccount, existing.currency, existing.amount);
          updateAccountBalance(deductAccount, newCurrency, -newAmount);
        } else {
          updateAccountBalance(deductAccount, existing.currency, amountDelta);
        }
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

/** Delete a fixed deposit. 扣款型恢复金额到扣款账户；纯记录型只删记录。 */
export function deleteFixedDeposit(id: number): boolean {
  const db = getDatabase();
  const existing = getFixedDeposit(id);
  if (!existing) return false;

  const tx = db.transaction(() => {
    if (existing.deduct_mode === 'deduct') {
      const deductAccount = existing.deduct_account_id ?? existing.account_id;
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(existing.amount, deductAccount);
      updateAccountBalance(deductAccount, existing.currency, existing.amount);
    }

    const result = db.prepare('DELETE FROM fixed_deposits WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}
