/**
 * Transaction service — CRUD for investment transaction records.
 */
import { getDatabase } from '../index';
import { updateCurrentPrice, recomputeDerivedFields } from './asset-service';
import { addPosition, removePosition } from '../../../shared/utils/investment';
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
    // Reverse asset adjustments
    reverseAssetAdjustment(tx);

    // 删除关联现金流并重算余额（须先于交易删除，外键引用）
    removeFlowsForTransactionInDb(db, tx.id);

    const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
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
    // 1. Reverse old transaction's asset effect
    reverseAssetAdjustment(existing);

    // 2. Update the row
    db.prepare(`UPDATE transactions SET type=?, quantity=?, price=?, fee=?, total_amount=?, currency=?, date=?, notes=? WHERE id=?`)
      .run(newType, newQuantity, newPrice, newFee, newTotalAmount, newCurrency, newDate, newNotes, id);

    // 3. Apply new transaction's asset effect
    applyAssetAdjustment(existing.asset_id, newType, newQuantity, newPrice, newFee);

    // 4. Update current price
    updateCurrentPrice(existing.asset_id, newPrice);

    // 5. 现金流同步（删除旧流水 + 按最终状态重建）
    const updatedTx = getTransaction(id) as TransactionRow;
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(existing.asset_id) as any;
    if (asset) syncFlowForTransactionInDb(db, updatedTx, asset);
  });

  tx();
  return getTransaction(id);
}

/** Reverse the asset quantity/cost changes from a transaction.（v1.7.1 起导出，供归档冲销复用） */
export function reverseAssetAdjustment(tx: TransactionRow): void {
  const db = getDatabase();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(tx.asset_id) as any;
  if (!asset) return;

  const state = { quantity: asset.quantity, totalCost: asset.total_cost, costPrice: asset.cost_price };
  let next;
  if (tx.type === 'buy') {
    next = removePosition(state, tx.quantity, tx.total_amount);
  } else if (tx.type === 'sell') {
    // v1.7.1 修复：反转卖出应回加「卖出时的成本基数」（均价×数量），而非卖出净额；
    // 均价清仓丢失时退化为 total_amount（净收）。
    const costBasis = asset.cost_price > 0 ? roundMoney(asset.cost_price * tx.quantity) : tx.total_amount;
    next = addPosition(state, tx.quantity, costBasis);
  } else {
    return;
  }
  db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
    .run(next.quantity, next.totalCost, next.costPrice, tx.asset_id);

  // v1.7.1 修复：只重算派生字段，不写价格历史（避免删除/编辑交易污染走势图）
  recomputeDerivedFields(tx.asset_id, asset.current_price || 0);
}

/** Apply a new transaction's asset adjustment. */
function applyAssetAdjustment(assetId: number, type: string, quantity: number, price: number, fee: number): void {
  const db = getDatabase();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;
  if (!asset) return;

  const state = { quantity: asset.quantity, totalCost: asset.total_cost, costPrice: asset.cost_price };
  let next;
  if (type === 'buy') {
    next = addPosition(state, quantity, roundMoney(quantity * price + fee));
  } else if (type === 'sell') {
    const costBasis = asset.cost_price > 0 ? asset.cost_price * quantity : quantity * price;
    next = removePosition(state, quantity, costBasis);
  } else {
    return;
  }
  db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
    .run(next.quantity, next.totalCost, next.costPrice, assetId);
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
