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

import { updateAccountBalance } from './account-service';

/**
 * v1.10.14：交易现金流向——券商关联了银行账户（funding_account_id）时，
 * 买入/卖出/分红现金直接增减银行账户余额（多币种桶），不记券商流动金；
 * 未关联银行的券商维持现状（记券商流水并重算流动金）。
 */
export function applyTradeCashToAccountInDb(
  db: Database.Database,
  data: {
    investmentAccountId: number;
    type: CashFlowType;
    amount: number;
    assetId?: number | null;
    transactionId?: number | null;
    currency?: string;
    date?: string;
    notes?: string;
  }
): void {
  const inv = db.prepare('SELECT funding_account_id FROM investment_accounts WHERE id = ?')
    .get(data.investmentAccountId) as { funding_account_id: number | null } | undefined;
  if (inv?.funding_account_id) {
    // v1.10.16：银行内嵌券商——生成带来源标记的银行存取记录（statement_hash=broker:交易id），
    // 银行日结单导入时按同日/同金额/同方向识别该笔并跳过，避免重复计入
    const atType = data.type === 'buy' ? 'withdraw' : 'deposit'; // 买入=取出，卖出/分红=存入
    db.prepare(`
      INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, investment_account_id, statement_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      inv.funding_account_id, atType, Math.abs(data.amount),
      data.currency || 'CNY', data.date || new Date().toISOString().slice(0, 10),
      data.notes || (atType === 'deposit' ? '券商资金到账' : '券商资金转出'),
      data.investmentAccountId, 'broker:' + (data.transactionId ?? ''),
    );
    // 银行余额直达（多币种桶）
    updateAccountBalance(inv.funding_account_id, data.currency || 'CNY', data.amount);
    return;
  }
  insertCashFlowInDb(db, {
    investmentAccountId: data.investmentAccountId, type: data.type,
    amount: data.amount, assetId: data.assetId ?? null, transactionId: data.transactionId ?? null,
    currency: data.currency || 'CNY', date: data.date, notes: data.notes,
  });
  recomputeCashBalanceInDb(db, data.investmentAccountId);
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
  // v1.10.16：删除券商直达银行生成的存取记录，并还原银行余额（编辑/删除交易联动）
  const brokerTxs = db.prepare('SELECT id, account_id, type, amount, currency FROM account_transactions WHERE statement_hash = ?')
    .all('broker:' + transactionId) as { id: number; account_id: number; type: string; amount: number; currency: string }[];
  for (const b of brokerTxs) {
    const delta = b.type === 'deposit' ? -b.amount : b.amount; // 删除存入→减回；删除取出→加回
    updateAccountBalance(b.account_id, b.currency || 'CNY', delta);
    db.prepare('DELETE FROM account_transactions WHERE id = ?').run(b.id);
  }
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
  // v1.10.14：关联银行则现金直达银行余额（编辑/删除交易时同样生效）
  if (tx.type === 'buy') {
    applyTradeCashToAccountInDb(db, {
      investmentAccountId: asset.investment_account_id, type: 'buy',
      amount: -(tx.total_amount || tx.quantity * tx.price + tx.fee),
      assetId: asset.id, transactionId: tx.id, currency: tx.currency, date: tx.date,
      notes: '买入 ' + asset.name,
    });
  } else if (tx.type === 'sell') {
    applyTradeCashToAccountInDb(db, {
      investmentAccountId: asset.investment_account_id, type: 'sell',
      amount: tx.total_amount || tx.quantity * tx.price - tx.fee,
      assetId: asset.id, transactionId: tx.id, currency: tx.currency, date: tx.date,
      notes: '卖出 ' + asset.name,
    });
  }
}
