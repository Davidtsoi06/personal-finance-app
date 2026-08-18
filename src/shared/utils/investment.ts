/**
 * investment — 持仓成本/盈亏纯函数（加权平均成本法）。
 * 从 transaction-service / asset-service 提取，供两处复用并单元测试。
 * 语义与原有实现保持一致：金额字段输出统一 roundMoney。
 */
import { roundMoney, roundPct } from './money';

export interface AssetState {
  quantity: number;
  totalCost: number;
  costPrice: number;
}

/** 由数量/成本价/现价计算市值、总成本、盈亏与盈亏率（金额四舍五入到分）。 */
export function computeAssetValuation(quantity: number, costPrice: number, currentPrice: number) {
  const marketValue = roundMoney(quantity * currentPrice);
  const totalCost = roundMoney(quantity * costPrice);
  const profitLoss = roundMoney(marketValue - totalCost);
  const profitLossPct = totalCost > 0 ? roundPct((profitLoss / totalCost) * 100) : 0;
  return { marketValue, totalCost, profitLoss, profitLossPct };
}

/** 买入（或冲销卖出）：数量与总成本增加，重算加权平均成本。 */
export function addPosition(state: AssetState, quantity: number, totalAmount: number): AssetState {
  const newQty = state.quantity + quantity;
  // 金额舍入到分；均价是中间比例值，保留全精度（舍入均价会造成买卖冲销漂移）
  const newTotalCost = roundMoney(state.totalCost + totalAmount);
  const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
  return { quantity: newQty, totalCost: newTotalCost, costPrice: newAvgCost };
}

/** 卖出（或冲销买入）：数量与成本基数减少，重算加权平均成本。 */
export function removePosition(state: AssetState, quantity: number, costBasis: number): AssetState {
  const newQty = Math.max(0, state.quantity - quantity);
  const newTotalCost = Math.max(0, roundMoney(state.totalCost - costBasis));
  const newAvgCost = newQty > 0 ? newTotalCost / newQty : 0;
  return { quantity: newQty, totalCost: newTotalCost, costPrice: newAvgCost };
}

/** 买入交易对持仓的影响。 */
export function applyBuy(state: AssetState, quantity: number, price: number, fee: number): AssetState {
  return addPosition(state, quantity, roundMoney(quantity * price + fee));
}

/** 卖出交易对持仓的影响（成本基数 = 持仓均价 × 数量；均价缺失时退化为成交价 × 数量）。 */
export function applySell(state: AssetState, quantity: number, price: number): AssetState {
  const costBasis = state.costPrice > 0 ? state.costPrice * quantity : quantity * price;
  return removePosition(state, quantity, costBasis);
}

// ── 成本基价重算（v1.9.1：迁移 v21 用，按历史交易重放修复漂移的成本价） ──

export interface CostBasisResult {
  quantity: number;
  totalCost: number;
  costPrice: number;
}

/**
 * 由完整买卖历史重放持仓成本：按 (日期, id) 顺序，买入加仓（含费）、卖出按当时均价冲销。
 * 中间均价保留全精度（不逐步舍入均价，防冲销漂移），最终金额出口 roundMoney。
 * split/dividend 不参与（与持仓调整语义一致）。
 */
export function recomputeCostBasisFromTrades(trades: RealizedPnlTrade[]): CostBasisResult {
  const list = trades
    .filter((t) => t.type === 'buy' || t.type === 'sell')
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));

  let state: AssetState = { quantity: 0, totalCost: 0, costPrice: 0 };
  for (const t of list) {
    if (t.type === 'buy') {
      state = addPosition(state, t.quantity, t.totalAmount);
    } else {
      const basis = state.costPrice > 0 ? state.costPrice * t.quantity : t.quantity * t.price;
      state = removePosition(state, t.quantity, basis);
    }
  }
  return { quantity: state.quantity, totalCost: state.totalCost, costPrice: state.costPrice };
}

// ── 已实现盈亏（重放法） ──

export interface RealizedPnlTrade {
  id: number;
  assetId: number;
  code: string;
  name: string;
  currency: string;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  totalAmount: number;
  date: string;
}

export interface RealizedPnlEntry {
  assetId: number;
  code: string;
  name: string;
  currency: string;
  soldQuantity: number;
  costBasis: number;
  netProceeds: number;
  realizedPnl: number;
  sellCount: number;
}

/**
 * 已实现盈亏（重放法）：按时间顺序重放各持仓的买入/卖出，
 * 卖出时以「当时」的加权平均成本为基数：已实现盈亏 = 卖出净额 − 成本基数。
 * 买入成本基数含手续费（totalAmount）；split/dividend 不参与（与现有持仓调整语义一致）。
 */
export function computeRealizedPnl(trades: RealizedPnlTrade[]): { total: number; byAsset: RealizedPnlEntry[] } {
  const byAsset = new Map<number, RealizedPnlTrade[]>();
  for (const t of trades) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const list = byAsset.get(t.assetId);
    if (list) list.push(t);
    else byAsset.set(t.assetId, [t]);
  }

  const entries: RealizedPnlEntry[] = [];
  let total = 0;

  for (const [assetId, list] of byAsset) {
    // 同日期按 id 稳定排序（对应 DB 的 ORDER BY date, id）
    list.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));

    let state: AssetState = { quantity: 0, totalCost: 0, costPrice: 0 };
    let realized = 0;
    let soldQuantity = 0;
    let costBasis = 0;
    let netProceeds = 0;
    let sellCount = 0;

    for (const t of list) {
      if (t.type === 'buy') {
        state = addPosition(state, t.quantity, t.totalAmount);
      } else {
        const basis = state.costPrice > 0 ? state.costPrice * t.quantity : t.quantity * t.price;
        realized += t.totalAmount - basis;
        soldQuantity += t.quantity;
        costBasis += basis;
        netProceeds += t.totalAmount;
        sellCount++;
        state = removePosition(state, t.quantity, basis);
      }
    }

    if (sellCount > 0) {
      const first = list[0];
      entries.push({
        assetId,
        code: first.code,
        name: first.name,
        currency: first.currency,
        soldQuantity,
        costBasis: roundMoney(costBasis),
        netProceeds: roundMoney(netProceeds),
        realizedPnl: roundMoney(realized),
        sellCount,
      });
      total += realized;
    }
  }

  entries.sort((a, b) => b.realizedPnl - a.realizedPnl);
  return { total: roundMoney(total), byAsset: entries };
}
