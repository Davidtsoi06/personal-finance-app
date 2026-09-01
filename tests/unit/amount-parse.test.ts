import { describe, it, expect } from 'vitest';
import { parseAmount, deriveTradeFee } from '../../src/shared/utils/amount-parse';

describe('parseAmount（v1.7.1 日结单金额解析）', () => {
  it('千分位逗号', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1,234,567.89')).toBe(1234567.89);
  });

  it('括号负数', () => {
    expect(parseAmount('(100.00)')).toBe(-100);
    expect(parseAmount('(1,200.50)')).toBe(-1200.5);
  });

  it('货币符号与空格', () => {
    expect(parseAmount('¥ 3,000')).toBe(3000);
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('€ 99.9')).toBe(99.9);
    expect(parseAmount('HK$ 1,000.00')).toBe(1000);
  });

  it('普通数字与负数', () => {
    expect(parseAmount('100.5')).toBe(100.5);
    expect(parseAmount('-12.5')).toBe(-12.5);
    expect(parseAmount(0)).toBe(0);
  });

  it('deriveTradeFee（v1.8.3）：数量×价格与发生金额的绝对差推算手续费', () => {
    // 买入：100×345=34500，发生金额 34515（或带负号）→ 费 15
    expect(deriveTradeFee(100, 345, 34515)).toBe(15);
    expect(deriveTradeFee(100, 345, -34515)).toBe(15);
    // 卖出：净额 34485 → 费 15
    expect(deriveTradeFee(100, 345, 34485)).toBe(15);
    // 四舍五入到分
    expect(deriveTradeFee(3, 10.125, 30.5)).toBe(0.13);
    // 非法输入 → 0
    expect(deriveTradeFee(0, 345, 34485)).toBe(0);
    expect(deriveTradeFee(NaN, 345, 34485)).toBe(0);
  });

  it('公式包裹金额（v1.10.11）', () => {
    expect(parseAmount("='-300,000.00'")).toBe(-300000);
    expect(parseAmount('="-300,000.00"')).toBe(-300000);
    expect(parseAmount("='39.00'")).toBe(39);
    expect(parseAmount('==25000')).toBe(25000);
    expect(parseAmount('25000')).toBe(25000);
  });

  it('非法输入返回 null（不静默 NaN）', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });
});