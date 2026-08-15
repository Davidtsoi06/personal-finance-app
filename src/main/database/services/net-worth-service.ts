/**
 * Net worth history — daily snapshots of total assets.
 */
import { getDatabase } from '../index';
import { getAllAssetsSummary } from './account-service';

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

  // v1.6.0 统一口径：直接使用资产总览（getAllAssetsSummary）的合计，
  // 保证净值历史与「资产结构」页总资产/现金/投资市值完全一致。
  const items = getAllAssetsSummary();
  const sumInvestments = (item: any): number =>
    (item.is_investment ? item.market_value_cny || 0 : 0) +
    (item.children || []).reduce((s: number, c: any) => s + sumInvestments(c), 0);
  let totalInvestments = 0;
  let totalCash = 0;
  for (const item of items) {
    if (item.is_investment) {
      totalInvestments += item.market_value_cny || 0;
    } else {
      // 现金类 = 顶级金额 − 内嵌的投资部分（券商流动金等现金类子项不含投资）
      totalCash += (item.market_value_cny || 0) - (item.children || []).reduce((s: number, c: any) => s + sumInvestments(c), 0);
    }
  }
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
