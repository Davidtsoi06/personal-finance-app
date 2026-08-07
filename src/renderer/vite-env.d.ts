/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    ping: () => Promise<{ message: string; timestamp: string }>;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    /** Listen for update status events from main process */
    onUpdateStatus: (callback: (data: UpdateStatusEvent) => void) => void;
    removeUpdateStatusListener: () => void;
    /** Listen for AI streaming response chunks */
    onAiStreamChunk: (callback: (text: string) => void) => void;
    /** Listen for AI streaming completion */
    onAiStreamDone: (callback: (data: { success: boolean; error?: string }) => void) => void;
    /** Remove all AI stream listeners */
    removeAiStreamListeners: () => void;
  };
}

/** Update status event sent from main → renderer */
interface UpdateStatusEvent {
  event: 'checking-for-update' | 'update-available' | 'update-not-available'
    | 'download-progress' | 'update-downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
}
