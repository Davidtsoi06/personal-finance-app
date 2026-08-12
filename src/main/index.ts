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
  // Initialize database (creates tables if needed)
  initDatabase();

  // One-time fix: recalculate all account balances to CNY-equivalent
  const balanceResult = recalculateAllAccountBalances();
  console.log(`[Main] 账户余额 CNC 等值重算完成: ${balanceResult.updated} 账户`);

  // Register all IPC handlers
  registerIpcHandlers();

  // Initialize auto-updater (production only)
  initAutoUpdater();

  // Start periodic data updates
  startScheduler();

  // Record today's net worth snapshot
  recordNetWorth();

  // Create the main window
  createWindow();
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
