/**
 * Net worth history — daily snapshots of total assets.
 */
import { getDatabase } from '../index';

export interface NetWorthRow {
  id: number;
  date: string;
  total_cash: number;
  total_investments: number;
  net_worth: number;
  created_at: string;
}

/** Record today's net worth snapshot */
export function recordNetWorth(): NetWorthRow {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  // Calculate totals
  const cash = db.prepare(
    "SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE is_active = 1 AND type != 'credit_card'"
  ).get() as any;
  // For credit cards, subtract the debt
  const creditDebt = db.prepare(
    "SELECT COALESCE(SUM(ABS(balance)), 0) as total FROM accounts WHERE is_active = 1 AND type = 'credit_card' AND balance < 0"
  ).get() as any;

  const investments = db.prepare(
    'SELECT COALESCE(SUM(market_value), 0) as total FROM assets'
  ).get() as any;

  const totalCash = cash.total - creditDebt.total;
  const totalInvestments = investments.total;
  const netWorth = totalCash + totalInvestments;

  // Upsert today's record
  db.prepare(`
    INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_cash = excluded.total_cash,
      total_investments = excluded.total_investments,
      net_worth = excluded.net_worth,
      created_at = datetime('now')
  `).run(today, totalCash, totalInvestments, netWorth);

  return {
    id: 0, date: today, total_cash: totalCash,
    total_investments: totalInvestments, net_worth: netWorth,
    created_at: new Date().toISOString(),
  };
}

/** Get net worth history for the last N days */
export function getNetWorthHistory(days: number = 30): NetWorthRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM net_worth_history ORDER BY date ASC LIMIT ?'
  ).all(days) as NetWorthRow[];
}
