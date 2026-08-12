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

  // Load built files if available, otherwise try Vite dev server
  const builtHtml = path.join(__dirname, '../../renderer/index.html');
  if (fs.existsSync(builtHtml)) {
    mainWindow.loadFile(builtHtml);
  } else {
    mainWindow.loadURL('http://localhost:5173');
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

    console.log('[Main] 步骤 2/6: 重算账户余额 CNY 等值...');
    try {
      const balanceResult = recalculateAllAccountBalances();
      console.log(`[Main] 步骤 2/6: ✓ ${balanceResult.updated} 账户已更新`);
    } catch (err: any) {
      console.error(`[Main] 步骤 2/6: ⚠ 余额重算失败（非致命，继续启动）: ${err.message}`);
    }

    console.log('[Main] 步骤 3/6: 注册 IPC 处理器...');
    registerIpcHandlers();
    console.log('[Main] 步骤 3/6: ✓ IPC 就绪');

    console.log('[Main] 步骤 4/6: 初始化自动更新...');
    initAutoUpdater();
    console.log('[Main] 步骤 4/6: ✓ 自动更新就绪');

    console.log('[Main] 步骤 5/6: 启动定时调度器 + 记录净资产...');
    startScheduler();
    try {
      recordNetWorth();
      console.log('[Main] 步骤 5/6: ✓ 净资产已记录');
    } catch (err: any) {
      console.error(`[Main] 步骤 5/6: ⚠ 净资产记录失败（非致命）: ${err.message}`);
    }

    console.log('[Main] 步骤 6/6: 创建主窗口...');
    createWindow();
    console.log('[Main] 步骤 6/6: ✓ 主窗口已创建');
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
