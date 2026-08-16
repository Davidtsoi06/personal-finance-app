/**
 * auth-service — 启动密码锁（主进程门禁，v1.7.0）。
 *   - 密码 scrypt 哈希存 app_settings（auth.salt / auth.hash）；
 *   - SMTP 授权码用 AES-GCM（crypto-util）加密存储；
 *   - 忘记密码：向恢复邮箱发送 6 位验证码（nodemailer），验证通过后重设；
 *   - 未解锁时业务 IPC 一律拒绝（与锁屏窗口最小 preload 双保险）。
 */
import { getDatabase } from '../database';
import { getSetting, setSetting } from '../database/services/settings-service';
import { encryptText, decryptText } from './crypto-util';
import {
  hashPassword, verifyPassword, generateVerificationCode,
  createAttemptLimiter, createSendLimiter,
  CODE_TTL_MS, CODE_MAX_ATTEMPTS, maskEmail,
} from './auth-core';
import * as nodemailer from 'nodemailer';

/**
 * 内置官方发件通道（v1.7.2）：用户零配置，仅需提供恢复邮箱。
 * 专用低价值邮箱，只发送密码重置验证码；凭据被提取的后果仅是该邮箱被停用，可更换。
 */
const BUILTIN_SMTP = {
  host: 'smtp.163.com',
  port: 465,
  secure: true,
  user: 'personalfinanceapp@163.com',
  pass: 'NUfVh34BeL8iiUFR',
} as const;

const KEYS = {
  enabled: 'auth.enabled',
  salt: 'auth.salt',
  hash: 'auth.hash',
  recoveryEmail: 'auth.recovery_email',
  idleMinutes: 'auth.idle_minutes',
  smtpHost: 'smtp.host',
  smtpPort: 'smtp.port',
  smtpSecure: 'smtp.secure',
  smtpUser: 'smtp.user',
  smtpPassEnc: 'smtp.pass_enc',
} as const;

const AUTH_CHANNEL_PREFIX = 'auth:';

interface PendingReset {
  code: string;
  expiresAt: number;
  attempts: number;
}

let unlocked = false;
let initialized = false;
const loginLimiter = createAttemptLimiter();
const sendLimiter = createSendLimiter();
const pendingResets = new Map<string, PendingReset>();

function enabledRaw(): boolean {
  return getSetting(KEYS.enabled) === '1';
}

/** 应用启动后调用：未启用密码则直接视为已解锁。 */
export function initAuthService(): void {
  unlocked = !enabledRaw();
  initialized = true;
}

export function isAuthEnabled(): boolean {
  return enabledRaw();
}

export function isUnlocked(): boolean {
  return initialized && unlocked;
}

/** 业务 IPC 门禁：未解锁时拒绝一切非 auth 频道（双保险之一）。 */
export function assertUnlocked(channel: string): void {
  if (channel.startsWith(AUTH_CHANNEL_PREFIX)) return;
  if (!isUnlocked()) {
    throw new Error('应用已锁定，请先解锁');
  }
}

export interface AuthStatus {
  enabled: boolean;
  unlocked: boolean;
  idleMinutes: number;
  recoveryEmailMasked: string | null;
  smtpConfigured: boolean;
  onboardingDone: boolean;
}

export function getAuthStatus(): AuthStatus {
  const email = getSetting(KEYS.recoveryEmail);
  return {
    enabled: enabledRaw(),
    unlocked: isUnlocked(),
    idleMinutes: parseInt(getSetting(KEYS.idleMinutes) || '10', 10) || 10,
    recoveryEmailMasked: email ? maskEmail(email) : null,
    smtpConfigured: !!(getSetting(KEYS.smtpHost) && getSetting(KEYS.smtpUser) && getSetting(KEYS.smtpPassEnc)),
    // v1.7.2：首次使用引导标记；仅全新库为 '0'（老库无键视为已完成，不打扰老用户）
    onboardingDone: getSetting('onboarding.done') !== '0',
  };
}

// ── SMTP / 恢复邮箱配置 ──

export function setRecoveryEmail(email: string): void {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error('邮箱格式不正确');
  setSetting(KEYS.recoveryEmail, trimmed);
}

export function setupSmtp(data: { host: string; port: number; secure: boolean; user: string; pass: string }): void {
  if (!data.host || !data.user || !data.pass) throw new Error('SMTP 服务器/账号/授权码不能为空');
  setSetting(KEYS.smtpHost, data.host.trim());
  setSetting(KEYS.smtpPort, String(data.port || (data.secure ? 465 : 587)));
  setSetting(KEYS.smtpSecure, data.secure ? '1' : '0');
  setSetting(KEYS.smtpUser, data.user.trim());
  setSetting(KEYS.smtpPassEnc, encryptText(data.pass));
}

function buildTransporter(): nodemailer.Transporter {
  // v1.7.2：优先使用用户自定义 SMTP（高级选项）；未配置时使用内置官方发件通道（用户零配置）
  const host = getSetting(KEYS.smtpHost);
  const user = getSetting(KEYS.smtpUser);
  const passEnc = getSetting(KEYS.smtpPassEnc);
  if (host && user && passEnc) {
    const port = parseInt(getSetting(KEYS.smtpPort) || '0', 10);
    const secure = getSetting(KEYS.smtpSecure) === '1';
    const pass = decryptText(passEnc) || '';
    return nodemailer.createTransport({ host, port: port || (secure ? 465 : 587), secure, auth: { user, pass } });
  }
  return nodemailer.createTransport({
    host: BUILTIN_SMTP.host,
    port: BUILTIN_SMTP.port,
    secure: BUILTIN_SMTP.secure,
    auth: { user: BUILTIN_SMTP.user, pass: BUILTIN_SMTP.pass },
  });
}

async function sendMail(subject: string, text: string): Promise<void> {
  const to = getSetting(KEYS.recoveryEmail);
  if (!to) throw new Error('恢复邮箱尚未设置');
  const transporter = buildTransporter();
  await transporter.sendMail({
    from: getSetting(KEYS.smtpUser) || BUILTIN_SMTP.user,
    to,
    subject,
    text,
  });
}

/** 测试发信：向恢复邮箱发一封测试邮件（启用密码前强制通过）。 */
export async function sendTestEmail(): Promise<void> {
  await sendMail('[个人理财软件] 邮箱配置测试', '这是一封测试邮件：你的发件邮箱配置成功。\n\n如果收到本邮件，即可启用启动密码。');
}

// ── 启用 / 修改 / 禁用 ──

export function enableAuth(password: string): void {
  if (password.length < 6) throw new Error('密码至少 6 位');
  // v1.7.2：内置官方发件通道，无需用户配置 SMTP；仍要求先设置恢复邮箱
  if (!getSetting(KEYS.recoveryEmail)) throw new Error('请先设置恢复邮箱');
  const { salt, hash } = hashPassword(password);
  setSetting(KEYS.salt, salt);
  setSetting(KEYS.hash, hash);
  setSetting(KEYS.enabled, '1');
}

export function changePassword(oldPassword: string, newPassword: string): void {
  if (newPassword.length < 6) throw new Error('新密码至少 6 位');
  const salt = getSetting(KEYS.salt);
  const hash = getSetting(KEYS.hash);
  if (!salt || !hash) throw new Error('尚未启用启动密码');
  if (!verifyPassword(oldPassword, salt, hash)) throw new Error('当前密码不正确');
  const next = hashPassword(newPassword);
  setSetting(KEYS.salt, next.salt);
  setSetting(KEYS.hash, next.hash);
}

export function disableAuth(password: string): void {
  const salt = getSetting(KEYS.salt);
  const hash = getSetting(KEYS.hash);
  if (!salt || !hash) throw new Error('尚未启用启动密码');
  if (!verifyPassword(password, salt, hash)) throw new Error('密码不正确');
  setSetting(KEYS.enabled, '0');
  unlocked = true;
}

export function setIdleMinutes(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) throw new Error('空闲锁定时长需在 1~60 分钟之间');
  setSetting(KEYS.idleMinutes, String(Math.round(minutes)));
}

// ── 解锁 / 锁定 ──

/** 锁屏验证：成功置 unlocked（窗口切换由 index.ts 完成）。 */
export function verifyAuth(password: string): void {
  const remaining = loginLimiter.lockedRemainingMs();
  if (remaining > 0) {
    throw new Error(`尝试次数过多，请 ${Math.ceil(remaining / 1000)} 秒后再试`);
  }
  const salt = getSetting(KEYS.salt);
  const hash = getSetting(KEYS.hash);
  if (!salt || !hash) throw new Error('尚未启用启动密码');
  if (!verifyPassword(password, salt, hash)) {
    const r = loginLimiter.registerFailure();
    if (r.locked) throw new Error('密码错误次数过多，已锁定 30 秒');
    throw new Error('密码不正确');
  }
  loginLimiter.reset();
  unlocked = true;
}

export function lockAuth(): void {
  unlocked = false;
}

/** 完成首次使用引导（v1.7.2）：写入完成标记（跳过与完成都调用） */
export function completeOnboarding(): void {
  setSetting('onboarding.done', '1');
}

// ── 忘记密码（邮箱验证码） ──

export async function requestResetCode(email: string): Promise<void> {
  const registered = getSetting(KEYS.recoveryEmail);
  // v1.7.1 防枚举：无论邮箱是否匹配都返回同样的结果；不匹配时不发邮件
  if (!registered || email.trim().toLowerCase() !== registered.toLowerCase()) return;
  if (!sendLimiter.trySend()) {
    const wait = Math.ceil(sendLimiter.nextAllowedInMs() / 1000);
    throw new Error(`发送过于频繁，请 ${wait} 秒后再试`);
  }
  const code = generateVerificationCode();
  pendingResets.set(registered, { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 });
  await sendMail(
    '[个人理财软件] 密码重置验证码',
    `你正在重置个人理财软件的启动密码。\n\n验证码：${code}\n（10 分钟内有效，请勿转发给他人）`,
  );
}

export function verifyResetCode(email: string, code: string): boolean {
  const registered = getSetting(KEYS.recoveryEmail);
  if (!registered || email.trim().toLowerCase() !== registered.toLowerCase()) return false;
  const pending = pendingResets.get(registered);
  if (!pending) return false;
  if (Date.now() > pending.expiresAt) {
    pendingResets.delete(registered);
    return false;
  }
  pending.attempts += 1;
  if (pending.attempts > CODE_MAX_ATTEMPTS) {
    pendingResets.delete(registered);
    return false;
  }
  return pending.code === code.trim();
}

export function resetPassword(email: string, code: string, newPassword: string): void {
  if (newPassword.length < 6) throw new Error('新密码至少 6 位');
  if (!verifyResetCode(email, code)) throw new Error('验证码无效或已过期');
  const { salt, hash } = hashPassword(newPassword);
  setSetting(KEYS.salt, salt);
  setSetting(KEYS.hash, hash);
  setSetting(KEYS.enabled, '1');
  const registered = getSetting(KEYS.recoveryEmail);
  if (registered) pendingResets.delete(registered);
  loginLimiter.reset();
  unlocked = true;
}

// ── 预取数据库连接（供 initAuthService 前的门禁使用） ──
export function touchDb(): void {
  getDatabase();
}