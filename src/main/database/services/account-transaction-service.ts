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
  // v1.9.0：关联定期 → 需走联动删除（tx_only/both）；已结算定期回款流水不可删
  const linkedFd = (existing as any).linked_fd_id != null
    ? db.prepare('SELECT * FROM fixed_deposits WHERE id = ?').get((existing as any).linked_fd_id) as any
    : undefined;
  if (linkedFd && linkedFd.status === 'settled') {
    throw new Error('该记录为已结算定期的回款流水，不可删除');
  }
  if (linkedFd) {
    throw new Error(`该记录已关联定期存款 #${linkedFd.id}，请选择联动删除方式`);
  }
  // v1.8.1：定期存款自动生成的联动记录不可直接删除（否则余额与定存状态口径撕裂）
  if (existing.notes && existing.notes.startsWith('定期存款')) {
    throw new Error('该记录由定期存款自动生成，请在定期存款模块处理');
  }

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

/**
 * v1.9.0：定期联动流水删除。
 * tx_only：仅删流水（余额回滚），定期脱钩保留为纯记录型；
 * both：流水与定期一起删（流水删除即退回资金，定期不再退回）。
 */
export function deleteAccountTransactionWithMode(id: number, mode: 'tx_only' | 'both'): boolean {
  const db = getDatabase();
  const existing = getAccountTransaction(id) as any;
  if (!existing) return false;
  const fd = existing.linked_fd_id != null
    ? db.prepare('SELECT * FROM fixed_deposits WHERE id = ?').get(existing.linked_fd_id) as any
    : undefined;
  if (!fd) return deleteAccountTransaction(id);
  if (fd.status === 'settled') {
    throw new Error('该记录为已结算定期的回款流水，不可删除');
  }

  const tx = db.transaction(() => {
    // 撤销流水余额影响
    const sign = existing.type === 'deposit' ? -1 : 1;
    const reversed = sign * existing.amount;
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(reversed, existing.account_id);
    updateAccountBalance(existing.account_id, existing.currency, reversed);
    if (existing.type === 'withdraw' && existing.investment_account_id) {
      withdrawCashBalance(existing.investment_account_id, existing.amount);
    }
    db.prepare('DELETE FROM account_transactions WHERE id = ?').run(id);

    if (mode === 'both') {
      db.prepare('DELETE FROM fixed_deposit_flows WHERE fd_id = ?').run(fd.id);
      db.prepare('DELETE FROM fixed_deposits WHERE id = ?').run(fd.id);
    } else {
      // tx_only：定期保留，转为纯记录型（资金变动已随流水回滚）
      db.prepare("UPDATE fixed_deposits SET linked_tx_id = NULL, deduct_mode = 'record_only', deduct_account_id = NULL WHERE id = ?").run(fd.id);
    }
  });

  tx();
  return true;
}

/**
 * Update a transaction, recalculating balances for both old and new values.
 * v1.6.1：联动询问式——syncBrokerCash=true（用户确认）时同步调整券商流动金：
 *   撤销旧联动（withdraw 扣回）+ 应用新联动（新类型为 withdraw 时增加）；
 * syncBrokerCash=false（用户拒绝）时券商现金不动，并将记录脱钩（investment_account_id 置空）。
 */
export function updateAccountTransaction(
  id: number,
  data: {
    type?: string; amount?: number; currency?: string; date?: string; notes?: string;
  },
  syncBrokerCash: boolean = true
): AccountTransactionRow | undefined {
  const db = getDatabase();
  const existing = getAccountTransaction(id);
  if (!existing) return undefined;
  // v1.9.0：已关联定期的流水禁止直接改（防口径撕裂，请到定期模块修改）
  if ((existing as any).linked_fd_id != null) {
    throw new Error('该记录已关联定期存款，请在定期存款模块修改');
  }

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

    // 2. 联动调整（v1.6.1 询问式）
    if (existing.type === 'withdraw' && existing.investment_account_id) {
      if (syncBrokerCash) {
        // 撤销旧联动：扣回原转入的券商流动金
        withdrawCashBalance(existing.investment_account_id, existing.amount);
      } else {
        // 用户拒绝同步：脱钩，删除此记录时不再自动扣回
      }
    }

    // 3. Update the row（拒绝同步或新类型不再是取出时脱钩）
    const newInvAccountId = syncBrokerCash && newType === 'withdraw' ? existing.investment_account_id : null;
    db.prepare(`UPDATE account_transactions SET type=?, amount=?, currency=?, date=?, notes=?, investment_account_id=? WHERE id=?`)
      .run(newType, newAmount, newCurrency, newDate, newNotes, newInvAccountId, id);

    // 4. Apply new balance adjustment
    const newSign = newType === 'deposit' ? 1 : -1;
    const newDelta = newSign * newAmount;
    db.prepare("UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
      .run(newDelta, existing.account_id);
    updateAccountBalance(existing.account_id, newCurrency, newDelta);

    // 5. 新联动：新类型为取出且用户确认同步时，增加券商流动金
    if (syncBrokerCash && newType === 'withdraw' && existing.investment_account_id) {
      addCashBalance(existing.investment_account_id, newAmount);
    }
  });

  tx();
  return getAccountTransaction(id);
}

// ── Wallet Bill Import (WeChat/Alipay CSV) ──

interface BillRecord {
  date: string;
  type: 'income' | 'expense';
  amount: number;
  currency?: string;
  description: string;
  category?: string;
}

/** Import wallet bills — writes to both account_transactions AND ledgers (dual-write).
 *  v1.8.0：返回写入的存取记录 id 与记账 id，供「撤销」使用。 */
export function importWalletBills(accountId: number, records: BillRecord[]): { imported: number; errors: string[]; txIds: number[]; ledgerIds: number[] } {
  const db = getDatabase();
  let imported = 0;
  const errors: string[] = [];
  const txIds: number[] = [];
  const ledgerIds: number[] = [];

  const insertTx = db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertLedger = db.prepare(`
    INSERT INTO ledgers (type, amount, currency, account_id, date, description, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const rec of records) {
      try {
        const currency = rec.currency || 'CNY';
        const amount = Math.abs(Number(rec.amount) || 0);
        const date = rec.date || new Date().toISOString().slice(0, 10);
        const txType = rec.type === 'income' ? 'deposit' : 'withdraw';

        if (amount <= 0) { errors.push(`金额无效：${rec.description}`); continue; }

        // 1. Write account_transaction
        const txRes = insertTx.run(accountId, txType, amount, currency, date, rec.description);
        txIds.push(Number(txRes.lastInsertRowid));

        // 2. Write ledger (for expense analysis)
        const ledgerType = rec.type === 'income' ? 'income' : 'expense';
        // Look up category by name if provided, else use default
        let categoryId = null;
        if (rec.category) {
          const cat = db.prepare("SELECT id FROM categories WHERE name = ? AND type = ? LIMIT 1").get(rec.category, ledgerType) as any;
          if (cat) categoryId = cat.id;
        }

        const ledgerRes = insertLedger.run(ledgerType, amount, currency, accountId, date, rec.description, categoryId);
        ledgerIds.push(Number(ledgerRes.lastInsertRowid));

        // v1.7.1 修复：同步账户余额（此前导入完全不更新余额）
        updateAccountBalance(accountId, currency, rec.type === 'income' ? amount : -amount);

        imported++;
      } catch (err: any) {
        errors.push(`${rec.description || '未知记录'}：${err.message}`);
      }
    }

    // v1.7.1：余额已由逐条 updateAccountBalance 同步（内部含 CNY 等值重算），
    // 删除旧的「无汇率换算 SUM 覆盖」逻辑。

    return imported;
  });

  tx();
  return { imported, errors, txIds, ledgerIds };
}
