/**
 * Data update scheduler — manages periodic data fetching.
 */
import { fetchExchangeRates } from './exchange-rate-fetcher';
import { fetchAllPrices } from './price-fetcher';
import { getDatabase } from '../database';

let intervals: ReturnType<typeof setInterval>[] = [];

/** Start periodic data updates */
export function startScheduler(): void {
  console.log('Starting data update scheduler...');

  // Fetch exchange rates every 6 hours
  fetchExchangeRates().then((r) => {
    console.log(`Exchange rates: updated ${r.updated} currencies`);
  });

  intervals.push(
    setInterval(() => {
      fetchExchangeRates().then((r) => {
        console.log(`Exchange rates: updated ${r.updated} currencies`);
      });
    }, 6 * 60 * 60 * 1000)
  );

  // Fetch asset prices every 30 minutes with price alert checking
  intervals.push(
    setInterval(() => {
      fetchAllPricesWithAlerts().then((r) => {
        console.log(`Prices: updated ${r.updated}/${r.total} assets, ${r.alerts} alerts`);
      });
    }, 30 * 60 * 1000)
  );
}

/** Stop all scheduled updates */
export function stopScheduler(): void {
  intervals.forEach(clearInterval);
  intervals = [];
}

/** Run a manual full update (exchange rates + all prices) */
export async function runManualUpdate(): Promise<{
  rates: { success: boolean; updated: number; error?: string };
  prices: { success: boolean; total: number; updated: number; errors: string[] };
}> {
  const rates = await fetchExchangeRates();
  await new Promise((r) => setTimeout(r, 500));
  const prices = await fetchAllPrices();
  return { rates, prices };
}

/** Fetch prices and check for price alerts, sending notifications if triggered. */
async function fetchAllPricesWithAlerts(): Promise<{ total: number; updated: number; alerts: number }> {
  const db = getDatabase();

  // Snapshot old prices before refresh
  const oldPrices = new Map<number, number>();
  const assets = db.prepare('SELECT id, current_price FROM assets WHERE quantity > 0').all() as any[];
  for (const a of assets) oldPrices.set(a.id, a.current_price);

  const result = await fetchAllPrices();

  // Compare and check alerts
  const newPrices = new Map<number, number>();
  const updated = db.prepare('SELECT id, current_price FROM assets WHERE quantity > 0').all() as any[];
  for (const a of updated) newPrices.set(a.id, a.current_price);

  try {
    const { checkPriceAlerts } = require('../database/services/alert-service');
    const alerts = checkPriceAlerts(oldPrices, newPrices);

    // Send Electron notifications for triggered alerts
    if (alerts.length > 0) {
      const { Notification } = require('electron');
      for (const alert of alerts) {
        const emoji = alert.direction === 'drop' ? '📉' : '📈';
        const label = alert.direction === 'drop' ? '下跌' : '上涨';
        const n = new Notification({
          title: `${emoji} ${alert.assetName} (${alert.assetCode}) ${label} ${Math.abs(alert.changePct)}%`,
          body: `当前价 ${alert.currency === 'HKD' ? 'HK$' : '¥'}${alert.newPrice.toFixed(2)} · 持仓 ${alert.quantity} 股 · 市值 ${alert.currency === 'HKD' ? 'HK$' : '¥'}${alert.marketValue.toLocaleString()}`,
        });
        n.show();
      }
    }
    return { total: result.total, updated: result.updated, alerts: alerts.length };
  } catch {
    return { total: result.total, updated: result.updated, alerts: 0 };
  }
}
