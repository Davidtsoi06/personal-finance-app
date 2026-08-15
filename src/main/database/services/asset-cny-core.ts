/**
 * asset-cny-core — 持仓市值/盈亏按持仓币种换算 CNY 后聚合（无 electron 依赖，可测试）。
 * whereClause/args 仅允许内部常量拼接，禁止用户输入。
 */
import type Database from 'better-sqlite3';

export function getAssetCnyTotalsInDb(
  db: Database.Database,
  whereClause = '',
  args: any[] = []
): { marketValueCny: number; profitLossCny: number; assetCount: number } {
  const row = db.prepare([
    'SELECT',
    'COALESCE(SUM(a.market_value * COALESCE(c.rate_to_base, 1)), 0) as market_value_cny,',
    'COALESCE(SUM(a.profit_loss * COALESCE(c.rate_to_base, 1)), 0) as profit_loss_cny,',
    'COUNT(a.id) as asset_count',
    'FROM assets a',
    'LEFT JOIN currencies c ON a.currency = c.code',
    whereClause,
  ].filter(Boolean).join(' ')).get(...args) as any;
  return {
    marketValueCny: row.market_value_cny || 0,
    profitLossCny: row.profit_loss_cny || 0,
    assetCount: row.asset_count || 0,
  };
}
