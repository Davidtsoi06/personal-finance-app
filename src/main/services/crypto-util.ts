/**
 * crypto-util — 敏感数据（AI API Key）加密工具（密钥管理层）。
 *
 * 使用 AES-256-GCM（纯函数核心在 src/shared/utils/crypto-core.ts）；
 * 密钥保存在 userData/secret.key，与数据库文件分离。
 * 威胁模型：防止数据库文件被单独泄露/检查时直接读取明文。
 * 说明：若整个 userData 目录被复制（密钥+密文同时泄露），本方案不提供保护；
 * 完整数据库加密需 SQLCipher（见 docs/tech-spec.md 后续迭代）。
 */
import { app } from 'electron';
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { execFile } from 'child_process';
import { encryptTextWithKey, decryptTextWithKey, CRYPTO_PREFIX } from './crypto-core';

const KEY_FILE_NAME = 'secret.key';

let cachedKey: Buffer | null = null;
let aclApplied = false;

/** Windows：将密钥文件权限收紧为仅当前用户可读写（移除继承），失败不阻断启动。 */
function restrictKeyFileAcl(keyPath: string): void {
  if (process.platform !== 'win32' || aclApplied) return;
  const domain = process.env.USERDOMAIN || '';
  const user = process.env.USERNAME || '';
  if (!user) return;
  const principal = domain ? `${domain}\\${user}` : user;
  aclApplied = true;
  try {
    execFile('icacls', [keyPath, '/inheritance:r', '/grant:r', `${principal}:(R,W)`], (err) => {
      if (err) console.warn('[crypto-util] 设置密钥文件 ACL 失败（非致命）:', err.message);
    });
  } catch (err: any) {
    console.warn('[crypto-util] 设置密钥文件 ACL 失败（非致命）:', err?.message || err);
  }
}

function getKeyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyPath = getKeyFilePath();
  try {
    if (fs.existsSync(keyPath)) {
      const b64 = fs.readFileSync(keyPath, 'utf8').trim();
      if (b64) {
        const key = Buffer.from(b64, 'base64');
        if (key.length === 32) {
          cachedKey = key;
          restrictKeyFileAcl(keyPath);
          return key;
        }
      }
    }
  } catch (err) {
    console.warn('[crypto-util] 读取密钥文件失败，将重新生成:', err);
  }

  // 首次运行：生成 256 位随机密钥
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    restrictKeyFileAcl(keyPath);
  } catch (err) {
    console.error('[crypto-util] 写入密钥文件失败:', err);
  }
  cachedKey = key;
  return key;
}

/** 加密为自描述格式：v1:<iv>:<tag>:<ciphertext>（均为 base64） */
export function encryptText(plain: string): string {
  return encryptTextWithKey(getEncryptionKey(), plain);
}

/** 解密；非加密格式或解密失败返回 null */
export function decryptText(payload: string | null | undefined): string | null {
  return decryptTextWithKey(getEncryptionKey(), payload);
}

/** 是否已是加密格式 */
export function isEncrypted(payload: string | null | undefined): boolean {
  return !!payload && payload.startsWith(CRYPTO_PREFIX);
}
