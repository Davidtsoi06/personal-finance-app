import { describe, it, expect } from 'vitest';
import { weightedAvgCost } from '../../src/main/services/report-export-service';

/**
 * v1.8.4：卖出成本基础推算（买入加权平均）纯函数测试。
 */
describe('weightedAvgCost（v1.8.4）', () => {
  it('普通加权平均：Σ净额 ÷ Σ数量', () => {
    const avg = weightedAvgCost([
      { total_amount: 1000, quantity: 100 },
      { total_amount: 1200, quantity: 100 },
    ]);
    expect(avg).toBeCloseTo(11, 4);
  });

  it('空数组 → null', () => {
    expect(weightedAvgCost([])).toBeNull();
  });

  it('数量 ≤ 0 的买入忽略', () => {
    const avg = weightedAvgCost([
      { total_amount: 500, quantity: 0 },
      { total_amount: 300, quantity: -5 },
      { total_amount: 1000, quantity: 100 },
    ]);
    expect(avg).toBeCloseTo(10, 4);
  });

  it('全部无效 → null', () => {
    expect(weightedAvgCost([{ total_amount: 0, quantity: 0 }])).toBeNull();
  });

  it('单笔：均价=该笔含费均价', () => {
    const avg = weightedAvgCost([{ total_amount: 1012.5, quantity: 100 }]);
    expect(avg).toBeCloseTo(10.125, 4);
  });

  it('除不尽时保留 4 位小数（分以下四舍五入）', () => {
    const avg = weightedAvgCost([{ total_amount: 1000, quantity: 3 }]);
    expect(avg).toBeCloseTo(333.3333, 4);
  });
});
