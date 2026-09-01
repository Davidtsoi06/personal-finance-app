/**
 * ai-portfolio-service — 持仓快照自动导出（v1.10.14）。
 * 用户在设置中选择「AI 投资分析软件」数据文件夹后，任何持仓变化（交易/编辑/价格刷新）
 * 都会自动重写该文件夹下的 portfolio_snapshot.json——本地文件直接交换，
 * 无需下载，不会触发杀毒误报；AI 分析软件读取该文件即可获得全部持仓数据。
 */
import { getDatabase } from '../database';
import { getSetting, setSetting } from '../database/services/settings-service';

const FOLDER_KEY = 'aiPortfolio.folder';
const FILE_NAME = 'portfolio_snapshot.json';
const THROTTLE_MS = 30000;

let lastExportAt = 0;
let pendingTimer: NodeJS.Timeout | null = null;

export function setPortfolioFolder(folder: string): void {
  setSetting(FOLDER_KEY, folder);
}

export function clearPortfolioFolder(): void {
  setSetting(FOLDER_KEY, '');
}

export function getPortfolioFolder(): string {
  return getSetting(FOLDER_KEY) || '';
}

/**
 * 导出持仓快照到已配置文件夹（未配置则跳过）。
 * @param immediate 交易/编辑等即时变更传 true（立即写盘）；价格批量刷新用节流合并。
 */
export function exportPortfolioSnapshot(immediate = false): void {
  const folder = getPortfolioFolder();
  if (!folder) return;
  const now = Date.now();
  if (!immediate && now - lastExportAt < THROTTLE_MS) return;
  lastExportAt = now;
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const db = getDatabase();
    // v1.10.15：版本号从 package.json 动态读取，不硬编码（src/dist 均为三级到项目根）
    const appVersion = (require('../../../package.json') as { version?: string }).version || 'unknown';
    const assets = db.prepare(`
      SELECT a.id, a.name, a.code, a.type, a.market, a.currency, a.quantity,
        a.cost_price, a.current_price, a.market_value, a.total_cost, a.profit_loss, a.profit_loss_pct,
        ia.name as broker_name, ia.id as investment_account_id,
        acc.name as bank_name
      FROM assets a
      LEFT JOIN investment_accounts ia ON a.investment_account_id = ia.id
      LEFT JOIN accounts acc ON a.account_id = acc.id
      ORDER BY a.market_value DESC
    `).all() as any[];
    // v1.10.15：投资账户列表（含现金余额）
    const accounts = db.prepare(
      'SELECT id, name, broker, currency, cash_balance FROM investment_accounts ORDER BY id'
    ).all() as any[];
    // v1.10.15：最近 100 条交易（含持仓代码/名称）
    const transactions = db.prepare(`
      SELECT t.id, t.asset_id, t.type, t.quantity, t.price, t.fee, t.total_amount,
        t.currency, t.date, t.notes, a.code as asset_code, a.name as asset_name
      FROM transactions t
      LEFT JOIN assets a ON t.asset_id = a.id
      ORDER BY t.date DESC, t.id DESC
      LIMIT 100
    `).all() as any[];
    // v1.10.15：最近 180 天净值历史（升序返回）+ 最近一条作为 netWorth
    const netWorthRows = db.prepare(
      'SELECT date, total_cash, total_investments, net_worth FROM net_worth_history ORDER BY date DESC LIMIT 180'
    ).all() as any[];
    netWorthRows.reverse(); // 升序
    const latest = netWorthRows.length > 0 ? netWorthRows[netWorthRows.length - 1] : null;
    const snapshot = {
      app: 'personal-finance',
      version: appVersion,
      exportedAt: new Date().toISOString(),
      count: assets.length,
      holdings: assets.map((a) => ({
        code: a.code, name: a.name, market: a.market, type: a.type, currency: a.currency,
        quantity: a.quantity, costPrice: a.cost_price, currentPrice: a.current_price,
        marketValue: a.market_value, totalCost: a.total_cost, profitLoss: a.profit_loss,
        profitLossPct: a.profit_loss_pct,
        broker: a.broker_name || null, bank: a.bank_name || null,
      })),
      accounts: accounts.map((a) => ({
        id: a.id, name: a.name, broker: a.broker, currency: a.currency, cashBalance: a.cash_balance,
      })),
      transactions: transactions.map((t) => ({
        id: t.id, assetCode: t.asset_code, assetName: t.asset_name, type: t.type,
        quantity: t.quantity, price: t.price, fee: t.fee, totalAmount: t.total_amount,
        currency: t.currency, date: t.date, notes: t.notes,
      })),
      netWorth: latest ? {
        date: latest.date, totalCash: latest.total_cash, totalInvestments: latest.total_investments, netWorth: latest.net_worth,
      } : null,
      netWorthHistory: netWorthRows.map((n) => ({
        date: n.date, totalCash: n.total_cash, totalInvestments: n.total_investments, netWorth: n.net_worth,
      })),
    };
    const file = path.join(folder, FILE_NAME);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (err) {
    console.error('[aiPortfolio] 导出失败：', err);
  }
}

/** 价格批量刷新后调用：合并导出（30 秒节流），避免高频写盘 */
export function schedulePortfolioExport(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    exportPortfolioSnapshot(false);
  }, THROTTLE_MS);
}