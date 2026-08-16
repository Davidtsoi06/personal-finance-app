/// <reference types="vite/client" />
import type { IpcChannel } from '@shared/types/ipc';

declare global {
  interface Window {
    electronAPI: {
      ping: () => Promise<{ message: string; timestamp: string }>;
      invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>;
      /** Listen for update status events from main process */
      onUpdateStatus: (callback: (data: UpdateStatusEvent) => void) => void;
      removeUpdateStatusListener: () => void;
      /** Listen for currency rate update events (v1.6.1) */
      onCurrencyUpdated: (callback: (data: CurrencyUpdatedEvent) => void) => void;
      removeCurrencyUpdatedListener: () => void;
      /** Listen for price update events (v1.8.0) */
      onPricesUpdated: (callback: (data: PricesUpdatedEvent) => void) => void;
      removePricesUpdatedListener: () => void;
      /** Listen for AI streaming response chunks */
      onAiStreamChunk: (callback: (text: string) => void) => void;
      /** Listen for AI streaming completion */
      onAiStreamDone: (callback: (data: { success: boolean; error?: string }) => void) => void;
      /** Remove all AI stream listeners */
      removeAiStreamListeners: () => void;
    };
  }

  /** Currency rate update event sent from main → renderer (v1.6.1) */
  interface CurrencyUpdatedEvent {
    updatedAt: string;
    updated: number;
  }

  /** Price update event sent from main → renderer (v1.8.0) */
  interface PricesUpdatedEvent {
    updatedAt: string;
    updated: number;
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
}

export {};
