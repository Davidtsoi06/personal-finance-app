import { describe, it, expect } from 'vitest';
import { computeAssetTotals, type AssetTotalsItem } from '../../src/shared/utils/asset-totals';

/** 与 scripts/seed-demo-data.js 演示数据一一对应的资产总览形状（CNY） */
const demoItems: AssetTotalsItem[] = [
  { asset_type: 'e_wallet', is_investment: false, market_value_cny: 5000 },
  { asset_type: 'e_wallet', is_investment: false, market_value_cny: 3000 },
  { asset_type: 'cash', is_investment: false, market_value_cny: 2000 },
  { asset_type: 'insurance', is_investment: false, market_value_cny: 83850 },
  { asset_type: 'bank', is_investment: false, market_value_cny: 367400, children: [
    { asset_type: 'bank', is_investment: false, market_value_cny: 92000 },
    { asset_type: 'investment', is_investment: true, market_value_cny: 225400 },
    { asset_type: 'bank', is_investment: false, market_value_cny: 50000 },
  ] },
  { asset_type: 'bank', is_investment: false, market_value_cny: 50000, children: [
    { asset_type: 'bank', is_investment: false, market_value_cny: 50000 },
  ] },
  { asset_type: 'investment', is_investment: true, market_value_cny: 145000 },
  { asset_type: 'broker_cash', is_investment: false, market_value_cny: 23700, children: [
    { asset_type: 'broker_cash', is_investment: false, market_value_cny: 9200 },
    { asset_type: 'broker_cash', is_investment: false, market_value_cny: 14500 },
  ] },
  { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 33400, children: [
    { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 18400 },
    { asset_type: 'bank_wealth', is_investment: true, market_value_cny: 15000 },
  ] },
];

describe("computeAssetTotals", () => {
  it("演示数据：现金285,850 / 流动金23,700 / 投资403,800 / 总资产713,350", () => {
    const t = computeAssetTotals(demoItems);
    expect(t.totalCash).toBeCloseTo(285850, 2);
    expect(t.totalBrokerCash).toBeCloseTo(23700, 2);
    expect(t.totalInvestments).toBeCloseTo(403800, 2);
    expect(t.totalAssets).toBeCloseTo(713350, 2);
  });

  it("回归：银行组内嵌券商必须计入投资市值（v1.6.1 修复点）", () => {
    const items: AssetTotalsItem[] = [
      { asset_type: 'bank', is_investment: false, market_value_cny: 500000, children: [
        { asset_type: 'bank', is_investment: false, market_value_cny: 300000 },
        { asset_type: 'investment', is_investment: true, market_value_cny: 200000 },
      ] },
    ];
    const t = computeAssetTotals(items);
    expect(t.totalCash).toBeCloseTo(300000, 2);
    expect(t.totalInvestments).toBeCloseTo(200000, 2);
    expect(t.totalAssets).toBeCloseTo(500000, 2);
  });

  it("总资产恒等于所有顶级项 market_value_cny 之和（资产管理页口径一致）", () => {
    const t = computeAssetTotals(demoItems);
    const topSum = demoItems.reduce((s, i) => s + (i.market_value_cny || 0), 0);
    expect(t.totalAssets).toBeCloseTo(topSum, 2);
  });

  it("空数组 → 全部为 0", () => {
    const t = computeAssetTotals([]);
    expect(t.totalCash).toBe(0);
    expect(t.totalInvestments).toBe(0);
    expect(t.totalBrokerCash).toBe(0);
    expect(t.totalAssets).toBe(0);
  });

  it("null/undefined market_value_cny 按 0 处理", () => {
    const t = computeAssetTotals([
      { asset_type: 'cash', is_investment: false, market_value_cny: null },
      { asset_type: 'investment', is_investment: true },
    ]);
    expect(t.totalAssets).toBe(0);
  });

  it("多层嵌套：非投资子项内再嵌投资，同样计入投资市值", () => {
    const items: AssetTotalsItem[] = [
      { asset_type: 'bank', is_investment: false, market_value_cny: 1000, children: [
        { asset_type: 'custom', is_investment: false, market_value_cny: 600, children: [
          { asset_type: 'investment', is_investment: true, market_value_cny: 400 },
        ] },
      ] },
    ];
    const t = computeAssetTotals(items);
    expect(t.totalCash).toBeCloseTo(600, 2);
    expect(t.totalInvestments).toBeCloseTo(400, 2);
    expect(t.totalAssets).toBeCloseTo(1000, 2);
  });
});