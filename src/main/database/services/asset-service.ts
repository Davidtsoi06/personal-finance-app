/**
 * Asset service — CRUD operations for assets table.
 */
import { getDatabase } from '../index';
import { computeAssetValuation } from '../../../shared/utils/investment';
import { getAssetCnyTotalsInDb } from './asset-cny-core';

export interface AssetRow {
  id: number;
  name: string;
  code: string;
  type: string;
  market: string;
  currency: string;
  quantity: number;
  cost_price: number;
  current_price: number;
  market_value: number;
  total_cost: number;
  profit_loss: number;
  profit_loss_pct: number;
  account_id: number | null;
  investment_account_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Shared asset sort order used across all list/report/export queries:
 * 港股股票 → A股股票 → 美股股票 → 其他股票 → ETF → 基金 → 黄金 → 加密货币 → 定期存款, each group by code ASC.
 * Note: market (hk_stock/a_stock/us_stock) lives on the `market` column; `type` is stock/fund/etf/...
 */
export const ASSET_SORT_SQL = `CASE
  WHEN type = 'stock' AND market = 'hk_stock' THEN 1
  WHEN type = 'stock' AND market = 'a_stock' THEN 2
  WHEN type = 'stock' AND market = 'us_stock' THEN 3
  WHEN type = 'stock' THEN 4
  WHEN type = 'etf' THEN 5
  WHEN type = 'fund' THEN 6
  WHEN type = 'gold' THEN 7
  WHEN type = 'crypto' THEN 8
  WHEN type = 'fixed_deposit' THEN 9
  ELSE 10
END, code ASC`;

export function listAssets(type?: string): AssetRow[] {
  const db = getDatabase();
  if (type) {
    return db.prepare(`SELECT * FROM assets WHERE type = ? ORDER BY ${ASSET_SORT_SQL}`).all(type) as AssetRow[];
  }
  return db.prepare(`SELECT * FROM assets ORDER BY ${ASSET_SORT_SQL}`).all() as AssetRow[];
}

/** 定存虚拟资产行（并入资产查询面板用） */
export interface AssetRowWithDeposit extends AssetRow {
  account_name?: string;
  maturity_date?: string;
}

/**
 * 全部资产（含定期存款虚拟行）——供资产查询/筛选/排序面板使用。
 * 定期存款存于 fixed_deposits 表，此处转换为 type='fixed_deposit' 的虚拟资产行
 * （市值=本金，盈亏=0，代码 FD），使搜索与类型筛选能覆盖定存。
 */
export function listAllAssets(): AssetRowWithDeposit[] {
  const db = getDatabase();
  const assets = db.prepare(`SELECT * FROM assets ORDER BY ${ASSET_SORT_SQL}`).all() as AssetRow[];

  const fds = db.prepare(`
    SELECT fd.id, fd.account_id, a.name as account_name, fd.amount, fd.currency,
           fd.interest_rate, fd.start_date, fd.maturity_date, fd.notes
    FROM fixed_deposits fd
    JOIN accounts a ON fd.account_id = a.id
    ORDER BY fd.maturity_date ASC
  `).all() as any[];

  const virtual: AssetRowWithDeposit[] = fds.map((fd: any) => ({
    id: fd.id,
    name: `${fd.account_name} · 定期存款${fd.interest_rate ? ` (${fd.interest_rate}%)` : ''}`,
    code: 'FD',
    type: 'fixed_deposit',
    market: 'other',
    currency: fd.currency,
    quantity: 1,
    cost_price: fd.amount,
    current_price: fd.amount,
    market_value: fd.amount,
    total_cost: fd.amount,
    profit_loss: 0,
    profit_loss_pct: 0,
    account_id: fd.account_id,
    investment_account_id: null,
    notes: fd.notes || `${fd.start_date} ~ ${fd.maturity_date}`,
    created_at: '',
    updated_at: '',
    account_name: fd.account_name,
    maturity_date: fd.maturity_date,
  }));

  return [...assets, ...virtual];
}

export function getAsset(id: number): AssetRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
}

export function createAsset(data: {
  name: string;
  code: string;
  type: string;
  market?: string;
  currency?: string;
  quantity: number;
  cost_price: number;
  current_price?: number;
  account_id?: number;
  investmentAccountId?: number;
  notes?: string;
}): AssetRow {
  const db = getDatabase();
  const currentPrice = data.current_price || data.cost_price;
  const { marketValue, totalCost, profitLoss, profitLossPct } =
    computeAssetValuation(data.quantity, data.cost_price, currentPrice);

  const stmt = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, account_id, investment_account_id, notes)
    VALUES (@name, @code, @type, @market, @currency, @quantity, @cost_price, @current_price, @market_value, @total_cost, @profit_loss, @profit_loss_pct, @account_id, @investment_account_id, @notes)
  `);
  const result = stmt.run({
    name: data.name,
    code: data.code,
    type: data.type,
    market: data.market || 'other',
    currency: data.currency || 'CNY',
    quantity: data.quantity,
    cost_price: data.cost_price,
    current_price: currentPrice,
    market_value: marketValue,
    total_cost: totalCost,
    profit_loss: profitLoss,
    profit_loss_pct: profitLossPct,
    account_id: data.account_id || null,
    investment_account_id: data.investmentAccountId || null,
    notes: data.notes || null,
  });
  return getAsset(result.lastInsertRowid as number) as AssetRow;
}

export function updateAsset(id: number, data: Partial<AssetRow>): AssetRow | undefined {
  const db = getDatabase();
  const existing = getAsset(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };

  // Recalculate if quantity or price changed
  if (data.quantity !== undefined || data.current_price !== undefined || data.cost_price !== undefined) {
    const v = computeAssetValuation(merged.quantity, merged.cost_price, merged.current_price);
    merged.market_value = v.marketValue;
    merged.total_cost = v.totalCost;
    merged.profit_loss = v.profitLoss;
    merged.profit_loss_pct = v.profitLossPct;
  }

  db.prepare(`
    UPDATE assets SET name=?, code=?, type=?, market=?, currency=?, quantity=?, cost_price=?, current_price=?, market_value=?, total_cost=?, profit_loss=?, profit_loss_pct=?, account_id=?, investment_account_id=?, notes=?, updated_at=?
    WHERE id=?
  `).run(
    merged.name, merged.code, merged.type, merged.market, merged.currency,
    merged.quantity, merged.cost_price, merged.current_price, merged.market_value,
    merged.total_cost, merged.profit_loss, merged.profit_loss_pct,
    merged.account_id, merged.investment_account_id, merged.notes, merged.updated_at, id
  );

  return getAsset(id);
}

export function deleteAsset(id: number): boolean {
  const db = getDatabase();
  // Also delete related transactions and price history
  db.prepare('DELETE FROM transactions WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM asset_prices WHERE asset_id = ?').run(id);
  const result = db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  return result.changes > 0;
}

/** 全部持仓市值（按持仓币种换算 CNY 后聚合，v1.5.6 修正混币口径） */
export function getTotalMarketValue(currency?: string): number {
  const db = getDatabase();
  const where = currency ? 'WHERE a.currency = ?' : '';
  const args = currency ? [currency] : [];
  return getAssetCnyTotalsInDb(db, where, args).marketValueCny;
}

/** 按持仓币种换算 CNY 的市值/盈亏聚合（供净资产/报表等复用） */
export function getAssetCnyTotals(whereClause = '', args: any[] = []) {
  return getAssetCnyTotalsInDb(getDatabase(), whereClause, args);
}

export function updateCurrentPrice(id: number, price: number): void {
  const db = getDatabase();
  const asset = getAsset(id);
  if (!asset) return;

  const v = computeAssetValuation(asset.quantity, asset.cost_price, price);

  db.prepare(`
    UPDATE assets SET current_price=?, market_value=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime('now')
    WHERE id=?
  `).run(price, v.marketValue, v.profitLoss, v.profitLossPct, id);

  // Record price history
  db.prepare('INSERT INTO asset_prices (asset_id, price, date) VALUES (?, ?, date(\'now\'))').run(id, price);
}
