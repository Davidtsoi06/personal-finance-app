/**
 * Custom hook for invoking Electron IPC handlers from the renderer.
 * All database access goes through this mechanism.
 */
import { useCallback } from 'react';

const { electronAPI } = window;

/** Generic typed invoke helper */
export async function invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  if (!electronAPI) {
    console.warn('electronAPI not available (running outside Electron?)');
    return undefined as unknown as T;
  }
  return electronAPI.invoke(channel, ...args) as Promise<T>;
}

/** React hook — returns a bound invoke function that memoizes the channel */
export function useIpc() {
  const call = useCallback(
    <T = any>(channel: string, ...args: unknown[]): Promise<T> => {
      return invoke<T>(channel, ...args);
    },
    []
  );
  return { invoke: call };
}
