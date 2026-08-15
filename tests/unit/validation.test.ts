import { describe, it, expect } from 'vitest';
import { SCHEMAS } from '../../src/shared/ipc-validation';

describe('IPC 入参校验 schema', () => {
  it('合法参数通过', () => {
    expect(SCHEMAS['account:create'].safeParse([{ name: '招商银行', type: 'bank_card' }]).success).toBe(true);
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ account_id: 1, type: 'deposit', amount: '100.5' }]).success).toBe(true);
    expect(SCHEMAS['ledger:create'].safeParse([{ type: 'expense', amount: 12.3, category_id: 1 }]).success).toBe(true);
    expect(SCHEMAS['trade:record'].safeParse([{ investmentAccountId: 2, type: 'buy', code: '00700', name: '腾讯', quantity: 100, price: 345 }]).success).toBe(true);
  });

  it('字符串数字被 coerce 为 number', () => {
    const r = SCHEMAS['accountTransaction:create'].safeParse([{ account_id: '3', type: 'deposit', amount: '250' }]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data[0].amount).toBe(250);
      expect(r.data[0].account_id).toBe(3);
    }
  });

  it('金额为 0 或负数被拒绝', () => {
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ account_id: 1, type: 'deposit', amount: 0 }]).success).toBe(false);
    expect(SCHEMAS['ledger:create'].safeParse([{ type: 'expense', amount: -5 }]).success).toBe(false);
    expect(SCHEMAS['investmentAccount:addCash'].safeParse([1, -100]).success).toBe(false);
  });

  it('非法字符串金额（NaN）被拒绝', () => {
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ account_id: 1, type: 'deposit', amount: 'abc' }]).success).toBe(false);
  });

  it('非法枚举被拒绝', () => {
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ account_id: 1, type: 'transfer', amount: 1 }]).success).toBe(false);
    expect(SCHEMAS['ledger:create'].safeParse([{ type: 'refund', amount: 1 }]).success).toBe(false);
    expect(SCHEMAS['trade:record'].safeParse([{ investmentAccountId: 1, type: 'hold', code: 'x', name: 'y', quantity: 1, price: 1 }]).success).toBe(false);
  });

  it('缺失必填字段被拒绝', () => {
    expect(SCHEMAS['account:create'].safeParse([{}]).success).toBe(false);
    expect(SCHEMAS['trade:record'].safeParse([{ investmentAccountId: 1, type: 'buy', quantity: 1 }]).success).toBe(false);
    expect(SCHEMAS['fixedDeposit:create'].safeParse([{ account_id: 1, amount: 100 }]).success).toBe(false);
  });

  it('id 必须为正整数', () => {
    expect(SCHEMAS['account:delete'].safeParse([0]).success).toBe(false);
    expect(SCHEMAS['account:delete'].safeParse([-1]).success).toBe(false);
    expect(SCHEMAS['account:delete'].safeParse([1.5]).success).toBe(false);
    expect(SCHEMAS['account:delete'].safeParse(['2']).success).toBe(true);
  });

  it('日期格式校验', () => {
    expect(SCHEMAS['ledger:create'].safeParse([{ type: 'expense', amount: 1, date: '2026-08-15' }]).success).toBe(true);
    expect(SCHEMAS['ledger:create'].safeParse([{ type: 'expense', amount: 1, date: '2026/08/15' }]).success).toBe(false);
  });

  it('passthrough 放行未知字段（向前兼容）', () => {
    const r = SCHEMAS['account:create'].safeParse([{ name: 'x', type: 'bank_card', extra_field: 'y' }]);
    expect(r.success).toBe(true);
  });

  it('settings:saveAiConfig 拒绝过长字段', () => {
    const ok = SCHEMAS['settings:saveAiConfig'].safeParse([{ provider: 'deepseek', apiUrl: 'https://api.deepseek.com', apiKey: 'sk-xxx', model: 'deepseek-chat' }]);
    expect(ok.success).toBe(true);
    const bad = SCHEMAS['settings:saveAiConfig'].safeParse([{ provider: 'deepseek', apiUrl: 'x'.repeat(400), apiKey: 'sk-xxx', model: 'deepseek-chat' }]);
    expect(bad.success).toBe(false);
  });
});
