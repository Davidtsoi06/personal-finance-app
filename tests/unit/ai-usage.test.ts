import { describe, it, expect } from 'vitest';
import { mergeUsage, deriveBalanceEndpoint, type UsageDay } from '../../src/main/services/ai-service';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('AI 用量合并（v1.10.5）', () => {
  it('首次记录创建当天条目', () => {
    const today = daysAgo(0);
    const m = mergeUsage(null, today, 1, 100, 50);
    expect(m[today]).toEqual({ calls: 1, promptTokens: 100, completionTokens: 50 });
  });

  it('同一天多次调用累加', () => {
    const today = daysAgo(0);
    let m = mergeUsage(null, today, 1, 100, 50);
    m = mergeUsage(m, today, 2, 30, 10);
    expect(m[today]).toEqual({ calls: 3, promptTokens: 130, completionTokens: 60 });
  });

  it('只保留最近 7 天（10 天前的清除，3 天前的保留）', () => {
    const old: Record<string, UsageDay> = {
      [daysAgo(10)]: { calls: 1, promptTokens: 1, completionTokens: 1 },
      [daysAgo(3)]: { calls: 2, promptTokens: 2, completionTokens: 2 },
    };
    const m = mergeUsage(old, daysAgo(0), 1, 10, 10);
    expect(m[daysAgo(10)]).toBeUndefined();
    expect(m[daysAgo(3)]).toBeDefined();
    expect(m[daysAgo(0)].calls).toBe(1);
  });

  it('非法存量 JSON 容错（当作空表）', () => {
    const today = daysAgo(0);
    const m = mergeUsage({ bad: 1 } as any, today, 1, 1, 1);
    expect(m[today].calls).toBe(1);
  });
});

describe('余额端点推导（v1.10.5）', () => {
  it('DeepSeek → /user/balance', () => {
    expect(deriveBalanceEndpoint('https://api.deepseek.com/v1/chat/completions', 'deepseek'))
      .toBe('https://api.deepseek.com/user/balance');
    expect(deriveBalanceEndpoint('https://api.deepseek.com/chat/completions', 'deepseek'))
      .toBe('https://api.deepseek.com/user/balance');
  });

  it('OpenAI → /v1/dashboard/billing/credit_grants', () => {
    expect(deriveBalanceEndpoint('https://api.openai.com/v1/chat/completions', 'openai'))
      .toBe('https://api.openai.com/v1/dashboard/billing/credit_grants');
  });

  it('其他服务商/非法 URL → null（不支持）', () => {
    expect(deriveBalanceEndpoint('https://my-proxy.example.com/chat', 'custom')).toBeNull();
    expect(deriveBalanceEndpoint('not-a-url', 'deepseek')).toBeNull();
  });
});
