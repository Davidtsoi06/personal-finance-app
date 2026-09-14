import { describe, it, expect } from 'vitest';
import { parseDateStrict, normalizeDate } from '../../src/main/services/data-normalizer';
import { formatDate, formatMonth } from '../../src/shared/utils/date-format';
import { parseWechatExcel, parseAlipayCsv } from '../../src/main/services/wallet-bill-parser';

/** v1.10.20：日期先识别（parseDateStrict）再落库，展示层统一 YYYY/MM/DD */

describe('parseDateStrict —— 严格日期识别（v1.10.20）', () => {
  it('识别常见写法并输出 ISO', () => {
    expect(parseDateStrict('2026-08-17')).toBe('2026-08-17');
    expect(parseDateStrict('2026/8/7')).toBe('2026-08-07');
    expect(parseDateStrict('2026/08/07')).toBe('2026-08-07');
    expect(parseDateStrict('20260807')).toBe('2026-08-07');
    expect(parseDateStrict('2026.08.07')).toBe('2026-08-07');
    expect(parseDateStrict('2026-08-16 12:30:45')).toBe('2026-08-16');
    expect(parseDateStrict('2026年8月7日')).toBe('2026-08-07');
    expect(parseDateStrict(46334)).toBe('2026-11-08'); // Excel 日期序列号
  });

  it('无法识别时返回 null（不再兜底「今天」）', () => {
    expect(parseDateStrict('')).toBeNull();
    expect(parseDateStrict(undefined)).toBeNull();
    expect(parseDateStrict(null)).toBeNull();
    expect(parseDateStrict('日期')).toBeNull();
    expect(parseDateStrict('buy')).toBeNull();
    expect(parseDateStrict('2026-13-45')).toBeNull(); // 非法月日
    expect(parseDateStrict('2026-02-30')).toBeNull(); // 不存在的日期
  });

  it('normalizeDate 非严格模式保留原有语义（空值兜底今天）', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(normalizeDate('')).toBe(today);
    expect(normalizeDate('2026/8/7')).toBe('2026-08-07');
    expect(normalizeDate('无法识别')).toBe('无法识别'); // 非严格：原样返回
  });
});

describe('formatDate —— 展示层 YYYY/MM/DD（v1.10.20）', () => {
  it('ISO → YYYY/MM/DD', () => {
    expect(formatDate('2026-08-17')).toBe('2026/08/17');
    expect(formatDate('2026-08-17 10:00:00')).toBe('2026/08/17');
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('无法识别时原样返回（不抛错、不吞数据）', () => {
    expect(formatDate('2026/8/7')).toBe('2026/8/7');
    expect(formatDate('待确认')).toBe('待确认');
  });

  it('formatMonth: YYYY-MM → YYYY/MM', () => {
    expect(formatMonth('2026-08')).toBe('2026/08');
    expect(formatMonth('2026-08-17')).toBe('2026/08');
    expect(formatMonth('')).toBe('');
  });
});

/** 账单文件解析：日期识别不出的行跳过并提示，不再静默记成今天 */
function wechatRowsBadDate(): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 17; i++) rows.push(['微信支付账单明细-无效行' + i, '']);
  rows.push(['微信支付账单明细', '', '']);
  rows.push(['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态']);
  rows.push(['2026-08-16 12:30:45', '商户消费', '星巴克', '拿铁', '支出', '¥35.00', '零钱', '支付成功']);
  rows.push(['日期未知', '商户消费', '美团', '外卖', '支出', '¥20.00', '零钱', '支付成功']);
  rows.push(['2026/8/14', '转账', '张三', '', '收入', '100.00', '零钱', '已存入零钱']);
  return rows;
}

describe('账单解析的日期严格化（v1.10.20）', () => {
  it('微信：无法识别的日期行被跳过并给出提示，斜杠日期正常识别', () => {
    const { records, errors } = parseWechatExcel(wechatRowsBadDate());
    expect(records).toHaveLength(2);
    expect(records[0].date).toBe('2026-08-16');
    expect(records[1].date).toBe('2026-08-14'); // 2026/8/14
    expect(errors.join('')).toContain('1 行日期无法识别');
  });

  it('支付宝：无法识别的日期行被跳过并给出提示', () => {
    const csv = [
      '支付宝交易记录明细查询',
      '--------------------------------交易记录明细列表------------------------------------',
      '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,',
      '2026-08-16 12:00:00,转账,李四,1234@ali.com,还款,收入,500.00,余额,交易成功,20260816001,20260816002,',
      '未知日期,餐饮美食,瑞幸咖啡,,拿铁,支出,25.00,余额宝,交易成功,20260815001,,,',
    ].join('\n');
    const { records, errors } = parseAlipayCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2026-08-16');
    expect(errors.join('')).toContain('1 行日期无法识别');
  });

  it('日期全部正常时不产生任何提示', () => {
    const csv = [
      '支付宝交易记录明细查询',
      '--------------------------------交易记录明细列表------------------------------------',
      '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,',
      '20260816,转账,李四,1234@ali.com,还款,收入,500.00,余额,交易成功,20260816001,20260816002,',
    ].join('\n');
    const { records, errors } = parseAlipayCsv(csv);
    expect(errors).toEqual([]);
    expect(records[0].date).toBe('2026-08-16');
  });
});
