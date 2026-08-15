/**
 * Custom hook for invoking Electron IPC handlers from the renderer.
 * All database access goes through this mechanism.
 */
import { useCallback } from 'react';
import type { IpcChannel } from '@shared/types/ipc';

const { electronAPI } = window;

/** Generic typed invoke helper —— channel 参数编译期校验（IpcChannel 联合类型） */
export async function invoke<T = any>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  if (!electronAPI) {
    console.warn('electronAPI not available (running outside Electron?)');
    return undefined as unknown as T;
  }
  return electronAPI.invoke(channel, ...args) as Promise<T>;
}

/** React hook — returns a bound invoke function that memoizes the channel */
export function useIpc() {
  const call = useCallback(
    <T = any>(channel: IpcChannel, ...args: unknown[]): Promise<T> => {
      return invoke<T>(channel, ...args);
    },
    []
  );
  return { invoke: call };
}
