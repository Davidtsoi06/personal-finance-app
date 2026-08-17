/**
 * fixed-deposit-core — 定期存款纯 DB 操作（无 electron 依赖，可集成测试）。
 * v1.6.1：所有资产间联动均询问用户后才执行，并生成存取记录：
 *   - 创建扣款型：扣款同时写存取记录（withdraw）；
 *   - 编辑：balanceMode='sync' 按差额调整并写记录；'record_only' 不调余额并脱钩为纯记录型；
 *   - 删除：restoreBalance=true 退回金额并写记录；false 仅删记录；
 *   - 到期结算（settleFixedDepositInDb）：回款写存款记录 + status='settled'（v17）。
 */
import type Database from 'better-sqlite3';

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
  status: string;
  created_at: string;
  updated_at: string;
}

/** 账户余额 upsert（account_balances）+ 重算 accounts.balance（CNY 等值，与 account-service 一致） */
export function updateAccountBalanceInDb(db: Database.Database, accountId: number, currency: string, delta: number): void {
  const existing = db.prepare(
    'SELECT * FROM account_balances WHERE account_id = ? AND currency = ?'
  ).get(accountId, currency) as { id: number; balance: number } | undefined;

  if (existing) {
    const newBalance = existing.balance + delta;
    if (newBalance === 0) {
      db.prepare('DELETE FROM account_balances WHERE id = ?').run(existing.id);
    } else {
      db.prepare("UPDATE account_balances SET balance = ?, updated_at = datetime('now') WHERE id = ?").run(newBalance, existing.id);
    }
  } else if (delta !== 0) {
    db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)').run(accountId, currency, delta);
  }

  // accounts.balance = 全币种余额按汇率折算的 CNY 合计（与 account-service.updateAccountBalance 一致）
  const row = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total_cny
    FROM account_balances ab
    LEFT JOIN currencies c ON ab.currency = c.code
    WHERE ab.account_id = ?
  `).get(accountId) as { total_cny: number };
  db.prepare("UPDATE accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?").run(row.total_cny, accountId);
}

/** 写一条存取记录（联动调整的凭证） */
function insertAccountTxInDb(
  db: Database.Database,
  accountId: number,
  type: 'deposit' | 'withdraw',
  amount: number,
  currency: string,
  date: string,
  notes: string
): void {
  db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, investment_account_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(accountId, type, amount, currency, date, notes);
}

export function listByAccountInDb(db: Database.Database, accountId: number): FixedDepositRow[] {
  return db.prepare(
    'SELECT * FROM fixed_deposits WHERE account_id = ? ORDER BY start_date DESC'
  ).all(accountId) as FixedDepositRow[];
}

export function getFixedDepositInDb(db: Database.Database, id: number): FixedDepositRow | undefined {
  return db.prepare('SELECT * FROM fixed_deposits WHERE id = ?').get(id) as FixedDepositRow | undefined;
}

/**
 * 创建定存。deductMode='deduct'：从 deductAccountId（默认 account_id）扣款并写存取记录；
 * deductMode='record_only'：只落记录，不动任何余额。
 */
export function createFixedDepositInDb(
  db: Database.Database,
  data: {
    account_id: number;
    amount: number;
    currency?: string;
    interest_rate?: number;
    start_date: string;
    maturity_date: string;
    notes?: string;
    deductMode?: 'deduct' | 'record_only';
    deductAccountId?: number | null;
  }
): FixedDepositRow {
  const currency = data.currency || 'CNY';
  const amount = data.amount;
  const rate = data.interest_rate || 0;
  const deductMode = data.deductMode || 'deduct';
  const deductAccountIdValue = deductMode === 'deduct' ? (data.deductAccountId ?? data.account_id) : null;

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes, deduct_mode, deduct_account_id)
      VALUES (@account_id, @amount, @currency, @interest_rate, @start_date, @maturity_date, @notes, @deduct_mode, @deduct_account_id)
    `).run({
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
    const newId = result.lastInsertRowid as number;

    if (deductMode === 'deduct') {
      const deductAccount = data.deductAccountId ?? data.account_id;
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(amount, deductAccount);
      updateAccountBalanceInDb(db, deductAccount, currency, -amount);
      insertAccountTxInDb(db, deductAccount, 'withdraw', amount, currency, data.start_date, `定期存款 · #${newId}`);
    }

    return newId;
  });

  const newId = tx();
  return getFixedDepositInDb(db, newId) as FixedDepositRow;
}

/**
 * 更新定存（询问式）。balanceMode='sync'：扣款型按差额调整余额并写记录；
 * balanceMode='record_only'：不调余额，脱钩转为纯记录型。
 */
export function updateFixedDepositInDb(
  db: Database.Database,
  id: number,
  data: {
    amount?: number;
    currency?: string;
    interest_rate?: number;
    start_date?: string;
    maturity_date?: string;
    notes?: string;
  },
  balanceMode: 'sync' | 'record_only' = 'sync'
): FixedDepositRow | undefined {
  const existing = getFixedDepositInDb(db, id);
  if (!existing) return undefined;
  // v1.8.1：已结算定存状态不可逆，禁止再编辑
  if (existing.status === 'settled') {
    throw new Error('已结算的定期存款不可修改');
  }

  const newAmount = data.amount ?? existing.amount;
  const newCurrency = data.currency || existing.currency;
  const newRate = data.interest_rate ?? existing.interest_rate;
  const newStartDate = data.start_date || existing.start_date;
  const newMaturityDate = data.maturity_date || existing.maturity_date;
  const newNotes = data.notes !== undefined ? data.notes : existing.notes;

  const tx = db.transaction(() => {
    if (existing.deduct_mode === 'deduct' && balanceMode === 'sync') {
      const deductAccount = existing.deduct_account_id ?? existing.account_id;
      const amountDelta = existing.amount - newAmount;
      const currencyChanged = newCurrency !== existing.currency;

      if (currencyChanged) {
        db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
          .run(existing.amount - newAmount, deductAccount);
        updateAccountBalanceInDb(db, deductAccount, existing.currency, existing.amount);
        updateAccountBalanceInDb(db, deductAccount, newCurrency, -newAmount);
        insertAccountTxInDb(db, deductAccount, 'deposit', existing.amount, existing.currency, newStartDate, `定期存款币种调整退回 · #${id}`);
        insertAccountTxInDb(db, deductAccount, 'withdraw', newAmount, newCurrency, newStartDate, `定期存款币种调整扣款 · #${id}`);
      } else if (amountDelta !== 0) {
        db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
          .run(amountDelta, deductAccount);
        updateAccountBalanceInDb(db, deductAccount, existing.currency, amountDelta);
        const label = amountDelta > 0 ? '调增退回' : '调减扣款';
        insertAccountTxInDb(db, deductAccount, amountDelta > 0 ? 'deposit' : 'withdraw', Math.abs(amountDelta), existing.currency, newStartDate, `定期存款${label} · #${id}`);
      }
    }

    const newDeductMode = existing.deduct_mode === 'deduct' && balanceMode === 'record_only'
      ? 'record_only' : existing.deduct_mode;
    const newDeductAccountId = newDeductMode === 'record_only' ? null : existing.deduct_account_id;

    db.prepare(`
      UPDATE fixed_deposits SET amount=?, currency=?, interest_rate=?, start_date=?, maturity_date=?, notes=?,
        deduct_mode=?, deduct_account_id=?, updated_at=datetime('now')
      WHERE id=?
    `).run(newAmount, newCurrency, newRate, newStartDate, newMaturityDate, newNotes, newDeductMode, newDeductAccountId, id);
  });

  tx();
  return getFixedDepositInDb(db, id);
}

/** 删除定存（询问式）。restoreBalance=true：扣款型退回金额并写记录；false：仅删记录。 */
export function deleteFixedDepositInDb(db: Database.Database, id: number, restoreBalance: boolean = true): boolean {
  const existing = getFixedDepositInDb(db, id);
  if (!existing) return false;
  // v1.8.1：已结算定存状态不可逆，禁止删除（防回滚）
  if (existing.status === 'settled') {
    throw new Error('已结算的定期存款不可删除');
  }

  const tx = db.transaction(() => {
    if (existing.deduct_mode === 'deduct' && restoreBalance) {
      const deductAccount = existing.deduct_account_id ?? existing.account_id;
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(existing.amount, deductAccount);
      updateAccountBalanceInDb(db, deductAccount, existing.currency, existing.amount);
      insertAccountTxInDb(db, deductAccount, 'deposit', existing.amount, existing.currency, existing.maturity_date, `定期存款删除退回 · #${id}`);
    }

    const result = db.prepare('DELETE FROM fixed_deposits WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}

/** 到期结算（询问式回款）：写存款记录 + status='settled'（幂等）。 */
export function settleFixedDepositInDb(
  db: Database.Database,
  id: number,
  data: { amount: number; toAccountId: number; currency?: string; date?: string }
): FixedDepositRow | undefined {
  const existing = getFixedDepositInDb(db, id);
  if (!existing) return undefined;
  if (existing.status === 'settled') return existing;

  const currency = data.currency || existing.currency;
  const date = data.date || existing.maturity_date;

  const tx = db.transaction(() => {
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(data.amount, data.toAccountId);
    updateAccountBalanceInDb(db, data.toAccountId, currency, data.amount);
    insertAccountTxInDb(db, data.toAccountId, 'deposit', data.amount, currency, date, `定期存款到期回款 · #${id}`);

    db.prepare("UPDATE fixed_deposits SET status='settled', updated_at=datetime('now') WHERE id = ?").run(id);
  });

  tx();
  return getFixedDepositInDb(db, id);
}