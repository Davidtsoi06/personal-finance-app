import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptTextWithKey,
  decryptTextWithKey,
  CRYPTO_PREFIX,
} from '../../src/main/services/crypto-core';

const key = crypto.randomBytes(32);

describe('AES-256-GCM 加密核心', () => {
  it('加解密往返一致', () => {
    const cipher = encryptTextWithKey(key, 'sk-abcdef123456');
    expect(cipher.startsWith(CRYPTO_PREFIX)).toBe(true);
    expect(decryptTextWithKey(key, cipher)).toBe('sk-abcdef123456');
  });

  it('相同明文两次加密产生不同密文（随机 IV）', () => {
    const a = encryptTextWithKey(key, 'same');
    const b = encryptTextWithKey(key, 'same');
    expect(a).not.toBe(b);
  });

  it('错误密钥解密失败', () => {
    const cipher = encryptTextWithKey(key, 'secret');
    expect(decryptTextWithKey(crypto.randomBytes(32), cipher)).toBeNull();
  });

  it('密文被篡改时解密失败（GCM 认证）', () => {
    const cipher = encryptTextWithKey(key, 'secret');
    const tampered = cipher.slice(0, -4) + 'AAAA';
    expect(decryptTextWithKey(key, tampered)).toBeNull();
  });

  it('非加密格式返回 null', () => {
    expect(decryptTextWithKey(key, 'plaintext-key')).toBeNull();
    expect(decryptTextWithKey(key, null)).toBeNull();
    expect(decryptTextWithKey(key, '')).toBeNull();
    expect(decryptTextWithKey(key, 'v1:bad')).toBeNull();
  });
});
