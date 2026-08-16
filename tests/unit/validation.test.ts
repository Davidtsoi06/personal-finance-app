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

  it('取出转券商：investment_account_id 空串/0 归一化为 null，负数/非数字拒绝（v1.6.1）', () => {
    const base = { account_id: 1, type: 'withdraw', amount: 100 };
    // 表单「不转入」提交空串 → 通过并归一化为 null
    const empty = SCHEMAS['accountTransaction:create'].safeParse([{ ...base, investment_account_id: '' }]);
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data[0].investment_account_id).toBeNull();
    // 0 → null
    const zero = SCHEMAS['accountTransaction:create'].safeParse([{ ...base, investment_account_id: 0 }]);
    expect(zero.success).toBe(true);
    if (zero.success) expect(zero.data[0].investment_account_id).toBeNull();
    // 缺省 → 归一化为 null（transform 对 undefined 同样生效）
    const none = SCHEMAS['accountTransaction:create'].safeParse([{ ...base }]);
    expect(none.success).toBe(true);
    if (none.success) expect(none.data[0].investment_account_id).toBeNull();
    // 正数 → 保留
    const valid = SCHEMAS['accountTransaction:create'].safeParse([{ ...base, investment_account_id: '7' }]);
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data[0].investment_account_id).toBe(7);
    // 负数 / 非数字 → 拒绝
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ ...base, investment_account_id: -1 }]).success).toBe(false);
    expect(SCHEMAS['accountTransaction:create'].safeParse([{ ...base, investment_account_id: 'abc' }]).success).toBe(false);
  });

  it('添加券商：funding_account_id 空串/0 归一化为 null，负数/非数字拒绝（v1.6.1）', () => {
    const base = { name: '富途牛牛', currency: 'HKD' };
    // 表单「无关联」提交空串 → 通过并归一化为 null
    const empty = SCHEMAS['investmentAccount:create'].safeParse([{ ...base, funding_account_id: '' }]);
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data[0].funding_account_id).toBeNull();
    // 0 → null
    const zero = SCHEMAS['investmentAccount:create'].safeParse([{ ...base, funding_account_id: 0 }]);
    expect(zero.success).toBe(true);
    if (zero.success) expect(zero.data[0].funding_account_id).toBeNull();
    // 缺省 → null
    const none = SCHEMAS['investmentAccount:create'].safeParse([{ ...base }]);
    expect(none.success).toBe(true);
    if (none.success) expect(none.data[0].funding_account_id).toBeNull();
    // 正数（字符串形式）→ 保留为数字
    const valid = SCHEMAS['investmentAccount:create'].safeParse([{ ...base, funding_account_id: '5' }]);
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data[0].funding_account_id).toBe(5);
    // 负数 / 非数字 → 拒绝
    expect(SCHEMAS['investmentAccount:create'].safeParse([{ ...base, funding_account_id: -1 }]).success).toBe(false);
    expect(SCHEMAS['investmentAccount:create'].safeParse([{ ...base, funding_account_id: 'abc' }]).success).toBe(false);
    // update 同样生效（partial 保留 transform）
    const upd = SCHEMAS['investmentAccount:update'].safeParse([1, { funding_account_id: '' }]);
    expect(upd.success).toBe(true);
    if (upd.success) expect(upd.data[1].funding_account_id).toBeNull();
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

  it('auth 频道校验（v1.7.0）', () => {
    expect(SCHEMAS['auth:status'].safeParse([]).success).toBe(true);
    expect(SCHEMAS['auth:verify'].safeParse(['abcdef']).success).toBe(true);
    expect(SCHEMAS['auth:verify'].safeParse(['12345']).success).toBe(false); // 少于 6 位
    expect(SCHEMAS['auth:setupSmtp'].safeParse([{ host: 'smtp.qq.com', port: '465', secure: true, user: 'a@qq.com', pass: 'x' }]).success).toBe(true);
    expect(SCHEMAS['auth:setupSmtp'].safeParse([{ host: 'smtp.qq.com', port: 0, secure: true, user: 'a@qq.com', pass: 'x' }]).success).toBe(false);
    expect(SCHEMAS['auth:verifyResetCode'].safeParse(['a@b.com', '123456']).success).toBe(true);
    expect(SCHEMAS['auth:verifyResetCode'].safeParse(['a@b.com', '12ab56']).success).toBe(false);
    expect(SCHEMAS['auth:setIdleMinutes'].safeParse(['10']).success).toBe(true);
  });

  it('settings:saveAiConfig 拒绝过长字段', () => {
    const ok = SCHEMAS['settings:saveAiConfig'].safeParse([{ provider: 'deepseek', apiUrl: 'https://api.deepseek.com', apiKey: 'sk-xxx', model: 'deepseek-chat' }]);
    expect(ok.success).toBe(true);
    const bad = SCHEMAS['settings:saveAiConfig'].safeParse([{ provider: 'deepseek', apiUrl: 'x'.repeat(400), apiKey: 'sk-xxx', model: 'deepseek-chat' }]);
    expect(bad.success).toBe(false);
  });
});
