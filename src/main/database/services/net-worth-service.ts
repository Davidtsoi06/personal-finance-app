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

  // Calculate cash totals in CNY using account_balances with currency conversion
  const cashRow = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total_cny
    FROM account_balances ab
    JOIN accounts a ON a.id = ab.account_id AND a.is_active = 1 AND a.type != 'credit_card'
    LEFT JOIN currencies c ON ab.currency = c.code
  `).get() as any;
  // For credit cards, subtract the debt (in CNY)
  const creditRow = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total_cny
    FROM account_balances ab
    JOIN accounts a ON a.id = ab.account_id AND a.is_active = 1 AND a.type = 'credit_card' AND a.balance < 0
    LEFT JOIN currencies c ON ab.currency = c.code
  `).get() as any;

  const investments = db.prepare(
    'SELECT COALESCE(SUM(market_value), 0) as total FROM assets'
  ).get() as any;

  const totalCash = (cashRow?.total_cny || 0) - (creditRow?.total_cny || 0);
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
