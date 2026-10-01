import { describe, it, expect } from 'vitest';
import { computeRealizedPnl, RealizedPnlTrade } from '../../src/shared/utils/investment';

/** v1.10.21：报表按「代码 + 币种」跨账户合并统计（同一只股票不同券商不再分开） */
describe('computeRealizedPnl 跨账户合并（v1.10.21）', () => {
  const t = (p: Partial<RealizedPnlTrade> & { id: number; date: string }): RealizedPnlTrade => ({
    assetId: 1, code: '00700', name: '腾讯控股', currency: 'HKD',
    type: 'buy', quantity: 0, price: 0, fee: 0, totalAmount: 0, ...p,
  });

  it('同一只股票在两个账户的买卖合并成一行（跨账户加权成本）', () => {
    const r = computeRealizedPnl([
      // 券商A：100 股 @10
      t({ id: 1, assetId: 11, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000, accountName: '券商A' }),
      // 券商B：100 股 @20
      t({ id: 2, assetId: 22, date: '2026-02-05', type: 'buy', quantity: 100, price: 20, totalAmount: 2000, accountName: '券商B' }),
      // 券商A 卖出 100 股 @25
      t({ id: 3, assetId: 11, date: '2026-03-05', type: 'sell', quantity: 100, price: 25, totalAmount: 2500, accountName: '券商A' }),
    ]);
    expect(r.byAsset).toHaveLength(1);
    // 合并口径：均价 15 → 成本基数 1500 → 已实现 1000
    expect(r.byAsset[0].realizedPnl).toBe(1000);
    expect(r.byAsset[0].accountCount).toBe(1); // 只有券商A有卖出
    expect(r.total).toBe(1000);
    // 券商A 独立口径：均价 10 → 已实现 1500（展开行可见）
    expect(r.byAsset[0].accounts[0].accountName).toBe('券商A');
    expect(r.byAsset[0].accounts[0].realizedPnl).toBe(1500);
  });

  it('两个账户都有卖出时，展开明细含两个账户且合计等于合并口径', () => {
    const r = computeRealizedPnl([
      t({ id: 1, assetId: 11, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000, accountName: '券商A' }),
      t({ id: 2, assetId: 22, date: '2026-01-06', type: 'buy', quantity: 100, price: 30, totalAmount: 3000, accountName: '券商B' }),
      t({ id: 3, assetId: 11, date: '2026-03-05', type: 'sell', quantity: 50, price: 40, totalAmount: 2000, accountName: '券商A' }),
      t({ id: 4, assetId: 22, date: '2026-03-06', type: 'sell', quantity: 50, price: 40, totalAmount: 2000, accountName: '券商B' }),
    ]);
    const e = r.byAsset[0];
    expect(e.accountCount).toBe(2);
    expect(e.sellCount).toBe(2);
    expect(e.soldQuantity).toBe(100);
    // 合并口径均价 20 → 成本 100×20=2000 → 已实现 2000
    expect(e.realizedPnl).toBe(2000);
    // 各账户独立口径之和：A 50×(40-10)=1500，B 50×(40-30)=500
    const sum = e.accounts.reduce((s, a) => s + a.realizedPnl, 0);
    expect(sum).toBeCloseTo(2000, 2);
    expect(e.accounts.map((a) => a.accountName).sort()).toEqual(['券商A', '券商B']);
  });

  it('不同币种的同代码仍分开统计', () => {
    const r = computeRealizedPnl([
      t({ id: 1, assetId: 11, date: '2026-01-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100, currency: 'HKD' }),
      t({ id: 2, assetId: 22, date: '2026-01-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100, currency: 'USD' }),
      t({ id: 3, assetId: 11, date: '2026-03-05', type: 'sell', quantity: 10, price: 12, totalAmount: 120, currency: 'HKD' }),
      t({ id: 4, assetId: 22, date: '2026-03-05', type: 'sell', quantity: 10, price: 12, totalAmount: 120, currency: 'USD' }),
    ]);
    expect(r.byAsset).toHaveLength(2);
    expect(r.byAsset.every((e) => e.realizedPnl === 20)).toBe(true);
  });

  it('不同代码各自独立（回归：原有行为不变）', () => {
    const r = computeRealizedPnl([
      t({ id: 1, assetId: 1, code: 'A', name: '甲', date: '2026-01-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100 }),
      t({ id: 2, assetId: 2, code: 'B', name: '乙', date: '2026-01-05', type: 'buy', quantity: 10, price: 10, totalAmount: 100 }),
      t({ id: 3, assetId: 1, code: 'A', name: '甲', date: '2026-03-05', type: 'sell', quantity: 10, price: 12, totalAmount: 120 }),
      t({ id: 4, assetId: 2, code: 'B', name: '乙', date: '2026-03-05', type: 'sell', quantity: 10, price: 15, totalAmount: 150 }),
    ]);
    expect(r.byAsset).toHaveLength(2);
    expect(r.byAsset[0].code).toBe('B'); // 盈利大者在前
    expect(r.total).toBe(70);
  });

  it('清仓后重新买入从新成本起算（合并口径同样成立）', () => {
    const r = computeRealizedPnl([
      t({ id: 1, date: '2026-01-05', type: 'buy', quantity: 100, price: 10, totalAmount: 1000 }),
      t({ id: 2, date: '2026-02-05', type: 'sell', quantity: 100, price: 12, totalAmount: 1200 }),
      t({ id: 3, date: '2026-03-05', type: 'buy', quantity: 100, price: 50, totalAmount: 5000 }),
      t({ id: 4, date: '2026-04-05', type: 'sell', quantity: 100, price: 55, totalAmount: 5500 }),
    ]);
    expect(r.total).toBe(700); // 200 + 500
  });
});
