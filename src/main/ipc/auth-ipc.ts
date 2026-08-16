/**
 * auth-ipc — 启动密码锁的 IPC 处理器（v1.7.0）。
 * 窗口切换（锁屏窗 ↔ 主窗）由 index.ts 通过回调完成。
 */
import { app } from 'electron';
import { handleValidated } from './validation';
import * as authService from '../services/auth-service';

export interface AuthIpcCallbacks {
  /** 解锁成功（密码正确或重设成功）后：关锁屏窗、开主窗 */
  onUnlocked: () => void;
  /** 主动锁定时：隐藏主窗、显示锁屏窗 */
  onLock: () => void;
}

export function registerAuthIpcHandlers(callbacks: AuthIpcCallbacks): void {
  handleValidated('auth:status', () => authService.getAuthStatus());

  handleValidated('auth:setRecoveryEmail', (email: string) => {
    authService.setRecoveryEmail(email);
    return { ok: true };
  });

  handleValidated('auth:setupSmtp', (data: any) => {
    authService.setupSmtp(data);
    return { ok: true };
  });

  handleValidated('auth:sendTestEmail', async () => {
    await authService.sendTestEmail();
    return { ok: true };
  });

  handleValidated('auth:enable', (password: string) => {
    authService.enableAuth(password);
    return { ok: true };
  });

  handleValidated('auth:changePassword', (oldPassword: string, newPassword: string) => {
    authService.changePassword(oldPassword, newPassword);
    return { ok: true };
  });

  handleValidated('auth:disable', (password: string) => {
    authService.disableAuth(password);
    return { ok: true };
  });

  handleValidated('auth:verify', (password: string) => {
    authService.verifyAuth(password);
    callbacks.onUnlocked();
    return { ok: true };
  });

  handleValidated('auth:lock', () => {
    authService.lockAuth();
    callbacks.onLock();
    return { ok: true };
  });

  handleValidated('auth:quit', () => {
    app.quit();
    return { ok: true };
  });

  handleValidated('auth:requestResetCode', async (email: string) => {
    await authService.requestResetCode(email);
    return { ok: true };
  });

  handleValidated('auth:verifyResetCode', (email: string, code: string) => {
    const ok = authService.verifyResetCode(email, code);
    return { ok };
  });

  handleValidated('auth:resetPassword', (email: string, code: string, newPassword: string) => {
    authService.resetPassword(email, code, newPassword);
    callbacks.onUnlocked();
    return { ok: true };
  });

  handleValidated('auth:setIdleMinutes', (minutes: number) => {
    authService.setIdleMinutes(minutes);
    return { ok: true };
  });
}