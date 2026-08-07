/**
 * IPC handlers for reports, analytics, and Excel export.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import { ASSET_TYPE_LABELS, MARKET_LABELS } from '../../shared/constants/labels';

const TYPE_LABEL_MAP = ASSET_TYPE_LABELS;
const MARKET_LABEL_MAP = MARKET_LABELS;

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

  ipcMain.handle('report:assetPerformance', () => {
    const db = getDatabase();
    return db.prepare(`
      SELECT name, code, type, market, currency,
        market_value, total_cost, profit_loss, profit_loss_pct, quantity,
        cost_price, current_price
      FROM assets
      WHERE quantity > 0
      ORDER BY profit_loss DESC
    `).all();
  });

  // ── Excel Export ──
  ipcMain.handle('export:toExcel', async (_e, params: {
    type: 'assets' | 'trades' | 'ledgers';
    year: number; month?: number;
  }) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');
    const db = getDatabase();

    let rows: any[] = [];
    let sheetName = '';
    let defaultName = '';

    const hasMonth = params.month !== undefined && params.month !== null;
    const timeLabel = hasMonth ? `${params.year}年${params.month}月` : `${params.year}年`;

    if (params.type === 'assets') {
      const dateFilter = hasMonth
        ? `AND strftime('%Y', a.created_at) = ? AND strftime('%m', a.created_at) = ?`
        : `AND strftime('%Y', a.created_at) = ?`;
      const filterArgs: any[] = hasMonth
        ? [String(params.year), String(params.month).padStart(2, '0')]
        : [String(params.year)];
      rows = db.prepare(`
        SELECT name, code, type, market, currency,
          quantity, cost_price, current_price, market_value, total_cost,
          profit_loss, profit_loss_pct, notes
        FROM assets a
        WHERE quantity > 0 ${dateFilter}
        ORDER BY type, profit_loss DESC
      `).all(...filterArgs) as any[];
      sheetName = '资产汇总';
      defaultName = `资产汇总_${timeLabel}.xlsx`;
    } else if (params.type === 'trades') {
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
      const transformed = transformForExport(params.type, rows);
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(transformed);
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
      xlsx.writeFile(workbook, result.filePath);
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, error: `写入文件失败：${err.message}` };
    }
  });
}

// ── Export helpers ──

interface ExportHeader { key: string; label: string }

function transformForExport(type: 'assets' | 'trades' | 'ledgers', rows: any[]): Record<string, any>[] {
  const headers = getExportHeaders(type);
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const h of headers) {
      let value = row[h.key];
      if (h.key === 'type') {
        if (type === 'trades') {
          value = value === 'buy' ? '买入' : value === 'sell' ? '卖出' : value;
        } else if (type === 'ledgers') {
          value = value === 'income' ? '收入' : value === 'expense' ? '支出' : value;
        } else {
          value = TYPE_LABEL_MAP[value as string] || value;
        }
      }
      if (h.key === 'market') {
        value = MARKET_LABEL_MAP[value as string] || value;
      }
      out[h.label] = value !== undefined && value !== null ? value : '';
    }
    return out;
  });
}

function getExportHeaders(type: 'assets' | 'trades' | 'ledgers'): ExportHeader[] {
  if (type === 'assets') {
    return [
      { key: 'name', label: '名称' }, { key: 'code', label: '代码' },
      { key: 'type', label: '类型' }, { key: 'market', label: '市场' },
      { key: 'currency', label: '币种' }, { key: 'quantity', label: '持有数量' },
      { key: 'cost_price', label: '成本价' }, { key: 'current_price', label: '当前价' },
      { key: 'market_value', label: '市值' }, { key: 'total_cost', label: '总成本' },
      { key: 'profit_loss', label: '盈亏金额' }, { key: 'profit_loss_pct', label: '收益率(%)' },
      { key: 'notes', label: '备注' },
    ];
  }
  if (type === 'trades') {
    return [
      { key: 'date', label: '日期' }, { key: 'name', label: '股票名称' },
      { key: 'code', label: '代码' }, { key: 'type', label: '买卖方向' },
      { key: 'quantity', label: '数量' }, { key: 'price', label: '成交价' },
      { key: 'fee', label: '手续费' }, { key: 'total_amount', label: '总金额' },
      { key: 'currency', label: '币种' }, { key: 'notes', label: '备注' },
    ];
  }
  return [
    { key: 'date', label: '日期' }, { key: 'type', label: '类型' },
    { key: 'category', label: '分类' }, { key: 'amount', label: '金额' },
    { key: 'currency', label: '币种' }, { key: 'account_name', label: '账户' },
    { key: 'description', label: '描述' },
  ];
}
