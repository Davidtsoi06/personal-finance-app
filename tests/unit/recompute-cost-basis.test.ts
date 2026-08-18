import { describe, it, expect } from 'vitest';
import { recomputeCostBasisFromTrades, type RealizedPnlTrade } from '../../src/shared/utils/investment';

function t(partial: Partial<RealizedPnlTrade> & { id: number; type: 'buy' | 'sell'; quantity: number; totalAmount: number; date: string }): RealizedPnlTrade {
  return {
    assetId: 1, code: 'X', name: 'X', currency: 'CNY', price: 0, fee: 0,
    ...partial,
  };
}

/** v1.9.1：成本价历史重放（迁移 v21 用） */
describe('recomputeCostBasisFromTrades（v1.9.1）', () => {
  it('单笔买入：含费均价', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 1, type: 'buy', quantity: 100, totalAmount: 1005, date: '2026-01-01' }),
    ]);
    expect(r.quantity).toBeCloseTo(100, 6);
    expect(r.totalCost).toBeCloseTo(1005, 2);
    expect(r.costPrice).toBeCloseTo(10.05, 6);
  });

  it('两笔买入：加权平均', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 1, type: 'buy', quantity: 100, totalAmount: 1000, date: '2026-01-01' }),
      t({ id: 2, type: 'buy', quantity: 100, totalAmount: 1200, date: '2026-01-02' }),
    ]);
    expect(r.quantity).toBeCloseTo(200, 6);
    expect(r.costPrice).toBeCloseTo(11, 6);
    expect(r.totalCost).toBeCloseTo(2200, 2);
  });

  it('卖出冲销：成本基数按当时均价，均价不漂移', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 1, type: 'buy', quantity: 100, totalAmount: 1012.5, date: '2026-01-01' }),
      t({ id: 2, type: 'sell', quantity: 10, price: 12, totalAmount: 120, date: '2026-01-02' }),
      t({ id: 3, type: 'buy', quantity: 50, totalAmount: 500, date: '2026-01-03' }),
    ]);
    // 卖出后：90 股 × 10.125 = 911.25；再买入 50×10 → 140 股 / 1411.25 → 均价 10.080357...
    expect(r.quantity).toBeCloseTo(140, 6);
    expect(r.costPrice).toBeCloseTo(1411.25 / 140, 6);
    expect(r.totalCost).toBeCloseTo(1411.25, 2);
  });

  it('反复买卖后再回到原持仓，成本不被逐步舍入漂移', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 1, type: 'buy', quantity: 3, totalAmount: 30.5, date: '2026-01-01' }),
      t({ id: 2, type: 'sell', quantity: 1, price: 12, totalAmount: 12, date: '2026-01-02' }),
      t({ id: 3, type: 'buy', quantity: 1, totalAmount: 30.5 / 3, date: '2026-01-03' }),
    ]);
    // 3 × 10.1667 ≈ 30.5 → 卖 1 剩 2×10.1667 → 买回 1 → 3 股，总成本 = 30.5
    expect(r.quantity).toBeCloseTo(3, 6);
    expect(r.totalCost).toBeCloseTo(30.5, 2);
    expect(r.costPrice).toBeCloseTo(30.5 / 3, 6);
  });

  it('清仓后数量为 0', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 1, type: 'buy', quantity: 100, totalAmount: 1000, date: '2026-01-01' }),
      t({ id: 2, type: 'sell', quantity: 100, price: 11, totalAmount: 1100, date: '2026-01-02' }),
    ]);
    expect(r.quantity).toBeCloseTo(0, 6);
  });

  it('排序按日期优先、同日按 id（先卖后买的同日顺序正确）', () => {
    const r = recomputeCostBasisFromTrades([
      t({ id: 2, type: 'buy', quantity: 10, totalAmount: 100, date: '2026-01-02' }),
      t({ id: 1, type: 'buy', quantity: 10, totalAmount: 50, date: '2026-01-01' }),
      t({ id: 3, type: 'sell', quantity: 5, price: 9, totalAmount: 45, date: '2026-01-02' }),
    ]);
    // 先 01-01 买 10×5=50 → 01-02 买 10×10=100（均价 7.5）→ 同日卖 5（id 3 > 2）按 7.5 冲销
    expect(r.quantity).toBeCloseTo(15, 6);
    expect(r.costPrice).toBeCloseTo(7.5, 6);
  });

  it('无任何交易 → 全零', () => {
    const r = recomputeCostBasisFromTrades([]);
    expect(r.quantity).toBe(0);
    expect(r.costPrice).toBe(0);
  });
});
