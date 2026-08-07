import electron = require('electron');

/**
 * Preload script - exposes a safe API to the renderer process.
 * All communication between renderer and main process goes through here.
 */
electron.contextBridge.exposeInMainWorld('electronAPI', {
  // Ping test
  ping: () => electron.ipcRenderer.invoke('app:ping'),

  // Generic invoke helper
  invoke: (channel: string, ...args: unknown[]) =>
    electron.ipcRenderer.invoke(channel, ...args),

  // ── Update events (main → renderer) ──
  onUpdateStatus: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('update:status', (_event, data) => callback(data));
  },
  removeUpdateStatusListener: () => {
    electron.ipcRenderer.removeAllListeners('update:status');
  },

  // ── AI stream events (main → renderer) ──
  onAiStreamChunk: (callback: (text: string) => void) => {
    electron.ipcRenderer.on('ai:streamChunk', (_event, text) => callback(text));
  },
  onAiStreamDone: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('ai:streamDone', (_event, data) => callback(data));
  },
  removeAiStreamListeners: () => {
    electron.ipcRenderer.removeAllListeners('ai:streamChunk');
    electron.ipcRenderer.removeAllListeners('ai:streamDone');
  },
});
