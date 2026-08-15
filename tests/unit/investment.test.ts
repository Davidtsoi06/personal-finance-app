import { describe, it, expect } from 'vitest';
import {
  computeAssetValuation,
  addPosition,
  removePosition,
  applyBuy,
  applySell,
  computeRealizedPnl,
  RealizedPnlTrade,
} from '../../src/shared/utils/investment';

describe('computeAssetValuation', () => {
  it('计算市值/成本/盈亏/盈亏率', () => {
    const v = computeAssetValuation(100, 10, 12.5);
    expect(v.marketValue).toBe(1250);
    expect(v.totalCost).toBe(1000);
    expect(v.profitLoss).toBe(250);
    expect(v.profitLossPct).toBe(25);
  });

  it('零成本时盈亏率为 0（不除零）', () => {
    const v = computeAssetValuation(0, 0, 5);
    expect(v.profitLossPct).toBe(0);
  });

  it('亏损场景', () => {
    const v = computeAssetValuation(100, 12.5, 10);
    expect(v.profitLoss).toBe(-250);
    expect(v.profitLossPct).toBe(-20);
  });
});

describe('加权平均成本（买入/卖出/冲销）', () => {
  const initial = { quantity: 0, totalCost: 0, costPrice: 0 };

  it('两次买入后均价正确', () => {
    const s1 = applyBuy(initial, 100, 10, 5);
    expect(s1.quantity).toBe(100);
    expect(s1.totalCost).toBe(1005);
    expect(s1.costPrice).toBe(10.05);

    const s2 = applyBuy(s1, 100, 12, 0);
    expect(s2.quantity).toBe(200);
    expect(s2.totalCost).toBe(2205);
    expect(s2.costPrice).toBe(11.025); // 均价保留全精度（仅金额舍入）
  });

  it('卖出按持仓均价扣减成本基数，均价不变', () => {
    const s1 = applyBuy(initial, 200, 11.03, 0);
    const s2 = applySell(s1, 100, 15);
    expect(s2.quantity).toBe(100);
    expect(s2.totalCost).toBe(1103);
    expect(s2.costPrice).toBe(11.03);
  });

  it('卖出数量超过持仓时数量不为负', () => {
    const s1 = applyBuy(initial, 10, 5, 0);
    const s2 = applySell(s1, 99, 6);
    expect(s2.quantity).toBe(0);
    expect(s2.totalCost).toBe(0);
    expect(s2.costPrice).toBe(0);
  });

  it('冲销买入与冲销卖出往返一致（允许 1 分内舍入误差）', () => {
    const bought = applyBuy(initial, 100, 10, 2.5);
    const reversed = removePosition(bought, 100, 1002.5);
    expect(reversed.quantity).toBe(0);
    expect(reversed.totalCost).toBe(0);

    const sold = applySell(bought, 50, 12);
    const unSold = addPosition(sold, 50, sold.costPrice * 50);
    expect(unSold.quantity).toBe(100);
    // 逐步舍入策略下往返误差 ≤ 1 分
    expect(Math.abs(unSold.totalCost - bought.totalCost)).toBeLessThanOrEqual(0.01);
  });

  it('均价缺失时卖出退化为成交价基数（兼容旧行为）', () => {
    const odd = { quantity: 50, totalCost: 0, costPrice: 0 };
    const s = applySell(odd, 10, 8);
    expect(s.quantity).toBe(40);
    expect(s.totalCost).toBe(0); // 基数 80 但 totalCost 已为 0 → 取 0
  });
});

describe('computeRealizedPnl 已实现盈亏（重放法）', () => {
  const mk = (p: Partial<RealizedPnlTrade> & { id: number; date: string }): RealizedPnlTrade => ({
    assetId: 1, code: '00700', name: '腾讯控股', currency: 'HKD',
    type: 'buy', quantity: 0, price: 0, fee: 0, totalAmount: 0,
    ...p,
  });

  it('买入含手续费 → 部分卖出：基数含费，盈亏正确', () => {
    const r = computeRealizedPnl([
      mk({ id: 1, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, fee: 5, totalAmount: 1005 }),
      mk({ id: 2, date: '2026-03-08', type: 'sell', quantity: 50, price: 15, fee: 0, totalAmount: 750 }),
    ]);
    // 均价 10.05 → 成本基数 502.5 → 已实现 750 - 502.5 = 247.5
    expect(r.total).toBe(247.5);
    expect(r.byAsset).toHaveLength(1);
    expect(r.byAsset[0].realizedPnl).toBe(247.5);
    expect(r.byAsset[0].soldQuantity).toBe(50);
    expect(r.byAsset[0].sellCount).toBe(1);
  });

  it('两次买入均价后卖出，使用当时均价', () => {
    const r = computeRealizedPnl([
      mk({ id: 1, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000 }),
      mk({ id: 2, date: '2026-02-05', type: 'buy', quantity: 100, price: 20, totalAmount: 2000 }),
      mk({ id: 3, date: '2026-03-05', type: 'sell', quantity: 100, price: 25, totalAmount: 2500 }),
    ]);
    // 均价 15 → 基数 1500 → 已实现 1000
    expect(r.total).toBe(1000);
  });

  it('亏损卖出为负，多笔累计', () => {
    const r = computeRealizedPnl([
      mk({ id: 1, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000 }),
      mk({ id: 2, date: '2026-03-05', type: 'sell', quantity: 40, price: 8, totalAmount: 320 }),
      mk({ id: 3, date: '2026-04-05', type: 'sell', quantity: 60, price: 12, totalAmount: 720 }),
    ]);
    // 40×(8-10) + 60×(12-10) = -80 + 120 = 40
    expect(r.total).toBe(40);
    expect(r.byAsset[0].sellCount).toBe(2);
  });

  it('不同持仓独立重放，按盈亏降序', () => {
    const mkA = (p: Partial<RealizedPnlTrade> & { id: number; date: string }) => mk({ assetId: 1, code: 'A', name: '甲', ...p });
    const mkB = (p: Partial<RealizedPnlTrade> & { id: number; date: string }) => mk({ assetId: 2, code: 'B', name: '乙', ...p });
    const r = computeRealizedPnl([
      mkA({ id: 1, date: '2026-01-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100 }),
      mkA({ id: 3, date: '2026-03-05', type: 'sell', quantity: 10, price: 12, totalAmount: 120 }),
      mkB({ id: 2, date: '2026-02-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100 }),
      mkB({ id: 4, date: '2026-04-05', type: 'sell', quantity: 10, price: 15, totalAmount: 150 }),
    ]);
    expect(r.byAsset).toHaveLength(2);
    expect(r.byAsset[0].code).toBe('B'); // 盈利 50 > 20
    expect(r.total).toBe(70);
  });

  it('split/dividend 与无卖出的持仓不参与', () => {
    const r = computeRealizedPnl([
      mk({ id: 1, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000 }),
      mk({ id: 2, date: '2026-02-05', type: 'dividend', quantity: 0, price: 0, totalAmount: 50 }),
      mk({ id: 3, date: '2026-03-05', type: 'split', quantity: 100, price: 0, totalAmount: 0 }),
    ]);
    expect(r.total).toBe(0);
    expect(r.byAsset).toHaveLength(0);
  });
});
