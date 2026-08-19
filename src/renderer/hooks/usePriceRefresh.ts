import { useEffect } from 'react';

/**
 * usePriceRefresh — 股价更新后自动刷新页面数据（v1.10.0）。
 * 主进程每次抓取/更新股价后广播 prices:updated（v1.8.0 已有），
 * 此前渲染端从未监听——订阅后总资产/市值随股价更新自动同步，无需手动刷新。
 */
export function usePriceRefresh(onRefresh: () => void): void {
  useEffect(() => {
    if (!window.electronAPI?.onPricesUpdated) return;
    window.electronAPI.onPricesUpdated(() => onRefresh());
    return () => {
      window.electronAPI.removePricesUpdatedListener?.();
    };
  }, [onRefresh]);
}
