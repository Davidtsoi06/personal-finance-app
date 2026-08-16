/**
 * IPC handler registration — thin orchestrator that delegates to domain files.
 * Each domain file follows the pattern: register<Domain>IpcHandlers()
 */
import { ipcMain } from 'electron';
import { assertUnlocked } from '../services/auth-service';
import { registerUpdateIpcHandlers } from './update-ipc';
import { registerAccountIpcHandlers } from './account-ipc';
import { registerAssetIpcHandlers } from './asset-ipc';
import { registerLedgerIpcHandlers } from './ledger-ipc';
import { registerReportIpcHandlers } from './report-ipc';
import { registerSettingsIpcHandlers } from './settings-ipc';
import { registerInsuranceIpcHandlers } from './insurance-ipc';
import { registerWalletIpcHandlers } from './wallet-ipc';
import { registerAuthIpcHandlers, type AuthIpcCallbacks } from './auth-ipc';

export function registerIpcHandlers(authCallbacks: AuthIpcCallbacks): void {
  // v1.7.1：全局门禁补丁——所有 ipcMain.handle 注册的频道（含裸注册）统一经过
  // assertUnlocked：未解锁时拒绝一切非 auth 频道（此前 handleValidated 之外的频道可绕过密码锁）。
  const origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = (channel: string, listener: (...args: any[]) => any) => {
    return origHandle(channel, (event: unknown, ...args: unknown[]) => {
      assertUnlocked(channel);
      return (listener as any)(event, ...args);
    });
  };

  // IPC 连接自检（渲染进程 AIAssistant 使用）
  ipcMain.handle('app:ping', () => ({

    message: 'pong',
    timestamp: new Date().toISOString(),
  }));

  // Auto-update
  registerUpdateIpcHandlers();

  // 启动密码锁（v1.7.0）：窗口切换由 main/index.ts 回调驱动
  registerAuthIpcHandlers(authCallbacks);

  // Domain handlers
  registerAccountIpcHandlers();
  registerAssetIpcHandlers();
  registerLedgerIpcHandlers();
  registerReportIpcHandlers();
  registerSettingsIpcHandlers();
  registerInsuranceIpcHandlers();
  registerWalletIpcHandlers();
}
