/**
 * Data update scheduler — manages periodic data fetching.
 */
import { fetchExchangeRates } from './exchange-rate-fetcher';
import { fetchAllPrices } from './price-fetcher';
import { getDatabase } from '../database';

let intervals: ReturnType<typeof setInterval>[] = [];
let dailySummaryTimeout: ReturnType<typeof setTimeout> | null = null;

/** Schedule the daily AI summary at 15:30, then recur every 24h. */
function scheduleDailyAISummary(): void {
  if (dailySummaryTimeout) clearTimeout(dailySummaryTimeout);

  const now = new Date();
  const target = new Date(now);
  target.setHours(15, 33, 0, 0); // 15:33 to spread load off the :30 mark

  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();
  console.log(`[Scheduler] AI daily summary scheduled in ${Math.round(delayMs / 60000)} minutes (at ${target.toLocaleString()})`);

  dailySummaryTimeout = setTimeout(async () => {
    try {
      const { generateInvestmentSummary } = require('./ai-service');
      const { saveDailySummary } = require('../database/services/settings-service');
      const date = new Date().toISOString().slice(0, 10);
      console.log(`[Scheduler] 开始生成 ${date} 投资日报...`);

      const result = await generateInvestmentSummary(date);
      saveDailySummary(date, result.content);
      console.log(`[Scheduler] 投资日报已保存 (${result.content.length} 字符)`);

      // Show native notification
      try {
        const { Notification } = require('electron');
        const n = new Notification({
          title: '📊 今日投资日报已生成',
          body: `收盘总结已就绪，打开 AI 助手查看详细分析。`,
        });
        n.show();
      } catch { /* notification may fail in some environments */ }
    } catch (err: any) {
      console.error(`[Scheduler] 投资日报生成失败: ${err.message}`);
    }
    // Schedule next day
    scheduleDailyAISummary();
  }, delayMs);
}

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

  // Schedule daily AI investment summary at 15:30 (market close)
  scheduleDailyAISummary();
}

/** Stop all scheduled updates */
export function stopScheduler(): void {
  intervals.forEach(clearInterval);
  intervals = [];
  if (dailySummaryTimeout) {
    clearTimeout(dailySummaryTimeout);
    dailySummaryTimeout = null;
  }
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
