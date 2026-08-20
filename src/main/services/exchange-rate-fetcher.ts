/**
 * Exchange rate fetcher — fetches latest rates from exchangerate-api.com.
 * Free tier: ~1500 req/month, caches results to minimize requests.
 */
import { BrowserWindow } from 'electron';
import { getDatabase } from '../database';
import { updateRate } from '../database/services/currency-service';
import { recordNetWorth } from '../database/services/net-worth-service';

const API_BASE = 'https://api.exchangerate-api.com/v4/latest';

/** 汇率更新成功后广播给所有窗口，供页面自动刷新（v1.6.1：修复总览/资产管理页数据分叉） */
export function broadcastCurrencyUpdated(updated: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('currency:updated', {
        updatedAt: new Date().toISOString(),
        updated,
      });
    }
  }
}

/** Fetch and update all supported currency rates */
export async function fetchExchangeRates(): Promise<{ success: boolean; updated: number; error?: string }> {
  const db = getDatabase();
  const currencies = db.prepare('SELECT code, is_base FROM currencies').all() as any[];
  const base = currencies.find((c: any) => c.is_base === 1);
  if (!base) return { success: false, updated: 0, error: 'No base currency found' };

  try {
    const url = `${API_BASE}/${base.code}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as { rates: Record<string, number> };
    const rates = data.rates;

    let updated = 0;
    for (const currency of currencies) {
      if (currency.is_base) continue;
      const rate = rates[currency.code];
      if (rate) {
        // exchangerate-api returns rates where base currency = 1.
        // e.g., with base=CNY: rates['HKD'] = 1.08 means 1 CNY = 1.08 HKD.
        // We store rate_to_base = 1 Foreign → X CNY, so: 1 / rate.
        const baseToBase = rates[base.code]; // always 1 (base currency relative to itself)
        const baseToTarget = rates[currency.code]; // 1 unit of base = X units of target
        const rateToBase = baseToBase / baseToTarget; // 1 target = rateToBase base

        updateRate(currency.code, parseFloat(rateToBase.toFixed(6)));
        updated++;
      }
    }

    // v1.10.1：汇率更新后先重新记录当天净值（走势图同步 CNY 折算），再通知渲染端刷新展示
    if (updated > 0) {
      try {
        recordNetWorth();
      } catch (err: any) {
        console.warn('[fx] 净值记录失败（非致命）:', err?.message);
      }
      broadcastCurrencyUpdated(updated);
    }

    return { success: true, updated };
  } catch (err: any) {
    return { success: false, updated: 0, error: err.message };
  }
}

/** Fallback: fetch single rate pair */
export async function fetchSingleRate(from: string, to: string): Promise<number | null> {
  try {
    const response = await fetch(`${API_BASE}/${from}`);
    if (!response.ok) return null;
    const data = await response.json() as { rates: Record<string, number> };
    return data.rates?.[to] || null;
  } catch {
    return null;
  }
}
