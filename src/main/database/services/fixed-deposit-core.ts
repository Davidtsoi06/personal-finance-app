/**
 * fixed-deposit-core — 定期存款纯 DB 操作（无 electron 依赖，可集成测试）。
 * v1.6.1：所有资产间联动均询问用户后才执行，并生成存取记录：
 *   - 创建扣款型：扣款同时写存取记录（withdraw）；
 *   - 编辑：balanceMode='sync' 按差额调整并写记录；'record_only' 不调余额并脱钩为纯记录型；
 *   - 删除：restoreBalance=true 退回金额并写记录；false 仅删记录；
 *   - 到期结算（settleFixedDepositInDb）：回款写存款记录 + status='settled'（v17）。
 * v1.9.0：定期全自动体系——
 *   - fixed_deposit_flows 定存流水（存入本金/派息/支取本金/到期本金/到期利息）；
 *   - 内部转账打标 transfer_type（fd_out/fd_in）+ linked_fd_id 关联；
 *   - 日结单驱动：createFixedDepositFromStatementInDb / settleFixedDepositFromStatementInDb；
 *   - 到期利息自动拆分并写入 ledgers「投资收入」（不联动余额，避免重复）。
 */
import type Database from 'better-sqlite3';

export type FixedDepositFlowType = 'principal_in' | 'interest' | 'principal_out' | 'settle_principal' | 'settle_interest';

export interface FixedDepositFlowRow {
  id: number;
  fd_id: number;
  type: FixedDepositFlowType;
  amount: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
}

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
  source: string;
  linked_tx_id: number | null;
  settle_tx_id: number | null;
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

/**
 * 写一条存取记录（联动调整的凭证），v1.9.0 支持内部转账打标/定期关联/防重复指纹；返回记录 id。
 */
function insertAccountTxInDb(
  db: Database.Database,
  accountId: number,
  type: 'deposit' | 'withdraw',
  amount: number,
  currency: string,
  date: string,
  notes: string,
  extra?: { transferType?: 'fd_out' | 'fd_in'; linkedFdId?: number; statementHash?: string }
): number {
  const r = db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, investment_account_id, transfer_type, linked_fd_id, statement_hash)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(accountId, type, amount, currency, date, notes, extra?.transferType ?? null, extra?.linkedFdId ?? null, extra?.statementHash ?? null);
  return Number(r.lastInsertRowid);
}

// ── 定存流水 ──────────────────────────────────────────────

export function insertFlowInDb(
  db: Database.Database,
  data: { fdId: number; type: FixedDepositFlowType; amount: number; currency?: string; date?: string; notes?: string }
): number {
  const r = db.prepare(`
    INSERT INTO fixed_deposit_flows (fd_id, type, amount, currency, date, notes)
    VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?)
  `).run(data.fdId, data.type, data.amount, data.currency || 'CNY', data.date ?? null, data.notes ?? null);
  return Number(r.lastInsertRowid);
}

export function listFlowsInDb(db: Database.Database, fdId: number): FixedDepositFlowRow[] {
  return db.prepare('SELECT * FROM fixed_deposit_flows WHERE fd_id = ? ORDER BY date ASC, id ASC').all(fdId) as FixedDepositFlowRow[];
}

/** 累计已入账利息（派息 + 到期利息），四舍五入到分 */
export function interestEarnedInDb(db: Database.Database, fdId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM fixed_deposit_flows
    WHERE fd_id = ? AND type IN ('interest', 'settle_interest')
  `).get(fdId) as { total: number };
  return Math.round(row.total * 100) / 100;
}

/** 利息落账 ledgers「投资收入」（直接 SQL，不联动账户余额——余额已由回款存取记录调整，避免重复） */
function insertInterestLedgerInDb(
  db: Database.Database,
  data: { accountId: number | null; amount: number; currency: string; date: string; description: string }
): void {
  if (!(data.amount > 0)) return;
  let cat = db.prepare("SELECT id FROM categories WHERE name = '投资收入' AND type = 'income'").get() as { id: number } | undefined;
  if (!cat) {
    const r = db.prepare(
      "INSERT INTO categories (name, type, parent_id, icon, sort_order, is_default) VALUES ('投资收入', 'income', NULL, '💰', 7, 1)"
    ).run();
    cat = { id: Number(r.lastInsertRowid) };
  }
  db.prepare(`
    INSERT INTO ledgers (type, amount, currency, category_id, account_id, date, description)
    VALUES ('income', ?, ?, ?, ?, ?, ?)
  `).run(data.amount, data.currency, cat.id, data.accountId, data.date, data.description);
}

// ── 查询 ──────────────────────────────────────────────────

export function listByAccountInDb(db: Database.Database, accountId: number): FixedDepositRow[] {
  return db.prepare(`
    SELECT fd.*, COALESCE((SELECT ROUND(SUM(f.amount), 2) FROM fixed_deposit_flows f
      WHERE f.fd_id = fd.id AND f.type IN ('interest', 'settle_interest')), 0) as interest_earned
    FROM fixed_deposits fd
    WHERE fd.account_id = ?
    ORDER BY fd.start_date DESC, fd.id DESC
  `).all(accountId) as FixedDepositRow[];
}

export function getFixedDepositInDb(db: Database.Database, id: number): FixedDepositRow | undefined {
  return db.prepare('SELECT * FROM fixed_deposits WHERE id = ?').get(id) as FixedDepositRow | undefined;
}

/**
 * 创建定存。deductMode='deduct'：从 deductAccountId（默认 account_id）扣款并写存取记录（打标 fd_out）；
 * deductMode='record_only'：只落记录，不动任何余额；
 * linkedTxId 提供时（日结单/反向配对）：不扣款，仅打标已有流水为内部转账并关联。
 */
export function createFixedDepositInDb(
  db: Database.Database,
  data: {
    account_id: number;
    amount: number;
    currency?: string;
    interest_rate?: number;
    start_date: string;
    maturity_date?: string;
    notes?: string;
    deductMode?: 'deduct' | 'record_only';
    deductAccountId?: number | null;
    source?: 'manual' | 'statement';
    linkedTxId?: number | null;
  }
): FixedDepositRow {
  const currency = data.currency || 'CNY';
  const amount = data.amount;
  const rate = data.interest_rate || 0;
  const source = data.source || 'manual';
  const linkedTxId = data.linkedTxId || null;
  // 提供关联流水 → 银行侧变动已由该流水代表，定存本身不扣款
  const deductMode = linkedTxId ? 'record_only' : (data.deductMode || 'deduct');
  const deductAccountIdValue = deductMode === 'deduct' ? (data.deductAccountId ?? data.account_id) : null;

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes, deduct_mode, deduct_account_id, source, linked_tx_id)
      VALUES (@account_id, @amount, @currency, @interest_rate, @start_date, @maturity_date, @notes, @deduct_mode, @deduct_account_id, @source, @linked_tx_id)
    `).run({
      account_id: data.account_id,
      amount,
      currency,
      interest_rate: rate,
      start_date: data.start_date,
      maturity_date: data.maturity_date || '',
      notes: data.notes || null,
      deduct_mode: deductMode,
      deduct_account_id: deductAccountIdValue,
      source,
      linked_tx_id: linkedTxId,
    });
    const newId = Number(result.lastInsertRowid);

    if (linkedTxId) {
      db.prepare("UPDATE account_transactions SET transfer_type = 'fd_out', linked_fd_id = ? WHERE id = ?").run(newId, linkedTxId);
    } else if (deductMode === 'deduct') {
      const deductAccount = data.deductAccountId ?? data.account_id;
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(amount, deductAccount);
      updateAccountBalanceInDb(db, deductAccount, currency, -amount);
      const txId = insertAccountTxInDb(db, deductAccount, 'withdraw', amount, currency, data.start_date, `定期存款 · #${newId}`, { transferType: 'fd_out', linkedFdId: newId });
      // 回写流水关联（删除联动/徽章展示用）
      db.prepare('UPDATE fixed_deposits SET linked_tx_id = ? WHERE id = ?').run(txId, newId);
    }

    insertFlowInDb(db, { fdId: newId, type: 'principal_in', amount, currency, date: data.start_date, notes: '存入本金' });
    return newId;
  });

  const newId = tx();
  return getFixedDepositInDb(db, newId) as FixedDepositRow;
}

/** v1.9.0：日结单驱动创建——银行已由导入流水扣款，此处只落定期与本金流水并打标关联。 */
export function createFixedDepositFromStatementInDb(
  db: Database.Database,
  data: { account_id: number; amount: number; currency?: string; start_date: string; linked_tx_id: number | null; notes?: string }
): FixedDepositRow {
  const currency = data.currency || 'CNY';
  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes, deduct_mode, deduct_account_id, source, linked_tx_id)
      VALUES (?, ?, ?, 0, ?, '', ?, 'record_only', NULL, 'statement', ?)
    `).run(data.account_id, data.amount, currency, data.start_date, data.notes || null, data.linked_tx_id);
    const newId = Number(result.lastInsertRowid);
    if (data.linked_tx_id) {
      db.prepare("UPDATE account_transactions SET transfer_type = 'fd_out', linked_fd_id = ? WHERE id = ?").run(newId, data.linked_tx_id);
    }
    insertFlowInDb(db, { fdId: newId, type: 'principal_in', amount: data.amount, currency, date: data.start_date, notes: '存入本金（日结单）' });
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
  const newMaturityDate = data.maturity_date !== undefined ? (data.maturity_date || '') : existing.maturity_date;
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
        insertAccountTxInDb(db, deductAccount, 'deposit', existing.amount, existing.currency, newStartDate, `定期存款币种调整退回 · #${id}`, { transferType: 'fd_in', linkedFdId: id });
        insertAccountTxInDb(db, deductAccount, 'withdraw', newAmount, newCurrency, newStartDate, `定期存款币种调整扣款 · #${id}`, { transferType: 'fd_out', linkedFdId: id });
      } else if (amountDelta !== 0) {
        db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
          .run(amountDelta, deductAccount);
        updateAccountBalanceInDb(db, deductAccount, existing.currency, amountDelta);
        const label = amountDelta > 0 ? '调增退回' : '调减扣款';
        insertAccountTxInDb(db, deductAccount, amountDelta > 0 ? 'deposit' : 'withdraw', Math.abs(amountDelta), existing.currency, newStartDate, `定期存款${label} · #${id}`, { transferType: amountDelta > 0 ? 'fd_in' : 'fd_out', linkedFdId: id });
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

/**
 * 删除定存（询问式）。restoreBalance=true：扣款型退回金额并写记录；false：仅删记录。
 * v1.9.0 linkMode（仅对带关联流水的定存生效）：
 *   'delete_tx'：流水与定期一起删（流水删除即退回资金，定存不再退回）；
 *   'unlink'：仅删定期，保留流水为普通存取记录；
 *   不传：沿用旧逻辑（restoreBalance 退回，关联流水自动脱钩保留）。
 */
export function deleteFixedDepositInDb(
  db: Database.Database,
  id: number,
  restoreBalance: boolean = true,
  linkMode?: 'unlink' | 'delete_tx'
): boolean {
  const existing = getFixedDepositInDb(db, id);
  if (!existing) return false;
  // v1.8.1：已结算定存状态不可逆，禁止删除（防回滚）
  if (existing.status === 'settled') {
    throw new Error('已结算的定期存款不可删除');
  }

  const tx = db.transaction(() => {
    if (existing.linked_tx_id != null && linkMode) {
      if (linkMode === 'delete_tx') {
        const ltx = db.prepare('SELECT * FROM account_transactions WHERE id = ?').get(existing.linked_tx_id) as any;
        if (ltx) {
          const sign = ltx.type === 'deposit' ? -1 : 1;
          db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
            .run(sign * ltx.amount, ltx.account_id);
          updateAccountBalanceInDb(db, ltx.account_id, ltx.currency, sign * ltx.amount);
          db.prepare('DELETE FROM account_transactions WHERE id = ?').run(ltx.id);
        }
      } else {
        // unlink：保留流水为普通存取记录
        db.prepare("UPDATE account_transactions SET transfer_type = NULL, linked_fd_id = NULL WHERE id = ?").run(existing.linked_tx_id);
      }
    } else if (existing.deduct_mode === 'deduct' && restoreBalance) {
      const deductAccount = existing.deduct_account_id ?? existing.account_id;
      db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(existing.amount, deductAccount);
      updateAccountBalanceInDb(db, deductAccount, existing.currency, existing.amount);
      insertAccountTxInDb(db, deductAccount, 'deposit', existing.amount, existing.currency, existing.maturity_date, `定期存款删除退回 · #${id}`);
      // 原转出流水脱钩（资金已退回，防悬挂关联）
      db.prepare("UPDATE account_transactions SET transfer_type = NULL, linked_fd_id = NULL WHERE linked_fd_id = ?").run(id);
    } else if (existing.linked_tx_id != null) {
      // 旧路径（无 linkMode）且带关联：脱钩保留流水，余额不动
      db.prepare("UPDATE account_transactions SET transfer_type = NULL, linked_fd_id = NULL WHERE id = ?").run(existing.linked_tx_id);
    }

    db.prepare('DELETE FROM fixed_deposit_flows WHERE fd_id = ?').run(id);
    const result = db.prepare('DELETE FROM fixed_deposits WHERE id = ?').run(id);
    return result.changes > 0;
  });

  return tx();
}

/**
 * 到期结算（询问式回款）：写存款记录 + 利息拆分落账 + status='settled'（幂等）。
 * v1.9.0：利息 = 回款额 − 本金，写 settle_principal / settle_interest 流水，
 * 利息 > 0 时同步写入收支账本「投资收入」（不联动余额）。
 */
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
  const principal = existing.amount;
  const interest = Math.round((data.amount - principal) * 100) / 100;

  const tx = db.transaction(() => {
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(data.amount, data.toAccountId);
    updateAccountBalanceInDb(db, data.toAccountId, currency, data.amount);
    const txId = insertAccountTxInDb(db, data.toAccountId, 'deposit', data.amount, currency, date, `定期存款到期回款 · #${id}`, { transferType: 'fd_in', linkedFdId: id });

    insertFlowInDb(db, { fdId: id, type: 'settle_principal', amount: principal, currency, date, notes: '到期本金回款' });
    if (interest !== 0) {
      insertFlowInDb(db, { fdId: id, type: 'settle_interest', amount: interest, currency, date, notes: '到期利息' });
    }
    insertInterestLedgerInDb(db, {
      accountId: data.toAccountId, amount: interest > 0 ? interest : 0, currency, date,
      description: `定期存款 #${id} 到期利息`,
    });

    db.prepare("UPDATE fixed_deposits SET status='settled', settle_tx_id=?, updated_at=datetime('now') WHERE id = ?").run(txId, id);
  });

  tx();
  return getFixedDepositInDb(db, id);
}

/**
 * v1.9.0：日结单驱动结算——银行已由导入流水入账，此处只拆分本金/利息流水、写投资收入、标记已结算。
 * 幂等：已结算返回 undefined（调用方视为重复回款）。
 */
export function settleFixedDepositFromStatementInDb(
  db: Database.Database,
  fdId: number,
  data: { creditAmount: number; date: string; linked_tx_id?: number | null }
): { principal: number; interest: number } | undefined {
  const existing = getFixedDepositInDb(db, fdId);
  if (!existing) return undefined;
  if (existing.status === 'settled') return undefined;

  const principal = existing.amount;
  const interest = Math.round((data.creditAmount - principal) * 100) / 100;
  const date = data.date || existing.maturity_date || existing.start_date;

  const tx = db.transaction(() => {
    insertFlowInDb(db, { fdId, type: 'settle_principal', amount: principal, currency: existing.currency, date, notes: '到期本金回款（日结单）' });
    if (interest !== 0) {
      insertFlowInDb(db, { fdId, type: 'settle_interest', amount: interest, currency: existing.currency, date, notes: '到期利息（日结单）' });
    }
    insertInterestLedgerInDb(db, {
      accountId: existing.account_id, amount: interest > 0 ? interest : 0, currency: existing.currency, date,
      description: `定期存款 #${fdId} 到期利息`,
    });
    db.prepare("UPDATE fixed_deposits SET status='settled', maturity_date=?, settle_tx_id=?, updated_at=datetime('now') WHERE id = ?")
      .run(date, data.linked_tx_id ?? null, fdId);
  });

  tx();
  return { principal, interest };
}
