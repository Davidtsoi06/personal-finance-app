import { useEffect } from 'react';

/**
 * useCurrencyRefresh — 汇率更新后自动刷新页面数据（v1.6.1）。
 * 主进程抓取新汇率后广播 currency:updated 事件，订阅的页面重新 load，
 * 避免同一时刻不同页面显示不同口径的总资产。
 */
export function useCurrencyRefresh(onRefresh: () => void): void {
  useEffect(() => {
    if (!window.electronAPI?.onCurrencyUpdated) return;
    window.electronAPI.onCurrencyUpdated(() => onRefresh());
    return () => {
      window.electronAPI.removeCurrencyUpdatedListener?.();
    };
  }, [onRefresh]);
}