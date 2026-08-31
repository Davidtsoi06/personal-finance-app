/**
 * IPC handlers for assets, trade records, transactions, and trade statement import.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import * as assetService from '../database/services/asset-service';
import * as transactionService from '../database/services/transaction-service';
import { parseStatement, parseRows, getBrokerFormats } from '../services/statement-parser';
import { normalizeDate, normalizeCurrency, normalizeCode, normalizeString } from '../services/data-normalizer';
import { handleValidated } from './validation';
import { insertCashFlowInDb, recomputeCashBalanceInDb } from '../database/services/cash-flow-core';
import { reconcileAssetCostBasis } from '../database/services/transaction-service';
import { detectMarket } from '../../shared/utils/market';

export function registerAssetIpcHandlers(): void {
  // ── Assets ──
  ipcMain.handle('asset:list', (_e, type?: string) => assetService.listAssets(type));
  handleValidated('asset:listAll', () => assetService.listAllAssets());
  // v1.8.1：股票名称自动匹配（东方财富行情，失败返回 null 由前端静默降级）
  handleValidated('asset:lookupName', async (code: string, market?: string) => {
    const { lookupStockName } = require('../services/stock-name-lookup') as typeof import('../services/stock-name-lookup');
    return (await lookupStockName(code, market)) || null;
  });
  handleValidated('asset:listOrphaned', () => assetService.listOrphanedAssets());
  handleValidated('asset:reassignOrphaned', (assetId: number, investmentAccountId: number) =>
    assetService.reassignOrphanedAsset(assetId, investmentAccountId)
  );
  ipcMain.handle('asset:get', (_e, id: number) => assetService.getAsset(id));
  handleValidated('asset:create', (data: any) => {
    data.currency = normalizeCurrency(data.currency, 'CNY');
    data.code = normalizeCode(data.code);
    return assetService.createAsset(data);
  });
  handleValidated('asset:update', (id: number, data: any) => {
    if (data.currency) data.currency = normalizeCurrency(data.currency, 'CNY');
    if (data.code) data.code = normalizeCode(data.code);
    if (data.name) data.name = normalizeString(data.name);
    return assetService.updateAsset(id, data);
  });
  handleValidated('asset:delete', (id: number) => assetService.deleteAsset(id));
  handleValidated('asset:updatePrice', (id: number, price: number) => assetService.updateCurrentPrice(id, price));
  ipcMain.handle('asset:totalMarketValue', (_e, currency?: string) => assetService.getTotalMarketValue(currency));
  ipcMain.handle('asset:listByAccount', (_e, accountId: number) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM assets WHERE account_id = ? ORDER BY type, name').all(accountId);
  });

  // ── Trade Records (buy/sell with auto asset management) ──
  handleValidated('trade:record', async (data: {
    investmentAccountId: number;
    type: 'buy' | 'sell';
    code: string; name: string;
    quantity: number; price: number; fee?: number;
    currency?: string; date?: string;
    market?: string; assetType?: string; notes?: string;
  }) => {
    const db = getDatabase();
    const fee = data.fee || 0;
    const currency = normalizeCurrency(data.currency, 'CNY');
    const date = normalizeDate(data.date);
    const code = normalizeCode(data.code);
    const name = normalizeString(data.name);
    // v1.10.9：市场推断 detectMarket(代码) 优先（字母→美股、数字→A/港股），币种仅兜底
    const detected = detectMarket(code);
    const market = data.market && data.market !== 'other'
      ? data.market
      : detected !== 'other' ? detected
      : currency === 'HKD' ? 'hk_stock' : currency === 'USD' ? 'us_stock' : 'a_stock';

    if (data.type === 'buy') {
      const tx = db.transaction(() => {
        let asset = db.prepare(
          'SELECT * FROM assets WHERE code = ? AND investment_account_id = ?'
        ).get(code, data.investmentAccountId) as any;

        if (asset) {
          const txnResult = db.prepare(`
            INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(asset.id, 'buy', data.quantity, data.price, fee,
            data.quantity * data.price + fee, currency, date, data.notes || '买入');
          // v1.10.8：重放校准持仓（替代内联加权平均，统一口径并修复浮点漂移）
          reconcileAssetCostBasis(asset.id, asset.quantity + data.quantity);

          db.prepare("INSERT INTO asset_prices (asset_id, price, date) VALUES (?, ?, date('now'))")
            .run(asset.id, data.price);

          // 现金流水：买入扣现金（含手续费）
          insertCashFlowInDb(db, {
            investmentAccountId: data.investmentAccountId, type: 'buy',
            amount: -(data.quantity * data.price + fee),
            assetId: asset.id, transactionId: Number(txnResult.lastInsertRowid),
            currency, date, notes: '买入 ' + name,
          });
          recomputeCashBalanceInDb(db, data.investmentAccountId);

          return { success: true, assetId: asset.id, transactionId: txnResult.lastInsertRowid };
        } else {
          const totalCost = data.quantity * data.price + fee;
          const marketValue = data.quantity * data.price;
          const assetResult = db.prepare(`
            INSERT INTO assets (name, code, type, market, currency, quantity, cost_price,
              current_price, market_value, total_cost, profit_loss, profit_loss_pct,
              investment_account_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            name, code, data.assetType || 'stock',
            market,
            currency, data.quantity, data.price, data.price, marketValue, totalCost,
            marketValue - totalCost, totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
            data.investmentAccountId, data.notes || null
          );
          const assetId = assetResult.lastInsertRowid as number;

          const txnResult = db.prepare(`
            INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(assetId, 'buy', data.quantity, data.price, fee,
            data.quantity * data.price + fee, currency, date, data.notes || '买入');
          // v1.10.8：重放校准（首次买入重放=该笔，与初始值一致）
          reconcileAssetCostBasis(assetId);

          return { success: true, assetId, transactionId: txnResult.lastInsertRowid };
        }
      });

      return tx();
    } else {
      // Sell validation — must run outside transaction since it's read-only checks
      const asset = db.prepare(
        'SELECT * FROM assets WHERE code = ? AND investment_account_id = ?'
      ).get(code, data.investmentAccountId) as any;
      if (!asset) return { success: false, error: `未找到代码为 ${code} 的持仓` };
      if (asset.quantity < data.quantity) {
        return { success: false, error: `持仓不足：持有 ${asset.quantity} 股，尝试卖出 ${data.quantity} 股` };
      }

      const tx = db.transaction(() => {
        const txnResult = db.prepare(`
          INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(asset.id, 'sell', data.quantity, data.price, fee,
          data.quantity * data.price - fee, currency, date, data.notes || '卖出');
        // v1.10.8：重放校准持仓（替代内联比例缩放，修复清仓残留均价与浮点漂移）
        reconcileAssetCostBasis(asset.id, asset.quantity - data.quantity);

        db.prepare("INSERT INTO asset_prices (asset_id, price, date) VALUES (?, ?, date('now'))")
          .run(asset.id, data.price);

        // 现金流水：卖出回笼现金（净额 = 金额 − 手续费）
        insertCashFlowInDb(db, {
          investmentAccountId: data.investmentAccountId, type: 'sell',
          amount: data.quantity * data.price - fee,
          assetId: asset.id, transactionId: Number(txnResult.lastInsertRowid),
          currency, date, notes: '卖出 ' + name,
        });
        recomputeCashBalanceInDb(db, data.investmentAccountId);

        return { success: true, assetId: asset.id, transactionId: txnResult.lastInsertRowid };
      });

      return tx();
    }
  });

  // ── Transactions ──
  ipcMain.handle('transaction:list', (_e, assetId?: number, limit?: number) =>
    transactionService.listTransactions(assetId, limit)
  );
  ipcMain.handle('transaction:listByAccount', async (_e, investmentAccountId: number, limit?: number) => {
    const db = getDatabase();
    // v1.8.0：支持「加载更多」分页
    return db.prepare(`
      SELECT t.*, a.name as asset_name, a.code as asset_code
      FROM transactions t
      JOIN assets a ON t.asset_id = a.id
      WHERE a.investment_account_id = ?
      ORDER BY t.date DESC, t.id DESC
      LIMIT ?
    `).all(investmentAccountId, limit || 200);
  });
  ipcMain.handle('transaction:get', (_e, id: number) => transactionService.getTransaction(id));
  handleValidated('transaction:create', (data: any) => {
    data.date = normalizeDate(data.date);
    data.currency = normalizeCurrency(data.currency, 'CNY');
    return transactionService.createTransaction(data);
  });
  handleValidated('transaction:update', (id: number, data: any) => {
    if (data.date) data.date = normalizeDate(data.date);
    if (data.currency) data.currency = normalizeCurrency(data.currency, 'CNY');
    return transactionService.updateTransaction(id, data);
  });
  handleValidated('transaction:delete', (id: number) => transactionService.deleteTransaction(id));
  ipcMain.handle('transaction:todayList', () => transactionService.getTodayTransactions());

  // ── Trade Statement Import (smart format matching) ──
  ipcMain.handle('trade:listBrokerFormats', () => getBrokerFormats());

  ipcMain.handle('trade:parseStatement', (_e, csvText: string, formatName?: string) => {
    return parseStatement(csvText, formatName);
  });

  handleValidated('trade:importParsed', async (trades: any[], investmentAccountId: number) => {
    const db = getDatabase();

    // 整个导入包在事务内：要么全部生效，要么全部回滚；现金流与持仓同事务更新
    const run = db.transaction(() => {
      let imported = 0;
      const errors: string[] = [];

      for (const trade of trades) {
        try {
          trade.date = normalizeDate(trade.date);
          trade.currency = normalizeCurrency(trade.currency, 'HKD');
          trade.code = normalizeCode(trade.code);
          trade.name = normalizeString(trade.name);

          let asset = db.prepare(
            'SELECT * FROM assets WHERE code = ? AND investment_account_id = ?'
          ).get(trade.code, investmentAccountId) as any;

          if (trade.type === 'buy') {
            let assetId: number;
            if (asset) {
              assetId = asset.id;
            } else {
              const totalCost = trade.quantity * trade.price + trade.fee;
              const mktValue = trade.quantity * trade.price;
              // v1.10.9：市场按代码识别优先（字母→美股），币种兜底
              const det = detectMarket(trade.code);
              const market = det !== 'other' ? det
                : trade.currency === 'HKD' ? 'hk_stock' : trade.currency === 'USD' ? 'us_stock' : 'a_stock';
              const r = db.prepare([
                'INSERT INTO assets (name, code, type, market, currency, quantity, cost_price,',
                'current_price, market_value, total_cost, profit_loss, profit_loss_pct,',
                'investment_account_id)',
                "VALUES (?, ?, 'stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              ].join(' ')).run(
                trade.name || trade.code, trade.code, market,
                trade.currency, trade.quantity, trade.price, trade.price, mktValue, totalCost,
                mktValue - totalCost, totalCost > 0 ? ((mktValue - totalCost) / totalCost) * 100 : 0,
                investmentAccountId
              );
              assetId = Number(r.lastInsertRowid);
            }
            const txResult = db.prepare([
              'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ].join(' ')).run(assetId, 'buy', trade.quantity, trade.price, trade.fee,
              trade.quantity * trade.price + trade.fee, trade.currency, trade.date, '日结单导入');
            // v1.10.8/1.10.9：重放校准持仓（统一口径）
            reconcileAssetCostBasis(assetId, asset ? asset.quantity + trade.quantity : undefined);
            // 现金流水：买入扣现金（含手续费）
            insertCashFlowInDb(db, {
              investmentAccountId, type: 'buy',
              amount: -(trade.quantity * trade.price + trade.fee),
              assetId, transactionId: Number(txResult.lastInsertRowid),
              currency: trade.currency, date: trade.date, notes: '买入 ' + (trade.name || trade.code),
            });
          } else if (trade.type === 'sell') {
            if (!asset) { errors.push(trade.code + ' ' + trade.name + ': 未找到持仓'); continue; }
            if (asset.quantity < trade.quantity) {
              errors.push(trade.code + ' ' + trade.name + ': 持仓不足'); continue;
            }
            const txResult = db.prepare([
              'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ].join(' ')).run(asset.id, 'sell', trade.quantity, trade.price, trade.fee,
              trade.quantity * trade.price - trade.fee, trade.currency, trade.date, '日结单导入');
            // v1.10.8/1.10.9：重放校准持仓（统一口径，修复清仓残留均价）
            reconcileAssetCostBasis(asset.id, asset.quantity - trade.quantity);
            // 现金流水：卖出回笼现金（净额）
            insertCashFlowInDb(db, {
              investmentAccountId, type: 'sell',
              amount: trade.quantity * trade.price - trade.fee,
              assetId: asset.id, transactionId: Number(txResult.lastInsertRowid),
              currency: trade.currency, date: trade.date, notes: '卖出 ' + (trade.name || trade.code),
            });
          } else if (trade.type === 'split') {
            if (!asset) { errors.push(trade.code + ' ' + trade.name + ': 未找到持仓，无法拆分'); continue; }
            db.prepare([
              'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ].join(' ')).run(asset.id, 'split', trade.quantity, 0, 0, 0, trade.currency, trade.date, '份额拆分/分拆');
            // v1.10.8/1.10.9：重放校准（split 不参与重放成本，数量保留期望值 → 均价摊薄）
            reconcileAssetCostBasis(asset.id, asset.quantity + trade.quantity);
          } else {
            if (asset) {
              db.prepare([
                'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              ].join(' ')).run(asset.id, 'other', trade.quantity, trade.price, trade.fee,
                trade.quantity * trade.price, trade.currency, trade.date, '其他公司行动');
            } else {
              errors.push(trade.code + ' ' + trade.name + ': 未找到持仓，跳过'); continue;
            }
          }
          imported++;
        } catch (err: any) {
          errors.push(trade.code + ': ' + err.message);
        }
      }

      // 导入完成后统一重算现金余额（流水派生）
      recomputeCashBalanceInDb(db, investmentAccountId);
      return { imported, errors };
    });

    return run();
  });

  // ── Excel File Import ──
  ipcMain.handle('trade:importExcel', async (_e, formatName?: string) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');

    const result = await dialog.showOpenDialog({
      title: '选择日结单文件',
      filters: [
        { name: 'Excel / CSV 文件', extensions: ['xlsx', 'xls', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];

    try {
      const fs = require('fs');
      const ext = filePath.split('.').pop()?.toLowerCase();

      // CSV — 直接读取文本，复用已有解析器
      if (ext === 'csv') {
        const csvText = fs.readFileSync(filePath, 'utf-8');
        const parseResult = parseStatement(csvText, formatName);
        return {
          canceled: false,
          fileName: filePath.split(/[\\/]/).pop() || filePath,
          ...parseResult,
        };
      }

      // Excel — xlsx 库解析
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = ext === 'xls'
        ? xlsx.read(fileBuffer, { type: 'buffer', codepage: 936 })
        : xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // v1.10.10：Excel→文本网格——日期格式单元格输出序列号（精确转日期），其他用显示文本（金额带符号）
      const { xlsxSheetToTextRows } = require('../services/excel-utils') as typeof import('../services/excel-utils');
      const rows: string[][] = xlsxSheetToTextRows(sheet);
      const parseResult = parseRows(rows, formatName);
      return {
        canceled: false,
        fileName: filePath.split(/[\\/]/).pop() || filePath,
        ...parseResult,
      };
    } catch (err: any) {
      return {
        canceled: false, success: false, format: '未知',
        trades: [], errors: [`读取 Excel 失败：${err.message}`],
      };
    }
  });
}
