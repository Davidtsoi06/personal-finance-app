import electron = require('electron');

/**
 * lock-preload — 锁屏窗口的最小权限 preload（v1.7.0）。
 * 只暴露 auth 频道：锁屏页无法触碰任何业务数据，与主进程门禁双保险。
 */
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  'auth:status',
  'auth:verify',
  'auth:quit',
  'auth:requestResetCode',
  'auth:verifyResetCode',
  'auth:resetPassword',
]);

electron.contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      console.error('[lock-preload] 已拦截未授权 IPC 频道: ' + channel);
      return Promise.reject(new Error('IPC 频道不在白名单中: ' + channel));
    }
    return electron.ipcRenderer.invoke(channel, ...args);
  },
});