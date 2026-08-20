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

/** v1.10.1：日/月回退 + 中文日期（银行 DD/MM/YYYY 与「X月Y日」渲染） */
describe('normalizeDate 日/月与中文日期（v1.10.1）', () => {
  it('DD/MM/YYYY：月/日解析失败自动回退日/月', () => {
    expect(normalizeDate('18/08/2026')).toBe('2026-08-18');
    expect(normalizeDate('31/12/2026')).toBe('2026-12-31');
  });

  it('DD/MM/YY：2 位年同样回退', () => {
    expect(normalizeDate('18/08/26')).toBe('2026-08-18');
  });

  it('中文日期带年：YYYY年M月D日 → 标准月日，无歧义', () => {
    expect(normalizeDate('2026年8月18日')).toBe('2026-08-18');
    expect(normalizeDate('2026年12月31日')).toBe('2026-12-31');
  });

  it('中文日期无年：M月D日（标准），产生合法日期', () => {
    const d = normalizeDate('8月16日');
    expect(d).toMatch(/^\d{4}-08-16$/);
  });

  it('中文日期无年：日/月渲染银行（10月8日=8月10日）歧义消解——返回合法候选日期', () => {
    // 按「月日」=2026-10-08、「日月」=2026-08-10，歧义由当前日期消解；断言结果为二者之一（均为合法解析）
    const d = normalizeDate('10月8日');
    expect(['2026-08-10', '2026-10-08']).toContain(d);
    const d2 = normalizeDate('11月8日');
    expect(['2026-08-11', '2026-11-08']).toContain(d2);
  });

  it('中文日期可带时间', () => {
    const d = normalizeDate('10月8日 12:30');
    expect(['2026-08-10', '2026-10-08']).toContain(d);
  });

  it('月/日均无效的中文日期原样返回', () => {
    expect(normalizeDate('13月32日')).toBe('13月32日');
  });
});