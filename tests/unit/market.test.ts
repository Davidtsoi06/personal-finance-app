import { describe, it, expect } from 'vitest';
import { detectMarket } from '../../src/shared/utils/market';

describe('detectMarket 智能市场检测', () => {
  it('6 位纯数字 → A 股', () => {
    expect(detectMarket('600519')).toBe('a_stock');
    expect(detectMarket('000001')).toBe('a_stock');
  });

  it('1-5 位数字 → 港股', () => {
    expect(detectMarket('700')).toBe('hk_stock');
    expect(detectMarket('9988')).toBe('hk_stock');
    expect(detectMarket('1')).toBe('hk_stock');
  });

  it('1-5 位字母 → 美股', () => {
    expect(detectMarket('AAPL')).toBe('us_stock');
    expect(detectMarket('TSLA')).toBe('us_stock');
  });

  it('显式市场优先', () => {
    expect(detectMarket('600519', 'hk_stock')).toBe('hk_stock');
  });

  it('无法识别 → other', () => {
    expect(detectMarket('AAPL123456')).toBe('other');
    expect(detectMarket('')).toBe('other');
  });

  it('代码中的空格/符号被清理', () => {
    expect(detectMarket(' 700 ')).toBe('hk_stock');
  });

  it('支持交易所后缀', () => {
    expect(detectMarket('600519.SH')).toBe('a_stock');
    expect(detectMarket('0700.HK')).toBe('hk_stock');
    expect(detectMarket('AAPL.US')).toBe('us_stock');
    expect(detectMarket('9988.hk')).toBe('hk_stock');
  });
});
