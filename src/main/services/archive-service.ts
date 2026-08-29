/**
 * Archive service — monthly investment statistics Excel report generation
 * and old data cleanup. Archives data older than the configured retention period.
 */
import { getDatabase } from '../database/index';
import { reconcileAssetCostBasis } from '../database/services/transaction-service';
import { removeFlowsForTransactionInDb } from '../database/services/cash-flow-core';
import { updateAccountBalance } from '../database/services/account-service';
import { getSetting, setSetting } from '../database/services/settings-service';
import path from 'path';
import fs from 'fs';

// ── Types ──

export interface PendingMonth {
  month: string;       // '2025-06'
  monthLabel: string;  // '2025年6月'
  transactionCount: number;
  ledgerCount: number;
  accountTxnCount: number;
}

export interface ArchiveResult {
  month: string;
  monthLabel: string;
  filePath: string;
  transactionsArchived: number;
  ledgersArchived: number;
  accountTxnsArchived: number;
  success: boolean;
  error?: string;
}

// ── Helpers ──

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

function getRetentionMonths(): number {
  const val = getSetting('archive.retentionMonths');
  return val ? parseInt(val, 10) : 12;
}

function getArchiveFolder(): string {
  return getSetting('archive.folderPath') || '';
}

// ── Core ──

/** List months that have data older than the retention period. */
export function getPendingMonths(): PendingMonth[] {
  const db = getDatabase();
  const retentionMonths = getRetentionMonths();

  // Calculate cutoff: first day of the month that is <retentionMonths> ago
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths + 1, 1);
  const cutoffStr = cutoff.toISOString().slice(0, 7); // 'YYYY-MM'

  // Find distinct months in transactions, ledgers, account_transactions before cutoff
  const txMonths = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', date) as month
    FROM transactions WHERE date < ? || '-01'
    ORDER BY month ASC
  `).all(cutoffStr) as { month: string }[];

  const ledgerMonths = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', date) as month
    FROM ledgers WHERE date < ? || '-01'
    ORDER BY month ASC
  `).all(cutoffStr) as { month: string }[];

  const atMonths = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', date) as month
    FROM account_transactions WHERE date < ? || '-01'
    ORDER BY month ASC
  `).all(cutoffStr) as { month: string }[];

  // Merge all unique months
  const monthSet = new Set<string>();
  for (const m of txMonths) monthSet.add(m.month);
  for (const m of ledgerMonths) monthSet.add(m.month);
  for (const m of atMonths) monthSet.add(m.month);

  const result: PendingMonth[] = [];
  for (const month of [...monthSet].sort()) {
    const txCount = db.prepare(
      "SELECT COUNT(*) as c FROM transactions WHERE strftime('%Y-%m', date) = ?"
    ).get(month) as { c: number };
    const ledgerCount = db.prepare(
      "SELECT COUNT(*) as c FROM ledgers WHERE strftime('%Y-%m', date) = ?"
    ).get(month) as { c: number };
    const atCount = db.prepare(
      "SELECT COUNT(*) as c FROM account_transactions WHERE strftime('%Y-%m', date) = ?"
    ).get(month) as { c: number };

    if (txCount.c > 0 || ledgerCount.c > 0 || atCount.c > 0) {
      result.push({
        month,
        monthLabel: monthLabel(month),
        transactionCount: txCount.c,
        ledgerCount: ledgerCount.c,
        accountTxnCount: atCount.c,
      });
    }
  }

  return result;
}

/** Generate monthly investment statistics Excel workbook buffer. */
function generateMonthlyReport(month: string): Buffer {
  const xlsx = require('xlsx') as typeof import('xlsx');
  const db = getDatabase();
  const label = monthLabel(month);
  const monthStart = `${month}-01`;
  // last day of month
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  // ── Fetch data ──

  // Investment transactions for the month
  const trades = db.prepare(`
    SELECT t.date, a.name, a.code, t.type, t.quantity, t.price, t.fee,
           t.total_amount, t.currency, t.notes
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date >= ? AND t.date <= ?
    ORDER BY t.date ASC, t.id ASC
  `).all(monthStart, monthEnd) as any[];

  // Per-stock aggregation
  const stockStats = db.prepare(`
    SELECT a.name, a.code,
      SUM(CASE WHEN t.type = 'buy' THEN 1 ELSE 0 END) as buy_count,
      SUM(CASE WHEN t.type = 'sell' THEN 1 ELSE 0 END) as sell_count,
      SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE 0 END) as buy_qty,
      SUM(CASE WHEN t.type = 'sell' THEN t.quantity ELSE 0 END) as sell_qty,
      SUM(CASE WHEN t.type = 'buy' THEN t.total_amount ELSE 0 END) as buy_amount,
      SUM(CASE WHEN t.type = 'sell' THEN t.total_amount ELSE 0 END) as sell_amount,
      AVG(CASE WHEN t.type = 'buy' THEN t.price ELSE NULL END) as avg_buy_price,
      AVG(CASE WHEN t.type = 'sell' THEN t.price ELSE NULL END) as avg_sell_price
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date >= ? AND t.date <= ? AND t.type IN ('buy', 'sell')
    GROUP BY a.id
    ORDER BY (SUM(CASE WHEN t.type = 'buy' THEN t.total_amount ELSE 0 END) +
              SUM(CASE WHEN t.type = 'sell' THEN t.total_amount ELSE 0 END)) DESC
  `).all(monthStart, monthEnd) as any[];

  // Summary stats
  const summary = db.prepare(`
    SELECT
      COUNT(CASE WHEN type = 'buy' THEN 1 END) as buy_count,
      COUNT(CASE WHEN type = 'sell' THEN 1 END) as sell_count,
      COUNT(CASE WHEN type = 'dividend' THEN 1 END) as div_count,
      COUNT(CASE WHEN type = 'split' THEN 1 END) as split_count,
      SUM(CASE WHEN type = 'buy' THEN total_amount ELSE 0 END) as total_buy,
      SUM(CASE WHEN type = 'sell' THEN total_amount ELSE 0 END) as total_sell,
      SUM(CASE WHEN type = 'dividend' THEN total_amount ELSE 0 END) as total_div,
      SUM(fee) as total_fee,
      COUNT(DISTINCT asset_id) as stock_count
    FROM transactions
    WHERE date >= ? AND date <= ?
  `).get(monthStart, monthEnd) as any;

  // Ledgers for the month
  const ledgers = db.prepare(`
    SELECT l.date, l.type, c.name as category, l.amount, l.currency,
           a2.name as account_name, l.description
    FROM ledgers l
    LEFT JOIN categories c ON l.category_id = c.id
    LEFT JOIN accounts a2 ON l.account_id = a2.id
    WHERE l.date >= ? AND l.date <= ?
    ORDER BY l.date ASC, l.id ASC
  `).all(monthStart, monthEnd) as any[];

  // ── Build workbook ──

  const workbook = xlsx.utils.book_new();

  // Sheet 1: 月度汇总
  {
    const summaryData: any[][] = [
      [`📊 投资统计报告 — ${label}`],
      [''],
      ['=== 交易总览 ==='],
      ['买入次数', summary?.buy_count || 0],
      ['卖出次数', summary?.sell_count || 0],
      ['分红记录', summary?.div_count || 0],
      ['分拆记录', summary?.split_count || 0],
      ['涉及股票数', summary?.stock_count || 0],
      [''],
      ['=== 金额统计 ==='],
      ['买入总金额', summary?.total_buy || 0],
      ['卖出总金额', summary?.total_sell || 0],
      ['分红收入', summary?.total_div || 0],
      ['总手续费', summary?.total_fee || 0],
      ['净现金流出（买入 - 卖出 - 分红 + 手续费）',
        (summary?.total_buy || 0) - (summary?.total_sell || 0) - (summary?.total_div || 0) + (summary?.total_fee || 0)],
      [''],
      ['=== 本月新增持仓 ==='],
    ];

    // Add stocks that had net buying
    for (const s of stockStats) {
      const netQty = (s.buy_qty || 0) - (s.sell_qty || 0);
      if (netQty > 0) {
        summaryData.push([`${s.name} (${s.code})`, `净买入 ${netQty} 股，投入 ¥${((s.buy_amount || 0) - (s.sell_amount || 0)).toLocaleString()}`]);
      }
    }

    summaryData.push(['']);
    summaryData.push(['=== 本月清仓/减持 ===']);
    for (const s of stockStats) {
      const netQty = (s.buy_qty || 0) - (s.sell_qty || 0);
      if (netQty < 0) {
        summaryData.push([`${s.name} (${s.code})`, `净卖出 ${Math.abs(netQty)} 股，回收 ¥${((s.sell_amount || 0) - (s.buy_amount || 0)).toLocaleString()}`]);
      }
    }
    // If no sells, note that
    const hasNetSells = stockStats.some((s: any) => (s.buy_qty || 0) - (s.sell_qty || 0) < 0);
    if (!hasNetSells) {
      summaryData.push(['（本月无清仓或减持操作）']);
    }

    const ws = xlsx.utils.aoa_to_sheet(summaryData);
    ws['!cols'] = [{ wch: 30 }, { wch: 50 }];
    xlsx.utils.book_append_sheet(workbook, ws, '月度汇总');
  }

  // Sheet 2: 交易明细
  {
    const headers = ['日期', '股票名称', '代码', '方向', '数量', '成交价', '手续费', '总金额', '币种', '备注'];
    const typeMap: Record<string, string> = { buy: '买入', sell: '卖出', dividend: '分红', split: '分拆' };
    const rows = trades.map((t: any) => [
      t.date,
      t.name,
      t.code,
      typeMap[t.type] || t.type,
      t.quantity,
      t.price,
      t.fee,
      t.total_amount,
      t.currency,
      t.notes || '',
    ]);
    const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 8 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 20 },
    ];
    xlsx.utils.book_append_sheet(workbook, ws, '交易明细');
  }

  // Sheet 3: 个股统计
  {
    const headers = ['股票名称', '代码', '买入次数', '卖出次数', '买入股数', '卖出股数',
      '买入金额', '卖出金额', '净买入股数', '净买入金额', '平均买入价', '平均卖出价'];
    const rows = stockStats.map((s: any) => [
      s.name,
      s.code,
      s.buy_count,
      s.sell_count,
      s.buy_qty || 0,
      s.sell_qty || 0,
      (s.buy_amount || 0).toFixed(2),
      (s.sell_amount || 0).toFixed(2),
      (s.buy_qty || 0) - (s.sell_qty || 0),
      ((s.buy_amount || 0) - (s.sell_amount || 0)).toFixed(2),
      s.avg_buy_price ? (s.avg_buy_price).toFixed(3) : '-',
      s.avg_sell_price ? (s.avg_sell_price).toFixed(3) : '-',
    ]);
    const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];
    xlsx.utils.book_append_sheet(workbook, ws, '个股统计');
  }

  // Sheet 4: 收支流水 (only if ledgers exist)
  if (ledgers.length > 0) {
    const headers = ['日期', '类型', '分类', '金额', '币种', '账户', '描述'];
    const typeMap: Record<string, string> = { income: '收入', expense: '支出' };
    const rows = ledgers.map((l: any) => [
      l.date,
      typeMap[l.type] || l.type,
      l.category || '',
      l.amount,
      l.currency,
      l.account_name || '',
      l.description || '',
    ]);
    const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
      { wch: 8 }, { wch: 16 }, { wch: 30 },
    ];
    xlsx.utils.book_append_sheet(workbook, ws, '收支流水');
  }

  // Sheet 5+6: v1.10.6 全局资产快照（与资产管理页同口径）
  {
    const { getAllAssetsSummary } = require('../database/services/account-service');
    const items = getAllAssetsSummary() as any[];
    const typeLabel: Record<string, string> = {
      bank: '银行账户', cash: '现金', e_wallet: '电子钱包',
      investment: '券商账户', insurance: '保险', other: '其他',
    };
    const byType = new Map<string, number>();
    let total = 0;
    const rows: (string | number)[][] = [['类别', '账户', '金额(CNY 等值)']];
    for (const it of items) {
      const v = Number(it.market_value_cny) || 0;
      total += v;
      byType.set(it.asset_type, (byType.get(it.asset_type) || 0) + v);
      rows.push([typeLabel[it.asset_type] || it.asset_type, it.name, Math.round(v * 100) / 100]);
    }
    rows.push(['总资产', '—', Math.round(total * 100) / 100]);
    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 16 }];
    xlsx.utils.book_append_sheet(workbook, ws, '资产快照');

    const pRows: (string | number)[][] = [['类别', '金额(CNY 等值)', '占比(%)']];
    for (const [k, v] of byType) {
      pRows.push([typeLabel[k] || k, Math.round(v * 100) / 100, total > 0 ? Math.round((v / total) * 10000) / 100 : 0]);
    }
    pRows.push(['总资产', Math.round(total * 100) / 100, 100]);
    const ws2 = xlsx.utils.aoa_to_sheet(pRows);
    ws2['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 10 }];
    xlsx.utils.book_append_sheet(workbook, ws2, '资产分类占比');
  }

  // Write to buffer
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

/** Execute archive for the given months. Saves Excel files and deletes data. */
export function executeArchive(months: string[]): ArchiveResult[] {
  const folderPath = getArchiveFolder();
  if (!folderPath) {
    throw new Error('请先设置归档文件夹路径');
  }

  // Ensure folder exists
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const results: ArchiveResult[] = [];

  for (const month of months) {
    const result: ArchiveResult = {
      month,
      monthLabel: monthLabel(month),
      filePath: '',
      transactionsArchived: 0,
      ledgersArchived: 0,
      accountTxnsArchived: 0,
      success: false,
    };

    try {
      // Generate Excel
      const buffer = generateMonthlyReport(month);

      // Save file
      const fileName = `投资统计_${month}.xlsx`;
      const fullPath = path.join(folderPath, fileName);
      fs.writeFileSync(fullPath, buffer);
      result.filePath = fullPath;

      // Delete data（v1.7.1：先反冲余额/持仓/现金流，再删除，全程事务）
      const db = getDatabase();
      const monthStart = month + '-01';
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const monthEnd = month + '-' + String(lastDay).padStart(2, '0');

      const run = db.transaction(() => {
        // 1. 删除该月交易及关联现金流（外键必须先清）；
        //    v1.10.8：删除后按剩余历史交易重放校准持仓（替代逐笔流式反转，精确还原）
        const monthTx = db.prepare(
          'SELECT * FROM transactions WHERE date >= ? AND date <= ?'
        ).all(monthStart, monthEnd) as any[];
        const affectedAssetIds = new Set<number>();
        for (const t of monthTx) {
          affectedAssetIds.add(t.asset_id);
          removeFlowsForTransactionInDb(db, t.id);
        }
        for (const t of monthTx) {
          db.prepare('DELETE FROM transactions WHERE id = ?').run(t.id);
        }
        for (const assetId of affectedAssetIds) {
          reconcileAssetCostBasis(assetId);
        }

        // 2. 反冲存取记录对账户余额的影响
        const monthAt = db.prepare(
          'SELECT * FROM account_transactions WHERE date >= ? AND date <= ?'
        ).all(monthStart, monthEnd) as any[];
        for (const at of monthAt) {
          // 取出曾扣减余额 → 加回；存入曾增加 → 减回
          updateAccountBalance(at.account_id, at.currency || 'CNY', at.type === 'withdraw' ? at.amount : -at.amount);
        }

        // 3. 反冲记账对账户余额的影响
        const monthLedger = db.prepare(
          'SELECT * FROM ledgers WHERE date >= ? AND date <= ?'
        ).all(monthStart, monthEnd) as any[];
        for (const lg of monthLedger) {
          if (!lg.account_id) continue;
          updateAccountBalance(lg.account_id, lg.currency || 'CNY', lg.type === 'income' ? -lg.amount : lg.amount);
        }

        // 4. 删除
        const delTx = db.prepare(
          'DELETE FROM transactions WHERE date >= ? AND date <= ?'
        ).run(monthStart, monthEnd);
        result.transactionsArchived = delTx.changes;

        const delLedger = db.prepare(
          'DELETE FROM ledgers WHERE date >= ? AND date <= ?'
        ).run(monthStart, monthEnd);
        result.ledgersArchived = delLedger.changes;

        const delAt = db.prepare(
          'DELETE FROM account_transactions WHERE date >= ? AND date <= ?'
        ).run(monthStart, monthEnd);
        result.accountTxnsArchived = delAt.changes;

        // Clean up asset_prices and exchange_rates for this month
        db.prepare(
          'DELETE FROM asset_prices WHERE date >= ? AND date <= ?'
        ).run(monthStart, monthEnd);

        db.prepare(
          'DELETE FROM exchange_rates WHERE date >= ? AND date <= ?'
        ).run(monthStart, monthEnd);
      });

      run();
      result.success = true;
    } catch (err: any) {
      result.error = err.message;
    }

    results.push(result);
  }

  // Record last archive date
  setSetting('archive.lastRun', new Date().toISOString().slice(0, 10));

  return results;
}

/** Set archive folder path (from folder dialog result). */
export function setArchiveFolder(folderPath: string): void {
  setSetting('archive.folderPath', folderPath);
}

/** Get archive settings. */
export function getArchiveSettings(): {
  folderPath: string;
  retentionMonths: number;
  lastRun: string | null;
} {
  return {
    folderPath: getArchiveFolder(),
    retentionMonths: getRetentionMonths(),
    lastRun: getSetting('archive.lastRun'),
  };
}

/** Update retention months. */
export function setRetentionMonths(months: number): void {
  setSetting('archive.retentionMonths', String(months));
}

/** Get the cutoff date string (first day of the oldest retained month). */
export function getCutoffDate(): string {
  const retentionMonths = getRetentionMonths();
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths + 1, 1);
  return cutoff.toISOString().slice(0, 10);
}
