/**
 * IPC handlers for reports, analytics, and Excel export.
 * Data building lives in report-export-service.ts; this file handles
 * Electron dialogs and xlsx writing.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import { ASSET_SORT_SQL } from '../database/services/asset-service';
import {
  getDailyTrades, buildAssetSummarySheets,
  transformRows, getExportHeaders,
} from '../services/report-export-service';

export function registerReportIpcHandlers(): void {
  // ── Reports / Analytics ──
  ipcMain.handle('report:monthlyTrend', (_e, months: number = 12) => {
    const db = getDatabase();
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return db.prepare(`
      SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
      FROM ledgers
      WHERE date >= ? AND date <= ?
      GROUP BY month, type
      ORDER BY month ASC
    `).all(startDate, endDate);
  });

  ipcMain.handle('report:categoryBreakdown', (_e, params: { type?: string; year?: number; month?: number }) => {
    const db = getDatabase();
    const recordType = params?.type || 'expense';
    let dateFilter = '';
    const args: any[] = [recordType];
    if (params?.year) {
      if (params?.month) {
        dateFilter = 'AND strftime(\'%Y\', l.date) = ? AND strftime(\'%m\', l.date) = ?';
        args.push(String(params.year), String(params.month).padStart(2, '0'));
      } else {
        dateFilter = 'AND strftime(\'%Y\', l.date) = ?';
        args.push(String(params.year));
      }
    }
    const rows = db.prepare(`
      SELECT c.name, COALESCE(SUM(l.amount), 0) as total
      FROM ledgers l
      JOIN categories c ON l.category_id = c.id
      WHERE l.type = ? AND c.name IS NOT NULL ${dateFilter}
      GROUP BY c.name
      ORDER BY total DESC
    `).all(...args) as any[];
    const grandTotal = rows.reduce((s: number, r: any) => s + r.total, 0);
    return rows.map((r: any) => ({
      ...r,
      percent: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0,
    }));
  });

  ipcMain.handle('report:yearlyStats', (_e, year: number) => {
    const db = getDatabase();
    const y = String(year);
    const monthly = db.prepare(`
      SELECT strftime('%m', date) as month,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
      FROM ledgers
      WHERE strftime('%Y', date) = ?
      GROUP BY month
      ORDER BY month ASC
    `).all(y) as any[];

    const totals = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as totalIncome,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as totalExpense
      FROM ledgers
      WHERE strftime('%Y', date) = ?
    `).get(y) as any;

    return {
      year,
      monthly: monthly.map((r: any) => ({
        month: r.month,
        income: r.income,
        expense: r.expense,
        balance: r.income - r.expense,
      })),
      totalIncome: totals?.totalIncome || 0,
      totalExpense: totals?.totalExpense || 0,
      netIncome: (totals?.totalIncome || 0) - (totals?.totalExpense || 0),
    };
  });

  // Asset performance — sorted 港股→A股→…, code ASC within each group
  ipcMain.handle('report:assetPerformance', () => {
    const db = getDatabase();
    return db.prepare(`
      SELECT name, code, type, market, currency,
        market_value, total_cost, profit_loss, profit_loss_pct, quantity,
        cost_price, current_price
      FROM assets
      WHERE quantity > 0
      ORDER BY ${ASSET_SORT_SQL}
    `).all();
  });

  // Daily trade report for a specific date
  ipcMain.handle('report:dailyTrades', (_e, date?: string) => {
    const target = date || new Date().toISOString().slice(0, 10);
    return getDailyTrades(target);
  });

  // ── Excel Export ──
  ipcMain.handle('export:toExcel', async (_e, params: {
    type: 'assets' | 'trades' | 'ledgers';
    year: number; month?: number;
  }) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');
    const db = getDatabase();

    const hasMonth = params.month !== undefined && params.month !== null;
    const timeLabel = hasMonth ? `${params.year}年${params.month}月` : `${params.year}年`;

    // ── assets: 完整资产快照（多 sheet，不受时间筛选影响） ──
    if (params.type === 'assets') {
      const sheets = buildAssetSummarySheets();
      const rowCount = sheets.reduce((s, sh) => s + sh.rows.length, 0);
      if (rowCount === 0) return { success: false, error: '暂无资产数据' };

      const result = await dialog.showSaveDialog({
        title: '保存 Excel 文件',
        defaultPath: `资产汇总快照_${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };

      try {
        const workbook = xlsx.utils.book_new();
        for (const sh of sheets) {
          const ws = xlsx.utils.json_to_sheet(sh.rows);
          xlsx.utils.book_append_sheet(workbook, ws, sh.name);
        }
        xlsx.writeFile(workbook, result.filePath);
        return { success: true, filePath: result.filePath, rowCount };
      } catch (err: any) {
        return { success: false, error: `写入文件失败：${err.message}` };
      }
    }

    // ── trades / ledgers: 按月份/年份筛选 ──
    let rows: any[] = [];
    let sheetName = '';
    let defaultName = '';

    if (params.type === 'trades') {
      const dateFilter = hasMonth ? 'AND strftime(\'%Y\', t.date) = ? AND strftime(\'%m\', t.date) = ?'
        : 'AND strftime(\'%Y\', t.date) = ?';
      const filterArgs: any[] = hasMonth
        ? [String(params.year), String(params.month).padStart(2, '0')]
        : [String(params.year)];
      rows = db.prepare(`
        SELECT t.date, a.name, a.code, t.type, t.quantity, t.price, t.fee, t.total_amount, t.currency, t.notes
        FROM transactions t
        JOIN assets a ON t.asset_id = a.id
        WHERE 1=1 ${dateFilter}
        ORDER BY t.date DESC, t.id DESC
      `).all(...filterArgs) as any[];
      sheetName = '投资交易记录';
      defaultName = `投资交易记录_${timeLabel}.xlsx`;
    } else if (params.type === 'ledgers') {
      const dateFilter = hasMonth ? 'AND strftime(\'%Y\', l.date) = ? AND strftime(\'%m\', l.date) = ?'
        : 'AND strftime(\'%Y\', l.date) = ?';
      const filterArgs: any[] = hasMonth
        ? [String(params.year), String(params.month).padStart(2, '0')]
        : [String(params.year)];
      rows = db.prepare(`
        SELECT l.date, l.type, c.name as category, l.amount, l.currency,
          a2.name as account_name, l.description
        FROM ledgers l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN accounts a2 ON l.account_id = a2.id
        WHERE 1=1 ${dateFilter}
        ORDER BY l.date DESC, l.id DESC
      `).all(...filterArgs) as any[];
      sheetName = '收支记账';
      defaultName = `收支记账_${timeLabel}.xlsx`;
    }

    if (rows.length === 0) {
      return { success: false, error: '所选时段没有数据' };
    }

    const result = await dialog.showSaveDialog({
      title: '保存 Excel 文件',
      defaultPath: defaultName,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      const transformed = transformRows(rows, getExportHeaders(params.type), params.type);
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(transformed);
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
      xlsx.writeFile(workbook, result.filePath);
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, error: `写入文件失败：${err.message}` };
    }
  });

  // ── 每日交易报表导出（单日 Excel） ──
  ipcMain.handle('export:dailyTrades', async (_e, date: string) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');

    const { rows, summary } = getDailyTrades(date);
    if (rows.length === 0) {
      return { success: false, error: `${date} 没有交易记录` };
    }

    const result = await dialog.showSaveDialog({
      title: '保存每日交易报表',
      defaultPath: `每日交易报表_${date}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      const workbook = xlsx.utils.book_new();
      // Sheet 1: 汇总
      const summaryRows = [
        { 项目: '日期', 数值: date },
        { 项目: '买入笔数', 数值: summary.buyCount },
        { 项目: '卖出笔数', 数值: summary.sellCount },
        { 项目: '买入金额', 数值: summary.buyAmount },
        { 项目: '卖出金额', 数值: summary.sellAmount },
        { 项目: '已实现盈亏', 数值: summary.realizedPnl },
      ];
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(summaryRows), '汇总');
      // Sheet 2: 明细
      const detail = transformRows(rows, getExportHeaders('trades'), 'trades');
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(detail), '交易明细');
      xlsx.writeFile(workbook, result.filePath);
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, error: `写入文件失败：${err.message}` };
    }
  });
}
