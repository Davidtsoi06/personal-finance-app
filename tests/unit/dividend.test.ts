import { describe, it, expect } from 'vitest';
import { computeDividendAmounts, buildDividendIncome, isDividendText, DIVIDEND_KEYWORDS } from '../../src/shared/utils/dividend';
import { mergeKey } from '../../src/shared/utils/investment';

describe('computeDividendAmounts — 股息金额（v1.10.21）', () => {
  it('每股派息 × 股数 → 税前；扣预扣税得实收', () => {
    const r = computeDividendAmounts({ perShare: 0.5, quantity: 1000, taxAmount: 50 });
    expect(r.gross).toBe(500);
    expect(r.tax).toBe(50);
    expect(r.net).toBe(450);
  });

  it('直接填税前总额时忽略每股派息', () => {
    const r = computeDividendAmounts({ grossAmount: 1234.56, perShare: 9, quantity: 10 });
    expect(r.gross).toBe(1234.56);
    expect(r.net).toBe(1234.56);
  });

  it('税不能超过税前（超额自动截断），金额四舍五入到分', () => {
    const r = computeDividendAmounts({ grossAmount: 100, taxAmount: 999 });
    expect(r.tax).toBe(100);
    expect(r.net).toBe(0);
    const r2 = computeDividendAmounts({ perShare: 0.333, quantity: 3 });
    expect(r2.gross).toBe(1); // 0.999 → 1.00
  });

  it('负数/非法输入按 0 处理', () => {
    expect(computeDividendAmounts({ perShare: -1, quantity: 10 }).gross).toBe(0);
    expect(computeDividendAmounts({ grossAmount: NaN }).net).toBe(0);
  });
});

describe('isDividendText — 股息摘要识别', () => {
  it('中英文常见写法', () => {
    for (const s of ['股息', '派息', '红利入账', 'DIVIDEND 00700', 'Cash Dividend', '利息收入', '紅股']) {
      expect(isDividendText(s)).toBe(true);
    }
  });

  it('普通买卖/转账不误判', () => {
    for (const s of ['买入 00700', 'SELL AAPL', 'ATM WITHDRAWAL', '转账 张三', '']) {
      expect(isDividendText(s)).toBe(false);
    }
  });

  it('关键词表非空且不含空串', () => {
    expect(DIVIDEND_KEYWORDS.length).toBeGreaterThan(5);
    expect(DIVIDEND_KEYWORDS.every((k) => k.trim().length > 0)).toBe(true);
  });
});

describe('buildDividendIncome — 股息收入汇总（跨账户合并）', () => {
  const row = (p: Partial<Parameters<typeof buildDividendIncome>[0][number]> & { assetId: number; netAmount: number }) => ({
    code: '00700', name: '腾讯控股', currency: 'HKD', fee: 0, date: '2026-06-01', ...p,
  });

  it('税前 = 实收 + 税；按「代码+币种」跨账户合并并给各账户明细', () => {
    const r = buildDividendIncome([
      row({ assetId: 1, netAmount: 450, fee: 50, accountName: '券商A' }),
      row({ assetId: 2, netAmount: 900, fee: 100, accountName: '券商B' }),
    ]);
    expect(r.net).toBe(1350);
    expect(r.tax).toBe(150);
    expect(r.gross).toBe(1500);
    expect(r.count).toBe(2);
    expect(r.byAsset).toHaveLength(1); // 同一只股票合并为一行
    expect(r.byAsset[0].accountCount).toBe(2);
    expect(r.byAsset[0].accounts.map((a) => a.accountName)).toEqual(['券商A', '券商B']);
  });

  it('币种不同不合并；无账户名归为「未指定账户」', () => {
    const r = buildDividendIncome([
      row({ assetId: 1, netAmount: 100, currency: 'HKD' }),
      row({ assetId: 3, netAmount: 200, currency: 'USD', accountName: null }),
    ]);
    expect(r.byAsset).toHaveLength(2);
    expect(r.byAsset.some((e) => e.accounts[0].accountName === '未指定账户')).toBe(true);
  });

  it('空输入返回零值', () => {
    const r = buildDividendIncome([]);
    expect(r).toEqual({ gross: 0, tax: 0, net: 0, count: 0, byAsset: [] });
  });
});

describe('mergeKey — 跨账户合并键', () => {
  it('代码大写 + 币种大写；币种不同不合并', () => {
    expect(mergeKey('00700', 'HKD')).toBe('00700|HKD');
    expect(mergeKey('aapl', 'usd')).toBe('AAPL|USD');
    expect(mergeKey('00700', 'HKD')).not.toBe(mergeKey('00700', 'USD'));
    expect(mergeKey(null, undefined)).toBe('|');
  });
});
