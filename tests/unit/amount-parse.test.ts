import { describe, it, expect } from 'vitest';
import { parseAmount } from '../../src/shared/utils/amount-parse';

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

  it('非法输入返回 null（不静默 NaN）', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });
});