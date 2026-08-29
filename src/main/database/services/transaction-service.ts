/**
 * Transaction service — CRUD for investment transaction records.
 */
import { getDatabase } from '../index';
import { updateCurrentPrice, recomputeDerivedFields } from './asset-service';
import { recomputeCostBasisFromTrades } from '../../../shared/utils/investment';
import { roundMoney } from '../../../shared/utils/money';
import { syncFlowForTransactionInDb, removeFlowsForTransactionInDb } from './cash-flow-core';

export interface TransactionRow {
  id: number;
  asset_id: number;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  total_amount: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
}

export function listTransactions(assetId?: number, limit?: number): TransactionRow[] {
  const db = getDatabase();
  if (assetId) {
    return db
      .prepare('SELECT * FROM transactions WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT ?')
      .all(assetId, limit || 50) as TransactionRow[];
  }
  return db
    .prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ?')
    .all(limit || 50) as TransactionRow[];
}

export function getTransaction(id: number): TransactionRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
}

export function createTransaction(data: {
  asset_id: number;
  type: string;
  quantity: number;
  price: number;
  fee?: number;
  currency?: string;
  date?: string;
  notes?: string;
}): TransactionRow {
  const db = getDatabase();
  const fee = data.fee || 0;
  // v1.7.1 修复：卖出净额 = 数量×价格 − 手续费（买入才加手续费）
  const totalAmount = roundMoney(data.type === 'sell'
    ? data.quantity * data.price - fee
    : data.quantity * data.price + fee);

  const run = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
      VALUES (@asset_id, @type, @quantity, @price, @fee, @total_amount, @currency, @date, @notes)
    `);
    const result = stmt.run({
      asset_id: data.asset_id,
      type: data.type,
      quantity: data.quantity,
      price: data.price,
      fee,
      total_amount: totalAmount,
      currency: data.currency || 'CNY',
      date: data.date || new Date().toISOString().slice(0, 10),
      notes: data.notes || null,
    });

    // 现金流同步（买入扣现金 / 卖出回笼现金）
    const txRow = getTransaction(result.lastInsertRowid as number) as TransactionRow;
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(data.asset_id) as any;
    if (asset) syncFlowForTransactionInDb(db, txRow, asset);

    // Update the asset's current price after a transaction
    updateCurrentPrice(data.asset_id, data.price);

    return result.lastInsertRowid as number;
  });

  return getTransaction(run()) as TransactionRow;
}

export function deleteTransaction(id: number): boolean {
  const db = getDatabase();
  const tx = getTransaction(id);
  if (!tx) return false;

  const run = db.transaction(() => {
    // 删除关联现金流并重算余额（须先于交易删除，外键引用）
    removeFlowsForTransactionInDb(db, tx.id);

    const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    if (result.changes > 0) {
      // v1.10.8：删除后按剩余历史交易重放校准持仓（精确还原，不再流式反转）
      const assetRow = db.prepare('SELECT quantity FROM assets WHERE id = ?').get(tx.asset_id) as { quantity: number } | undefined;
      const expected = assetRow
        ? assetRow.quantity + (tx.type === 'buy' ? -tx.quantity : tx.quantity)
        : undefined;
      reconcileAssetCostBasis(tx.asset_id, expected);
    }
    return result.changes > 0;
  });

  return run();
}

/** Update a transaction, reversing old asset effects and applying new ones. */
export function updateTransaction(id: number, data: {
  type?: string; quantity?: number; price?: number; fee?: number; currency?: string; date?: string; notes?: string;
}): TransactionRow | undefined {
  const db = getDatabase();
  const existing = getTransaction(id);
  if (!existing) return undefined;

  const newType = data.type || existing.type;
  const newQuantity = data.quantity ?? existing.quantity;
  const newPrice = data.price ?? existing.price;
  const newFee = data.fee !== undefined ? data.fee : existing.fee;
  // v1.7.1 修复：卖出 − 手续费，并统一舍入
  const newTotalAmount = roundMoney(newType === 'sell'
    ? newQuantity * newPrice - newFee
    : newQuantity * newPrice + newFee);
  const newCurrency = data.currency || existing.currency;
  const newDate = data.date || existing.date;
  const newNotes = data.notes !== undefined ? data.notes : existing.notes;

  const tx = db.transaction(() => {
    // 1. Update the row
    db.prepare(`UPDATE transactions SET type=?, quantity=?, price=?, fee=?, total_amount=?, currency=?, date=?, notes=? WHERE id=?`)
      .run(newType, newQuantity, newPrice, newFee, newTotalAmount, newCurrency, newDate, newNotes, id);

    // 2. v1.10.8：更新后按全部历史交易重放校准持仓（精确还原，不再流式反转+应用）
    const assetRow = db.prepare('SELECT quantity FROM assets WHERE id = ?').get(existing.asset_id) as { quantity: number } | undefined;
    const expected = assetRow
      ? assetRow.quantity
        + (existing.type === 'buy' ? -existing.quantity : existing.quantity)
        + (newType === 'buy' ? newQuantity : -newQuantity)
      : undefined;
    reconcileAssetCostBasis(existing.asset_id, expected);

    // 3. Update current price
    updateCurrentPrice(existing.asset_id, newPrice);

    // 5. 现金流同步（删除旧流水 + 按最终状态重建）
    const updatedTx = getTransaction(id) as TransactionRow;
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(existing.asset_id) as any;
    if (asset) syncFlowForTransactionInDb(db, updatedTx, asset);
  });

  tx();
  return getTransaction(id);
}

/**
 * v1.10.8：重放校准——按该资产全部历史买卖重算持仓（数量/均价/总成本），
 * 与报表重放（getDailyTrades）和迁移 v21 同口径；任何交易增删改后调用，精确还原。
 *
 * @param expectedQuantityAfter 本次交易后的期望数量（调用方按现数量±本次影响计算）。
 *   与重放数量一致（差≤0.01）→ 直接采用重放结果；不一致说明存在非交易数量变动
 *   （手工调整/拆分/分红）→ 保留期望数量，成本价按重放均价刷新（与 v21 迁移同口径）。
 *   不传（归档等批量场景）→ 直接采用重放结果。
 * - 无交易记录 → 不动（手工成本价保留）
 * - 历史已清仓 → 数量保留（若期望>0）但成本清零（不再残留旧均价）
 * - 之后重算市值/盈亏派生字段（不写价格历史，避免污染走势图）
 */
export function reconcileAssetCostBasis(assetId: number, expectedQuantityAfter?: number): void {
  const db = getDatabase();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;
  if (!asset) return;

  const trades = db.prepare(`
    SELECT id, asset_id, type, quantity, price, fee, total_amount, date
    FROM transactions WHERE asset_id = ? AND type IN ('buy','sell')
    ORDER BY date ASC, id ASC
  `).all(assetId) as any[];
  if (trades.length === 0) return;

  const { quantity, costPrice } = recomputeCostBasisFromTrades(
    trades.map((t) => ({
      id: t.id, assetId: t.asset_id, code: '', name: '', currency: '',
      type: t.type, quantity: t.quantity, price: t.price, fee: t.fee,
      totalAmount: t.total_amount, date: t.date,
    }))
  );

  // 期望数量：与重放一致则采用重放；不一致保留期望（非交易数量变动）；不传则用重放
  let q = quantity;
  if (expectedQuantityAfter !== undefined && Math.abs(quantity - expectedQuantityAfter) > 0.01) {
    q = expectedQuantityAfter;
  }
  if (q < 0.01) q = 0;

  if (quantity <= 0.01) {
    // 历史已清仓：成本清零（修复清仓残留均价）；数量保留期望值（手工重开）或归零
    db.prepare("UPDATE assets SET quantity=?, cost_price=0, total_cost=0, updated_at=datetime('now') WHERE id=?")
      .run(q, assetId);
    recomputeDerivedFields(assetId, asset.current_price || 0);
    return;
  }

  const totalCost = roundMoney(q * costPrice);
  db.prepare("UPDATE assets SET quantity=?, cost_price=?, total_cost=?, updated_at=datetime('now') WHERE id=?")
    .run(q, costPrice, totalCost, assetId);
  recomputeDerivedFields(assetId, asset.current_price || 0);
}

/** Get all today's transactions with asset names. */
export function getTodayTransactions(): (TransactionRow & { assetName: string })[] {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`
    SELECT t.*, a.name as assetName
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date = ?
    ORDER BY t.created_at DESC
  `).all(today) as (TransactionRow & { assetName: string })[];
}
