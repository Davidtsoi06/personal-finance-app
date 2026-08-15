/**
 * Investment account service — brokerage accounts that hold assets.
 */
import { getDatabase } from '../index';
import type { TransactionRow } from './transaction-service';
import { ASSET_SORT_SQL } from './asset-service';

export interface InvestmentAccountRow {
  id: number;
  name: string;
  broker: string | null;
  currency: string;
  account_number: string | null;
  funding_account_id: number | null;
  cash_balance: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listInvestmentAccounts(): InvestmentAccountRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM investment_accounts ORDER BY id').all() as InvestmentAccountRow[];
}

export function getInvestmentAccount(id: number): InvestmentAccountRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(id) as InvestmentAccountRow | undefined;
}

export function createInvestmentAccount(data: {
  name: string;
  broker?: string;
  currency?: string;
  account_number?: string;
  funding_account_id?: number;
  cash_balance?: number;
  notes?: string;
}): InvestmentAccountRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO investment_accounts (name, broker, currency, account_number, funding_account_id, cash_balance, notes)
    VALUES (@name, @broker, @currency, @account_number, @funding_account_id, @cash_balance, @notes)
  `);
  const result = stmt.run({
    name: data.name,
    broker: data.broker || null,
    currency: data.currency || 'CNY',
    account_number: data.account_number || null,
    funding_account_id: data.funding_account_id || null,
    cash_balance: data.cash_balance || 0,
    notes: data.notes || null,
  });
  return getInvestmentAccount(result.lastInsertRowid as number) as InvestmentAccountRow;
}

export function updateInvestmentAccount(id: number, data: Partial<InvestmentAccountRow>): InvestmentAccountRow | undefined {
  const db = getDatabase();
  const existing = getInvestmentAccount(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE investment_accounts SET name=?, broker=?, currency=?, account_number=?, funding_account_id=?, cash_balance=?, notes=?, updated_at=?
    WHERE id=?
  `).run(merged.name, merged.broker, merged.currency, merged.account_number, merged.funding_account_id, merged.cash_balance ?? 0, merged.notes, merged.updated_at, id);
  return getInvestmentAccount(id);
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export function deleteInvestmentAccount(id: number): DeleteResult {
  const db = getDatabase();
  const existing = getInvestmentAccount(id);
  if (!existing) return { success: false, error: '投资账户不存在' };

  // Check for linked holdings
  const holdingCount = db.prepare(
    'SELECT COUNT(*) as count FROM assets WHERE investment_account_id = ?'
  ).get(id) as { count: number };

  // Unlink assets
  db.prepare('UPDATE assets SET investment_account_id = NULL WHERE investment_account_id = ?').run(id);
  const result = db.prepare('DELETE FROM investment_accounts WHERE id = ?').run(id);
  return {
    success: result.changes > 0,
    error: result.changes > 0 ? undefined : '删除失败',
  };
}

/** Get assets belonging to an investment account (sorted: 港股→A股→…, code ASC). */
export function getAccountHoldings(investmentAccountId: number) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM assets WHERE investment_account_id = ?
    ORDER BY ${ASSET_SORT_SQL}
  `).all(investmentAccountId);
}

/** Daily trade stats — buy/sell counts and realized P&L for today. */
export function getDailyTradeStats(): {
  buyCount: number;
  sellCount: number;
  realizedPnl: number;
  currency: string;
} {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  const buyRow = db.prepare(
    "SELECT COUNT(*) as count FROM transactions WHERE type = 'buy' AND date = ?"
  ).get(today) as { count: number };

  const sells = db.prepare(`
    SELECT t.*, a.cost_price
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.type = 'sell' AND t.date = ?
  `).all(today) as (TransactionRow & { cost_price: number })[];

  // Realized P&L: total_amount (sell value minus fee) - (cost_price × quantity)
  let realizedPnl = 0;
  for (const s of sells) {
    realizedPnl += s.total_amount - s.cost_price * s.quantity;
  }

  return {
    buyCount: buyRow.count,
    sellCount: sells.length,
    realizedPnl,
    currency: 'CNY',
  };
}

/** Get summary stats for an investment account (holdings + cash). */
export function getAccountSummary(id: number) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) as asset_count,
      COALESCE(SUM(market_value), 0) as total_market_value,
      COALESCE(SUM(profit_loss), 0) as total_profit_loss,
      (SELECT cash_balance FROM investment_accounts WHERE id = ?) as cash_balance
    FROM assets WHERE investment_account_id = ?
  `).get(id, id) as any;
  const cashBalance = row?.cash_balance || 0;
  return {
    assetCount: row?.asset_count || 0,
    totalMarketValue: row?.total_market_value || 0,
    totalProfitLoss: row?.total_profit_loss || 0,
    cashBalance,
    /** Holdings market value + cash balance — the real total. */
    totalValue: (row?.total_market_value || 0) + cashBalance,
  };
}

/** Add cash to an investment account (e.g., from bank transfer). */
export function addCashBalance(investmentAccountId: number, amount: number): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE investment_accounts SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?"
  ).run(amount, investmentAccountId);
}

/** Withdraw cash from an investment account. */
export function withdrawCashBalance(investmentAccountId: number, amount: number): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE investment_accounts SET cash_balance = MAX(0, cash_balance - ?), updated_at = datetime('now') WHERE id = ?"
  ).run(amount, investmentAccountId);
}
