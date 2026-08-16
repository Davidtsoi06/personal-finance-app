/**
 * auth-core — 启动密码锁的纯逻辑核心（无 electron/db 依赖，可单元测试）。
 *   - 密码：scrypt 随机盐哈希（不存明文）；
 *   - 验证码：6 位数字，用于忘记密码的邮箱找回；
 *   - 限流：登录失败 5 次锁定 30 秒；验证码 60 秒限发、10 分钟有效、5 次试错作废。
 */
import crypto = require('crypto');

export const SCRYPT_KEYLEN = 64;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MS = 30_000;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_SEND_INTERVAL_MS = 60_000;
export const CODE_MAX_ATTEMPTS = 5;

export interface PasswordHash {
  salt: string;
  hash: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 登录失败限流：连续失败达到上限后锁定一段时间。 */
export interface AttemptLimiter {
  registerFailure: (now?: number) => { locked: boolean; lockUntil: number };
  lockedRemainingMs: (now?: number) => number;
  reset: () => void;
}

export function createAttemptLimiter(maxAttempts: number = LOGIN_MAX_ATTEMPTS, lockMs: number = LOGIN_LOCK_MS): AttemptLimiter {
  let failures = 0;
  let lockUntil = 0;

  return {
    registerFailure(now = Date.now()) {
      failures += 1;
      if (failures >= maxAttempts) {
        failures = 0;
        lockUntil = now + lockMs;
        return { locked: true, lockUntil };
      }
      return { locked: false, lockUntil: 0 };
    },
    lockedRemainingMs(now = Date.now()) {
      return Math.max(0, lockUntil - now);
    },
    reset() {
      failures = 0;
      lockUntil = 0;
    },
  };
}

/**
 * 阶梯式登录锁定（v1.8.0）：连续失败达到上限 → 首次锁 firstLockMs，
 * 解锁后再次触发 → 锁 nextLockMs（更久），成功登录整体重置。
 */
export interface EscalatingLock {
  registerFailure: (now?: number) => { locked: boolean; lockUntil: number; level: number };
  lockedRemainingMs: (now?: number) => number;
  reset: () => void;
}

export function createEscalatingLock(
  maxAttempts: number = LOGIN_MAX_ATTEMPTS,
  firstLockMs: number = 10_000,
  nextLockMs: number = 60_000
): EscalatingLock {
  let failures = 0;
  let lockUntil = 0;
  let level = 0;

  return {
    registerFailure(now = Date.now()) {
      failures += 1;
      if (failures >= maxAttempts) {
        failures = 0;
        level += 1;
        lockUntil = now + (level >= 2 ? nextLockMs : firstLockMs);
        return { locked: true, lockUntil, level };
      }
      return { locked: false, lockUntil: 0, level };
    },
    lockedRemainingMs(now = Date.now()) {
      return Math.max(0, lockUntil - now);
    },
    reset() {
      failures = 0;
      lockUntil = 0;
      level = 0;
    },
  };
}

/** 发信限流：两次发送之间至少间隔 intervalMs。 */
export interface SendLimiter {
  trySend: (now?: number) => boolean;
  nextAllowedInMs: (now?: number) => number;
}

export function createSendLimiter(intervalMs: number = CODE_SEND_INTERVAL_MS): SendLimiter {
  // 初始 -Infinity：从未发送过时首次发送不受限
  let lastSentAt = Number.NEGATIVE_INFINITY;
  return {
    trySend(now = Date.now()) {
      if (now - lastSentAt < intervalMs) return false;
      lastSentAt = now;
      return true;
    },
    nextAllowedInMs(now = Date.now()) {
      return Math.max(0, intervalMs - (now - lastSentAt));
    },
  };
}

/** 邮箱脱敏：仅保留首字符与域名，用于界面显示。 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return local.slice(0, 1) + '***@' + domain;
}