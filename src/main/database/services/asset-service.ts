/**
 * Asset service — CRUD operations for assets table.
 */
import { getDatabase } from '../index';

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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listAssets(type?: string): AssetRow[] {
  const db = getDatabase();
  if (type) {
    return db.prepare('SELECT * FROM assets WHERE type = ? ORDER BY market_value DESC').all(type) as AssetRow[];
  }
  return db.prepare('SELECT * FROM assets ORDER BY market_value DESC').all() as AssetRow[];
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
  const totalCost = data.quantity * data.cost_price;
  const currentPrice = data.current_price || data.cost_price;
  const marketValue = data.quantity * currentPrice;
  const profitLoss = marketValue - totalCost;
  const profitLossPct = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;

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
  if (data.quantity !== undefined || data.current_price !== undefined) {
    merged.market_value = merged.quantity * merged.current_price;
    merged.total_cost = merged.quantity * merged.cost_price;
    merged.profit_loss = merged.market_value - merged.total_cost;
    merged.profit_loss_pct = merged.total_cost > 0 ? (merged.profit_loss / merged.total_cost) * 100 : 0;
  }

  db.prepare(`
    UPDATE assets SET name=?, code=?, type=?, market=?, currency=?, quantity=?, cost_price=?, current_price=?, market_value=?, total_cost=?, profit_loss=?, profit_loss_pct=?, account_id=?, notes=?, updated_at=?
    WHERE id=?
  `).run(
    merged.name, merged.code, merged.type, merged.market, merged.currency,
    merged.quantity, merged.cost_price, merged.current_price, merged.market_value,
    merged.total_cost, merged.profit_loss, merged.profit_loss_pct,
    merged.account_id, merged.notes, merged.updated_at, id
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

export function getTotalMarketValue(currency?: string): number {
  const db = getDatabase();
  if (currency) {
    const row = db.prepare(
      'SELECT COALESCE(SUM(market_value), 0) as total FROM assets WHERE currency = ?'
    ).get(currency) as any;
    return row.total;
  }
  const row = db.prepare(
    'SELECT COALESCE(SUM(market_value), 0) as total FROM assets'
  ).get() as any;
  return row.total;
}

export function updateCurrentPrice(id: number, price: number): void {
  const db = getDatabase();
  const asset = getAsset(id);
  if (!asset) return;

  const marketValue = asset.quantity * price;
  const profitLoss = marketValue - asset.total_cost;
  const profitLossPct = asset.total_cost > 0 ? (profitLoss / asset.total_cost) * 100 : 0;

  db.prepare(`
    UPDATE assets SET current_price=?, market_value=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime('now')
    WHERE id=?
  `).run(price, marketValue, profitLoss, profitLossPct, id);

  // Record price history
  db.prepare('INSERT INTO asset_prices (asset_id, price, date) VALUES (?, ?, date(\'now\'))').run(id, price);
}
