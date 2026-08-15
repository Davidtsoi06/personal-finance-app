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

export function registerAssetIpcHandlers(): void {
  // ── Assets ──
  ipcMain.handle('asset:list', (_e, type?: string) => assetService.listAssets(type));
  handleValidated('asset:listAll', () => assetService.listAllAssets());
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

    if (data.type === 'buy') {
      const tx = db.transaction(() => {
        let asset = db.prepare(
          'SELECT * FROM assets WHERE code = ? AND investment_account_id = ?'
        ).get(code, data.investmentAccountId) as any;

        if (asset) {
          const newQty = asset.quantity + data.quantity;
          const newTotalCost = asset.total_cost + (data.quantity * data.price + fee);
          const newAvgCost = newTotalCost / newQty;
          const newMktValue = newQty * data.price;
          const newPL = newMktValue - newTotalCost;
          const newPLPct = newTotalCost > 0 ? (newPL / newTotalCost) * 100 : 0;

          db.prepare(`
            UPDATE assets SET quantity=?, cost_price=?, current_price=?, market_value=?,
              total_cost=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime('now')
            WHERE id=?
          `).run(newQty, newAvgCost, data.price, newMktValue, newTotalCost, newPL, newPLPct, asset.id);

          const txnResult = db.prepare(`
            INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(asset.id, 'buy', data.quantity, data.price, fee,
            data.quantity * data.price + fee, currency, date, data.notes || '买入');

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
            data.market || (currency === 'HKD' ? 'hk_stock' : currency === 'USD' ? 'us_stock' : 'a_stock'),
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
        const newQty = asset.quantity - data.quantity;
        const newTotalCost = newQty > 0 ? asset.total_cost * (newQty / asset.quantity) : 0;
        const newMktValue = newQty * data.price;
        const newPL = newMktValue - newTotalCost;
        const newPLPct = newTotalCost > 0 ? (newPL / newTotalCost) * 100 : 0;

        db.prepare(`
          UPDATE assets SET quantity=?, current_price=?, market_value=?,
            total_cost=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime('now')
          WHERE id=?
        `).run(newQty, data.price, newMktValue, newTotalCost, newPL, newPLPct, asset.id);

        const txnResult = db.prepare(`
          INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(asset.id, 'sell', data.quantity, data.price, fee,
          data.quantity * data.price - fee, currency, date, data.notes || '卖出');

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
  ipcMain.handle('transaction:listByAccount', async (_e, investmentAccountId: number) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT t.*, a.name as asset_name, a.code as asset_code
      FROM transactions t
      JOIN assets a ON t.asset_id = a.id
      WHERE a.investment_account_id = ?
      ORDER BY t.date DESC, t.id DESC
      LIMIT 200
    `).all(investmentAccountId);
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
              const newQty = asset.quantity + trade.quantity;
              const newTotalCost = asset.total_cost + (trade.quantity * trade.price + trade.fee);
              const newAvgCost = newTotalCost / newQty;
              const newMktValue = newQty * trade.price;
              const newPL = newMktValue - newTotalCost;
              const newPLPct = newTotalCost > 0 ? (newPL / newTotalCost) * 100 : 0;
              db.prepare([
                'UPDATE assets SET quantity=?, cost_price=?, current_price=?, market_value=?,',
                'total_cost=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime(\'now\')',
                'WHERE id=?',
              ].join(' ')).run(newQty, newAvgCost, trade.price, newMktValue, newTotalCost, newPL, newPLPct, asset.id);
              assetId = asset.id;
            } else {
              const totalCost = trade.quantity * trade.price + trade.fee;
              const mktValue = trade.quantity * trade.price;
              const r = db.prepare([
                'INSERT INTO assets (name, code, type, market, currency, quantity, cost_price,',
                'current_price, market_value, total_cost, profit_loss, profit_loss_pct,',
                'investment_account_id)',
                "VALUES (?, ?, 'stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              ].join(' ')).run(
                trade.name || trade.code, trade.code,
                trade.currency === 'HKD' ? 'hk_stock' : trade.currency === 'USD' ? 'us_stock' : 'a_stock',
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
            const newQty = asset.quantity - trade.quantity;
            const newTotalCost = newQty > 0 ? asset.total_cost * (newQty / asset.quantity) : 0;
            const newMktValue = newQty * trade.price;
            const newPL = newMktValue - newTotalCost;
            const newPLPct = newTotalCost > 0 ? (newPL / newTotalCost) * 100 : 0;
            db.prepare([
              'UPDATE assets SET quantity=?, current_price=?, market_value=?,',
              'total_cost=?, profit_loss=?, profit_loss_pct=?, updated_at=datetime(\'now\')',
              'WHERE id=?',
            ].join(' ')).run(newQty, trade.price, newMktValue, newTotalCost, newPL, newPLPct, asset.id);

            const txResult = db.prepare([
              'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ].join(' ')).run(asset.id, 'sell', trade.quantity, trade.price, trade.fee,
              trade.quantity * trade.price - trade.fee, trade.currency, trade.date, '日结单导入');
            // 现金流水：卖出回笼现金（净额）
            insertCashFlowInDb(db, {
              investmentAccountId, type: 'sell',
              amount: trade.quantity * trade.price - trade.fee,
              assetId: asset.id, transactionId: Number(txResult.lastInsertRowid),
              currency: trade.currency, date: trade.date, notes: '卖出 ' + (trade.name || trade.code),
            });
          } else if (trade.type === 'split') {
            if (!asset) { errors.push(trade.code + ' ' + trade.name + ': 未找到持仓，无法拆分'); continue; }
            const newQty = asset.quantity + trade.quantity;
            const newAvgCost = newQty > 0 ? asset.total_cost / newQty : 0;
            db.prepare(
              'UPDATE assets SET quantity=?, cost_price=?, updated_at=datetime(\'now\') WHERE id=?'
            ).run(newQty, newAvgCost, asset.id);
            db.prepare([
              'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ].join(' ')).run(asset.id, 'split', trade.quantity, 0, 0, 0, trade.currency, trade.date, '份额拆分/分拆');
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
      const rows: string[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
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
