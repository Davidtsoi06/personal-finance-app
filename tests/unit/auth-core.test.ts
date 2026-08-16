import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, generateVerificationCode,
  createAttemptLimiter, createSendLimiter, maskEmail,
  CODE_MAX_ATTEMPTS,
} from '../../src/main/services/auth-core';

describe('auth-core 密码哈希', () => {
  it('正确密码验证通过，错误密码失败', () => {
    const { salt, hash } = hashPassword('secret123');
    expect(salt).toHaveLength(32);
    expect(hash).toHaveLength(128);
    expect(verifyPassword('secret123', salt, hash)).toBe(true);
    expect(verifyPassword('wrong-password', salt, hash)).toBe(false);
  });

  it('相同密码两次哈希的盐不同（彩虹表防御）', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword('same-password', a.salt, a.hash)).toBe(true);
    expect(verifyPassword('same-password', b.salt, b.hash)).toBe(true);
  });

  it('篡改哈希后验证失败且不抛异常', () => {
    const { salt, hash } = hashPassword('secret123');
    expect(verifyPassword('secret123', salt, hash.slice(0, -2) + '00')).toBe(false);
  });
});

describe('auth-core 验证码', () => {
  it('生成 6 位数字验证码', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('auth-core 登录限流', () => {
  it('连续 5 次失败后锁定 30 秒，成功登录后重置', () => {
    const limiter = createAttemptLimiter(5, 30_000);
    for (let i = 0; i < 4; i++) {
      const r = limiter.registerFailure(1_000);
      expect(r.locked).toBe(false);
    }
    const locked = limiter.registerFailure(1_000);
    expect(locked.locked).toBe(true);
    expect(limiter.lockedRemainingMs(1_000)).toBe(30_000);
    expect(limiter.lockedRemainingMs(20_000)).toBe(11_000);
    expect(limiter.lockedRemainingMs(40_000)).toBe(0);
    limiter.reset();
    expect(limiter.lockedRemainingMs(20_000)).toBe(0);
  });
});

describe('auth-core 发信限流', () => {
  it('60 秒内只能发送一次', () => {
    const limiter = createSendLimiter(60_000);
    expect(limiter.trySend(1_000)).toBe(true);
    expect(limiter.trySend(10_000)).toBe(false);
    expect(limiter.nextAllowedInMs(10_000)).toBe(51_000);
    expect(limiter.trySend(61_000)).toBe(true);
  });
});

describe('auth-core 邮箱脱敏', () => {
  it('只保留首字符与域名', () => {
    expect(maskEmail('zhangsan@qq.com')).toBe('z***@qq.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });
});