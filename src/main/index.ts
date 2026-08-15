import electron = require('electron');
import path = require('path');
import fs = require('fs');
import { initDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { initAutoUpdater } from './ipc/update-ipc';
import { startScheduler, stopScheduler } from './services/scheduler';
import { recordNetWorth } from './database/services/net-worth-service';
import { closeDatabase } from './database';
import { getAppName } from './database/services/settings-service';
import { recalculateAllAccountBalances } from './database/services/account-service';

let mainWindow: electron.BrowserWindow | null = null;
const startTime = Date.now();

// ── 测试/便携模式：允许通过环境变量覆盖用户数据目录（Playwright E2E 等）──
if (process.env.PF_USER_DATA_DIR) {
  electron.app.setPath('userData', process.env.PF_USER_DATA_DIR);
}

// ── 单实例锁：防止双开导致重复调度/双写数据库 ──
const gotSingleInstanceLock = electron.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 已有实例在运行，直接退出；第一个实例会收到 second-instance 事件并聚焦窗口
  electron.app.quit();
} else {
  electron.app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Global error handlers (prevent silent crash) ──
process.on('uncaughtException', (err) => {
  console.error('[Main] 未捕获异常:', err);
  electron.dialog.showErrorBox('程序错误', err?.message || String(err));
  electron.app.quit();
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Main] 未处理的Promise拒绝:', reason);
});

function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: getAppName(),
    backgroundColor: '#F5F7FA',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 开发模式（ELECTRON_DEV=1，见 npm run dev）优先加载 Vite dev server（真 HMR）；
  // 生产模式加载构建产物；两者皆无时回退到 dev server。
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const builtHtml = path.join(__dirname, '../../renderer/index.html');
  if (process.env.ELECTRON_DEV === '1') {
    mainWindow.loadURL(devServerUrl);
  } else if (fs.existsSync(builtHtml)) {
    mainWindow.loadFile(builtHtml);
  } else {
    mainWindow.loadURL(devServerUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize database and IPC on startup
electron.app.whenReady().then(() => {
  try {
    console.log('[Main] 步骤 1/6: 初始化数据库...');
    initDatabase();
    console.log('[Main] 步骤 1/6: ✓ 数据库就绪');

    console.log('[Main] 步骤 2/5: 注册 IPC 处理器...');
    registerIpcHandlers();
    console.log('[Main] 步骤 2/5: ✓ IPC 就绪');

    console.log('[Main] 步骤 3/5: 初始化自动更新...');
    initAutoUpdater();
    console.log('[Main] 步骤 3/5: ✓ 自动更新就绪');

    console.log('[Main] 步骤 4/5: 启动定时调度器...');
    startScheduler();
    console.log('[Main] 步骤 4/5: ✓ 调度器就绪');

    console.log('[Main] 步骤 5/5: 创建主窗口...');
    createWindow();
    console.log('[Main] 步骤 5/5: ✓ 主窗口已创建');
    console.log(`[Main] ✓ 启动完成（窗口可见），总耗时 ${Date.now() - startTime}ms`);

    // ── 窗口创建后的后台一致性任务（不阻塞首屏）──
    setTimeout(() => {
      try {
        const balanceResult = recalculateAllAccountBalances();
        console.log(`[Main] 后台: ✓ 余额重算完成（${balanceResult.updated} 账户）`);
      } catch (err: any) {
        console.error(`[Main] 后台: ⚠ 余额重算失败（非致命）: ${err.message}`);
      }
      try {
        recordNetWorth();
        console.log('[Main] 后台: ✓ 净资产已记录');
      } catch (err: any) {
        console.error(`[Main] 后台: ⚠ 净资产记录失败（非致命）: ${err.message}`);
      }
    }, 0);
  } catch (err: any) {
    console.error('[Main] ❌ 启动失败:', err);
    electron.dialog.showErrorBox(
      '启动失败',
      `应用启动时发生错误，请截图后联系开发者：\n\n${err?.message || String(err)}\n\n堆栈：${err?.stack?.slice(0, 500) || '无'}`
    );
    electron.app.quit();
  }
}).catch((err: any) => {
  console.error('[Main] whenReady 失败:', err);
  electron.dialog.showErrorBox(
    '启动失败',
    `应用初始化失败：\n\n${err?.message || String(err)}`
  );
  electron.app.quit();
});

electron.app.on('window-all-closed', () => {
  stopScheduler();
  closeDatabase();
  if (process.platform !== 'darwin') {
    electron.app.quit();
  }
});

electron.app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
