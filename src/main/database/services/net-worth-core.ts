/**
 * net-worth-core — 净资产快照的纯 DB 操作（无 electron 依赖，可集成测试）。
 * 口径复用 shared/utils/asset-totals 的 computeAssetTotals（v1.6.1 单一口径源）。
 */
import type Database from 'better-sqlite3';
import { computeAssetTotals, type AssetTotalsItem } from '../../../shared/utils/asset-totals';

export interface NetWorthRow {
  id: number;
  date: string;
  total_cash: number;
  total_investments: number;
  net_worth: number;
  created_at: string;
}

/**
 * 记录今天的净资产快照（按日期 upsert）。
 * total_cash 口径沿用历史列语义：现金及存款 + 券商流动金（现金类资产）。
 * net_worth = 总资产（含券商流动金），与资产总览完全一致。
 */
export function recordNetWorthInDb(db: Database.Database, items: AssetTotalsItem[]): NetWorthRow {
  const today = new Date().toISOString().slice(0, 10);
  const totals = computeAssetTotals(items);
  const totalCash = totals.totalCash + totals.totalBrokerCash;

  db.prepare(`
    INSERT INTO net_worth_history (date, total_cash, total_investments, net_worth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_cash = excluded.total_cash,
      total_investments = excluded.total_investments,
      net_worth = excluded.net_worth,
      created_at = datetime('now')
  `).run(today, totalCash, totals.totalInvestments, totals.totalAssets);

  return {
    id: 0,
    date: today,
    total_cash: totalCash,
    total_investments: totals.totalInvestments,
    net_worth: totals.totalAssets,
    created_at: new Date().toISOString(),
  };
}

/** 最近 N 天快照（按日期升序返回，供走势图直接绘制）。 */
export function getNetWorthHistoryInDb(db: Database.Database, days: number = 30): NetWorthRow[] {
  const rows = db.prepare(
    'SELECT * FROM net_worth_history ORDER BY date DESC LIMIT ?'
  ).all(days) as NetWorthRow[];
  return rows.reverse();
}