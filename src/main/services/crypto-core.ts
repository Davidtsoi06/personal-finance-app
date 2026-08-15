/**
 * crypto-core — AES-256-GCM 纯函数核心（无 electron 依赖，供单元测试）。
 * 密钥管理（userData/secret.key）在 src/main/services/crypto-util.ts。
 */
import crypto = require('crypto');

const ALGO = 'aes-256-gcm';
export const CRYPTO_PREFIX = 'v1:';

/** 加密为自描述格式：v1:<iv>:<tag>:<ciphertext>（均为 base64）。 */
export function encryptTextWithKey(key: Buffer, plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return CRYPTO_PREFIX + [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** 解密；非加密格式、密钥不符或数据被篡改时返回 null。 */
export function decryptTextWithKey(key: Buffer, payload: string | null | undefined): string | null {
  if (!payload || !payload.startsWith(CRYPTO_PREFIX)) return null;
  try {
    const parts = payload.slice(CRYPTO_PREFIX.length).split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}