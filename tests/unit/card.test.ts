import { describe, it, expect } from 'vitest';
import { normalizeCardNumber } from '../../src/shared/utils/card';

describe('normalizeCardNumber 卡号仅存后 4 位', () => {
  it('截取后 4 位', () => {
    expect(normalizeCardNumber('6222021234567890')).toBe('7890');
  });

  it('清除空格与连字符后截取', () => {
    expect(normalizeCardNumber('6222 0212 3456 7890')).toBe('7890');
    expect(normalizeCardNumber('6222-0212-3456-7890')).toBe('7890');
  });

  it('空值返回 null', () => {
    expect(normalizeCardNumber('')).toBeNull();
    expect(normalizeCardNumber(null)).toBeNull();
    expect(normalizeCardNumber(undefined)).toBeNull();
    expect(normalizeCardNumber('   ')).toBeNull();
  });

  it('不足 4 位的卡号原样返回', () => {
    expect(normalizeCardNumber('123')).toBe('123');
  });
});
