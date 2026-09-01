/**
 * Data update scheduler — manages periodic data fetching.
 */
import { fetchExchangeRates } from './exchange-rate-fetcher';
import { fetchAllPrices } from './price-fetcher';
import { getDatabase } from '../database';

let intervals: ReturnType<typeof setInterval>[] = [];
let dailySummaryTimeout: ReturnType<typeof setTimeout> | null = null;
let premiumCheckTimeout: ReturnType<typeof setTimeout> | null = null;
let tradeReportTimeout: ReturnType<typeof setTimeout> | null = null;

/** Check for insurance premiums due today or within 7 days, send notifications. */
function schedulePremiumDueCheck(): void {
  if (premiumCheckTimeout) clearTimeout(premiumCheckTimeout);

  const now = new Date();
  const target = new Date(now);
  target.setHours(8, 57, 0, 0); // 8:57 AM daily

  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();

  premiumCheckTimeout = setTimeout(async () => {
    try {
      const db = getDatabase();
      const month = new Date().getMonth() + 1;
      const day = new Date().getDate();

      // Find policies with premium due this month, within a 30-day window
      const duePolicies = db.prepare(`
        SELECT * FROM insurance_policies
        WHERE is_active = 1
          AND premium_due_month IS NOT NULL
          AND premium_due_month = ?
          AND premium_due_day IS NOT NULL
          AND premium_due_day BETWEEN ? AND ?
        ORDER BY premium_due_day
      `).all(month, day, Math.min(day + 7, 31)) as any[];

      if (duePolicies.length > 0) {
        try {
          const { Notification } = require('electron');
          for (const policy of duePolicies) {
            const daysUntil = (policy.premium_due_day - day);
            const urgency = daysUntil <= 0 ? '🔔 今天到期' : `⏰ ${daysUntil}天后到期`;
            const n = new Notification({
              title: `${urgency}：${policy.name}`,
              body: `年保费 ¥${(policy.annual_premium || 0).toLocaleString()} · ${policy.company || '未知公司'} · 现金价值 ¥${(policy.cash_value || 0).toLocaleString()}`,
            });
            n.show();
          }
        } catch { /* notification may fail */ }
      }
    } catch (err: any) {
      console.error(`[Scheduler] 保费提醒检查失败: ${err.message}`);
    }
    schedulePremiumDueCheck();
  }, delayMs);

  console.log(`[Scheduler] Premium due check scheduled in ${Math.round(delayMs / 60000)} minutes`);
}

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

/** Schedule the daily trade report check at 16:35 (after HK market 16:00 close). */
function scheduleDailyTradeReportCheck(): void {
  if (tradeReportTimeout) clearTimeout(tradeReportTimeout);

  const now = new Date();
  const target = new Date(now);
  target.setHours(16, 35, 0, 0); // 16:35 to spread load off the :30 mark

  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();

  tradeReportTimeout = setTimeout(async () => {
    try {
      const { getDailyTrades } = require('./report-export-service');
      const date = new Date().toISOString().slice(0, 10);
      const { rows, summary } = getDailyTrades(date);

      if (rows.length > 0) {
        const pnlText = summary.realizedPnl >= 0 ? '+' : '';
        try {
          const { Notification } = require('electron');
          const n = new Notification({
            title: `📊 今日交易报表已生成（${date}）`,
            body: `${summary.totalCount} 笔交易 · 买入 ¥${summary.buyAmount.toLocaleString()} / 卖出 ¥${summary.sellAmount.toLocaleString()} · 已实现盈亏 ${pnlText}¥${summary.realizedPnl.toLocaleString()}`,
          });
          n.show();
        } catch { /* notification may fail */ }
      }
    } catch (err: any) {
      console.error(`[Scheduler] 交易报表检查失败: ${err.message}`);
    }
    scheduleDailyTradeReportCheck();
  }, delayMs);

  console.log(`[Scheduler] Daily trade report check scheduled in ${Math.round(delayMs / 60000)} minutes`);
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

  // Schedule daily premium due check at 8:57 AM
  schedulePremiumDueCheck();

  // Schedule daily trade report check at 16:35 (after HK market close)
  scheduleDailyTradeReportCheck();
}

/** Stop all scheduled updates */
export function stopScheduler(): void {
  intervals.forEach(clearInterval);
  intervals = [];
  if (dailySummaryTimeout) {
    clearTimeout(dailySummaryTimeout);
    dailySummaryTimeout = null;
  }
  if (premiumCheckTimeout) {
    clearTimeout(premiumCheckTimeout);
    premiumCheckTimeout = null;
  }
  if (tradeReportTimeout) {
    clearTimeout(tradeReportTimeout);
    tradeReportTimeout = null;
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
    // v1.10.14：价格刷新后合并导出 AI 持仓快照（30 秒节流）
    try {
      const { schedulePortfolioExport } = require('./ai-portfolio-service');
      schedulePortfolioExport();
    } catch { /* 忽略 */ }
    return { total: result.total, updated: result.updated, alerts: alerts.length };
  } catch {
    return { total: result.total, updated: result.updated, alerts: 0 };
  }
}
