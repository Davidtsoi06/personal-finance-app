/**
 * cash-flow-core — 券商现金流水纯 DB 操作（无 electron 依赖，可单元/集成测试）。
 * 现金余额派生规则：cash_balance = Σ(amount)；amount 带符号。
 */
import type Database from 'better-sqlite3';

export type CashFlowType = 'deposit' | 'withdraw' | 'buy' | 'sell' | 'dividend' | 'adjust';

export interface CashFlowInput {
  investmentAccountId: number;
  type: CashFlowType;
  /** 带符号：deposit/sell/dividend 为正；withdraw/buy 为负；adjust 为差额 */
  amount: number;
  assetId?: number | null;
  transactionId?: number | null;
  currency?: string;
  date?: string;
  notes?: string;
}

export interface CashFlowRow {
  id: number;
  investment_account_id: number;
  type: CashFlowType;
  amount: number;
  asset_id: number | null;
  transaction_id: number | null;
  currency: string;
  date: string;
  notes: string | null;
  balance_after: number | null;
  created_at: string;
}

/** 插入一条流水（调用方负责事务与重算） */
export function insertCashFlowInDb(db: Database.Database, data: CashFlowInput): number {
  const result = db.prepare(
    'INSERT INTO investment_cash_flows' +
    ' (investment_account_id, type, amount, asset_id, transaction_id, currency, date, notes)' +
    " VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?)"
  ).run(
    data.investmentAccountId, data.type, data.amount,
    data.assetId ?? null, data.transactionId ?? null,
    data.currency || 'CNY', data.date ?? null, data.notes ?? null
  );
  return Number(result.lastInsertRowid);
}

/**
 * 重算账户现金余额 = Σ flows 并写回 investment_accounts.cash_balance；
 * 顺带重写该账户流水的 balance_after 链（金额变化后的快照一致性）。
 * 注意：不设下限（允许为负）——负数本身就是「现金与股票记录对不上」的信号，对账界面用红色提示。
 */
export function recomputeCashBalanceInDb(db: Database.Database, investmentAccountId: number): number {
  const rows = db.prepare(
    'SELECT id, amount FROM investment_cash_flows WHERE investment_account_id = ? ORDER BY date ASC, id ASC'
  ).all(investmentAccountId) as { id: number; amount: number }[];

  let running = 0;
  const updateFlow = db.prepare('UPDATE investment_cash_flows SET balance_after = ? WHERE id = ?');
  for (const r of rows) {
    running += r.amount;
    updateFlow.run(Math.round(running * 100) / 100, r.id);
  }

  const balance = Math.round(running * 100) / 100;
  db.prepare("UPDATE investment_accounts SET cash_balance = ?, updated_at = datetime('now') WHERE id = ?")
    .run(balance, investmentAccountId);
  return balance;
}

/** 删除某条交易关联的全部流水（交易编辑/删除时冲销旧现金流），返回删除行数 */
export function removeFlowsForTransactionInDb(db: Database.Database, transactionId: number): number {
  const rows = db.prepare('SELECT DISTINCT investment_account_id FROM investment_cash_flows WHERE transaction_id = ?')
    .all(transactionId) as { investment_account_id: number }[];
  const result = db.prepare('DELETE FROM investment_cash_flows WHERE transaction_id = ?').run(transactionId);
  for (const r of rows) recomputeCashBalanceInDb(db, r.investment_account_id);
  return result.changes;
}

/** 同步一条交易的现金流：先删除旧流水，再按最终类型/金额插入（买卖才有现金影响） */
export function syncFlowForTransactionInDb(
  db: Database.Database,
  tx: { id: number; asset_id: number; type: string; quantity: number; price: number; fee: number; total_amount: number; currency: string; date: string },
  asset: { id: number; investment_account_id: number | null; name: string }
): void {
  removeFlowsForTransactionInDb(db, tx.id);
  if (!asset.investment_account_id) return;
  if (tx.type === 'buy') {
    insertCashFlowInDb(db, {
      investmentAccountId: asset.investment_account_id, type: 'buy',
      amount: -(tx.total_amount || tx.quantity * tx.price + tx.fee),
      assetId: asset.id, transactionId: tx.id, currency: tx.currency, date: tx.date,
      notes: '买入 ' + asset.name,
    });
    recomputeCashBalanceInDb(db, asset.investment_account_id);
  } else if (tx.type === 'sell') {
    insertCashFlowInDb(db, {
      investmentAccountId: asset.investment_account_id, type: 'sell',
      amount: tx.total_amount || tx.quantity * tx.price - tx.fee,
      assetId: asset.id, transactionId: tx.id, currency: tx.currency, date: tx.date,
      notes: '卖出 ' + asset.name,
    });
    recomputeCashBalanceInDb(db, asset.investment_account_id);
  }
}
