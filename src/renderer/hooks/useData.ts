/**
 * Data hook — fetches data from the main process via IPC.
 * Provides loading, error, and data states for any IPC channel.
 */
import { useState, useEffect, useCallback } from 'react';
import { invoke } from './useIpc';

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Fetch data once on mount */
export function useData<T>(channel: string, ...args: unknown[]): DataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    setError(null);
    invoke<T>(channel, ...args)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch data');
        setLoading(false);
      });
  }, [channel, JSON.stringify(args)]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refresh: fetch };
}
