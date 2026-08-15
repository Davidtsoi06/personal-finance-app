import { describe, it, expect } from 'vitest';
import { roundMoney, roundPct } from '../../src/shared/utils/money';

describe('roundMoney', () => {
  it('四舍五入到分', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1.0);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it('消除浮点累积误差', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(19.99 * 3)).toBe(59.97);
  });

  it('非有限数返回 0', () => {
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });
});

describe('roundPct', () => {
  it('百分比保留两位小数', () => {
    expect(roundPct(12.345)).toBe(12.35);
    expect(roundPct(0)).toBe(0);
    expect(roundPct(NaN)).toBe(0);
  });
});
