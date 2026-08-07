/**
 * Auto-update IPC handlers — check, download, and install updates via GitHub Releases.
 */
import electron = require('electron');
import { autoUpdater, UpdateInfo } from 'electron-updater';

/** Check if we're running a packaged (production) build */
function isPackaged(): boolean {
  return electron.app.isPackaged;
}

/**
 * Register update-related IPC handlers.
 * In development (unpackaged), these are no-ops that return DEV_MODE responses.
 * In production, they communicate with electron-updater to pull from GitHub Releases.
 */
export function registerUpdateIpcHandlers(): void {
  const { ipcMain } = electron;
  const DEV_MODE = !isPackaged();

  // ── Check for updates ──
  ipcMain.handle('update:check', async () => {
    if (DEV_MODE) {
      return {
        devMode: true,
        updateAvailable: false,
        message: '开发模式：更新功能仅在打包后可用的exe中生效',
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo.version !== electron.app.getVersion()) {
        return {
          devMode: false,
          updateAvailable: true,
          currentVersion: electron.app.getVersion(),
          latestVersion: result.updateInfo.version,
          releaseDate: result.updateInfo.releaseDate,
          releaseNotes: result.updateInfo.releaseNotes,
        };
      }
      return {
        devMode: false,
        updateAvailable: false,
        currentVersion: electron.app.getVersion(),
        latestVersion: electron.app.getVersion(),
        message: '已是最新版本',
      };
    } catch (err: any) {
      return {
        devMode: false,
        updateAvailable: false,
        error: err.message || '检查更新失败',
      };
    }
  });

  // ── Download update ──
  ipcMain.handle('update:download', async () => {
    if (DEV_MODE) {
      return { devMode: true, message: '开发模式：无法下载更新' };
    }

    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || '下载失败' };
    }
  });

  // ── Install update (quit + install) ──
  ipcMain.handle('update:install', async () => {
    if (DEV_MODE) {
      return { devMode: true };
    }
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });

  // ── Get current version ──
  ipcMain.handle('update:getVersion', () => {
    return {
      version: electron.app.getVersion(),
      devMode: DEV_MODE,
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
    };
  });
}

/**
 * Start auto-update checking (called once on app startup in production).
 * Sends events to the renderer via the main window's webContents.
 */
export function initAutoUpdater(): void {
  const DEV_MODE = !isPackaged();
  if (DEV_MODE) {
    console.log('[updater] Dev mode — auto-updater disabled');
    return;
  }

  // Configure autoUpdater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Forward events to renderer
  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update:status', { event: 'checking-for-update' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    sendToRenderer('update:status', {
      event: 'update-available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    sendToRenderer('update:status', {
      event: 'update-not-available',
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
    sendToRenderer('update:status', {
      event: 'download-progress',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    sendToRenderer('update:status', {
      event: 'update-downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (error: Error) => {
    sendToRenderer('update:status', {
      event: 'error',
      message: error.message,
    });
  });

  // Check for updates on startup (after a short delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Startup check failed:', err.message);
    });
  }, 3000);
}

/** Send an update status event to the main window's renderer */
function sendToRenderer(channel: string, data: unknown): void {
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}
