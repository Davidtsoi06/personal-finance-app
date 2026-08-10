/**
 * Transaction service — CRUD for investment transaction records.
 */
import { getDatabase } from '../index';
import { updateCurrentPrice } from './asset-service';

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
  const totalAmount = data.quantity * data.price + fee;

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

  // Update the asset's current price after a transaction
  updateCurrentPrice(data.asset_id, data.price);

  return getTransaction(result.lastInsertRowid as number) as TransactionRow;
}

export function deleteTransaction(id: number): boolean {
  const db = getDatabase();
  const tx = getTransaction(id);
  if (!tx) return false;

  // Reverse asset adjustments
  reverseAssetAdjustment(tx);

  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return result.changes > 0;
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
  const newTotalAmount = newQuantity * newPrice + newFee;
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
  });

  tx();
  return getTransaction(id);
}

/** Reverse the asset quantity/cost changes from a transaction. */
function reverseAssetAdjustment(tx: TransactionRow): void {
  const db = getDatabase();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(tx.asset_id) as any;
  if (!asset) return;

  if (tx.type === 'buy') {
    const newQty = Math.max(0, asset.quantity - tx.quantity);
    const newTotalCost = Math.max(0, asset.total_cost - tx.total_amount);
    const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
    db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
      .run(newQty, newTotalCost, newAvgCost, tx.asset_id);
  } else if (tx.type === 'sell') {
    const newQty = asset.quantity + tx.quantity;
    const newTotalCost = asset.total_cost + tx.total_amount;
    const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
    db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
      .run(newQty, newTotalCost, newAvgCost, tx.asset_id);
  }

  // Recalculate derived fields
  updateCurrentPrice(tx.asset_id, asset.current_price || 0);
}

/** Apply a new transaction's asset adjustment. */
function applyAssetAdjustment(assetId: number, type: string, quantity: number, price: number, fee: number): void {
  const db = getDatabase();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;
  if (!asset) return;

  if (type === 'buy') {
    const newQty = asset.quantity + quantity;
    const newTotalCost = asset.total_cost + quantity * price + fee;
    const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
    db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
      .run(newQty, newTotalCost, newAvgCost, assetId);
  } else if (type === 'sell') {
    const newQty = Math.max(0, asset.quantity - quantity);
    const costBasis = asset.cost_price > 0 ? asset.cost_price * quantity : quantity * price;
    const newTotalCost = Math.max(0, asset.total_cost - costBasis);
    const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
    db.prepare(`UPDATE assets SET quantity=?, total_cost=?, cost_price=?, updated_at=datetime('now') WHERE id=?`)
      .run(newQty, newTotalCost, newAvgCost, assetId);
  }
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
