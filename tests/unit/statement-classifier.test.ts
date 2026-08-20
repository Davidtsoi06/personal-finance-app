import { describe, it, expect } from 'vitest';
import { classifyBankRecord } from '../../src/main/services/statement-classifier';

/** v1.9.0：银行日结单行分类（方向 + 摘要关键词） */
describe('classifyBankRecord（v1.9.0）', () => {
  it('取出 + 定期类关键词 → fd_out', () => {
    expect(classifyBankRecord({ type: 'withdraw', description: '转定期存款 3个月' })).toBe('fd_out');
    expect(classifyBankRecord({ type: 'withdraw', description: '大额存单 20万' })).toBe('fd_out');
    expect(classifyBankRecord({ type: 'withdraw', description: '理财申购 招银日日金' })).toBe('fd_out');
    expect(classifyBankRecord({ type: 'withdraw', description: '整存整取 一年' })).toBe('fd_out');
  });

  it('存入 + 回款类关键词 → fd_in', () => {
    expect(classifyBankRecord({ type: 'deposit', description: '定期存款到期 本息入账' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: '理财赎回 到账' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: '结清 转活期' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: '定期支取' })).toBe('fd_in');
  });

  it('方向不符不误分类（存入+转定期 / 取出+到期）', () => {
    expect(classifyBankRecord({ type: 'deposit', description: '转定期存款' })).toBe('normal');
    expect(classifyBankRecord({ type: 'withdraw', description: '定期到期支取' })).toBe('normal');
  });

  it('无关键词/空摘要 → normal', () => {
    expect(classifyBankRecord({ type: 'withdraw', description: '餐饮消费' })).toBe('normal');
    expect(classifyBankRecord({ type: 'withdraw', description: '' })).toBe('normal');
    expect(classifyBankRecord({ type: 'deposit', description: '工资' })).toBe('normal');
  });

  it('v1.10.1 英文关键词（港银）：NEW TERM DEP 转出 / TERM DEP W\\D 回款', () => {
    expect(classifyBankRecord({ type: 'withdraw', description: 'NEW TERM DEP 4114913018330033' })).toBe('fd_out');
    expect(classifyBankRecord({ type: 'withdraw', description: 'NEW TERM DEPOSIT' })).toBe('fd_out');
    expect(classifyBankRecord({ type: 'deposit', description: 'TERM DEP W\\D 4114913018330026' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: 'TERM DEP WITHDRAWAL' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: 'TERM DEP MATURITY' })).toBe('fd_in');
    expect(classifyBankRecord({ type: 'deposit', description: 'MATURITY PAYMENT' })).toBe('fd_in');
  });

  it('v1.10.1 英文方向不误判：存入的 NEW TERM / 取出的 TERM DEP W 均为 normal', () => {
    expect(classifyBankRecord({ type: 'deposit', description: 'NEW TERM DEP' })).toBe('normal');
    expect(classifyBankRecord({ type: 'withdraw', description: 'TERM DEP W\\D' })).toBe('normal');
  });
});
