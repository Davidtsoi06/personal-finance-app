import { describe, it, expect } from 'vitest';
import { normalizeDate } from '../../src/main/services/data-normalizer';

describe('normalizeDate 美式月/日/年（银行日结单，v1.7.0）', () => {
  it('M/D/YYYY', () => {
    expect(normalizeDate('8/16/2026')).toBe('2026-08-16');
    expect(normalizeDate('1/5/2026')).toBe('2026-01-05');
    expect(normalizeDate('12/31/2026')).toBe('2026-12-31');
  });

  it('M/D/YYYY 带时间', () => {
    expect(normalizeDate('8/16/2026 14:30')).toBe('2026-08-16');
    expect(normalizeDate('8/16/2026 09:05:30')).toBe('2026-08-16');
  });

  it('M/D/YY（2 位年：>=70 视为 19xx，否则 20xx）', () => {
    expect(normalizeDate('8/16/26')).toBe('2026-08-16');
    expect(normalizeDate('1/1/70')).toBe('1970-01-01');
    expect(normalizeDate('12/31/99')).toBe('1999-12-31');
  });

  it('Excel 日期序列号（含时间小数）', () => {
    expect(normalizeDate('46080')).toBe('2026-02-27');
    expect(normalizeDate('46080.5')).toBe('2026-02-27');
    expect(normalizeDate('30000')).toBe('1982-02-18');
  });

  it('无效日期原样返回（不误转换）', () => {
    expect(normalizeDate('2/30/2026')).toBe('2/30/2026'); // 2 月没有 30 日
    expect(normalizeDate('13/1/2026')).toBe('13/1/2026'); // 无效月
    expect(normalizeDate('0/1/2026')).toBe('0/1/2026');
    expect(normalizeDate('abc')).toBe('abc');
    expect(normalizeDate('12345')).toBe('12345'); // 序列号范围外
  });

  it('既有格式回归', () => {
    expect(normalizeDate('2026-08-16')).toBe('2026-08-16');
    expect(normalizeDate('20260816')).toBe('2026-08-16');
    expect(normalizeDate('2026/8/16')).toBe('2026-08-16');
    expect(normalizeDate('2026/08/16')).toBe('2026-08-16');
    expect(normalizeDate('2026.8.16')).toBe('2026-08-16');
  });
});