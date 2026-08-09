/**
 * IPC handlers for investment accounts, net worth, currencies, data refresh,
 * budgets, alerts, app settings, AI chat, data export/import, and archive.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import * as iaService from '../database/services/investment-account-service';
import * as nwService from '../database/services/net-worth-service';
import * as currencyService from '../database/services/currency-service';
import * as cfService from '../database/services/custom-format-service';
import * as bfService from '../database/services/bank-format-service';
import * as bankParser from '../services/bank-statement-parser';

export function registerSettingsIpcHandlers(): void {
  // ── Investment Accounts ──
  ipcMain.handle('investmentAccount:list', () => iaService.listInvestmentAccounts());
  ipcMain.handle('investmentAccount:get', (_e, id: number) => iaService.getInvestmentAccount(id));
  ipcMain.handle('investmentAccount:create', (_e, data: any) => iaService.createInvestmentAccount(data));
  ipcMain.handle('investmentAccount:update', (_e, id: number, data: any) => iaService.updateInvestmentAccount(id, data));
  ipcMain.handle('investmentAccount:delete', (_e, id: number) => iaService.deleteInvestmentAccount(id));
  ipcMain.handle('investmentAccount:holdings', (_e, id: number) => iaService.getAccountHoldings(id));
  ipcMain.handle('investmentAccount:summary', (_e, id: number) => iaService.getAccountSummary(id));
  ipcMain.handle('investmentAccount:dailyStats', () => iaService.getDailyTradeStats());
  ipcMain.handle('investmentAccount:allSummary', () => {
    const accounts = iaService.listInvestmentAccounts();
    return accounts.map(acc => ({
      ...acc,
      ...iaService.getAccountSummary(acc.id),
    }));
  });

  // ── Net Worth ──
  ipcMain.handle('netWorth:history', (_e, days?: number) => nwService.getNetWorthHistory(days));
  ipcMain.handle('netWorth:record', () => nwService.recordNetWorth());

  // ── Custom Statement Formats ──
  ipcMain.handle('customFormat:list', () => cfService.listCustomFormats());
  ipcMain.handle('customFormat:create', (_e, data: any) => cfService.createCustomFormat(data));
  ipcMain.handle('customFormat:delete', (_e, id: number) => cfService.deleteCustomFormat(id));

  // ── Bank Statement Formats ──
  ipcMain.handle('bankFormat:list', () => bfService.listBankFormats());
  ipcMain.handle('bankFormat:create', (_e, data: any) => bfService.createBankFormat(data));
  ipcMain.handle('bankFormat:delete', (_e, id: number) => bfService.deleteBankFormat(id));

  // ── Bank Statement Import ──
  ipcMain.handle('bank:listFormats', () => bankParser.getBankFormats());
  ipcMain.handle('bank:parseStatement', (_e, csvText: string, formatName?: string) => {
    return bankParser.parseBankStatement(csvText, formatName);
  });
  ipcMain.handle('bank:importParsed', (_e, records: any[], accountId: number) => {
    const db = getDatabase();
    let imported = 0;
    const errors: string[] = [];

    const insertTx = db.prepare(`
      INSERT INTO account_transactions (account_id, type, amount, currency, date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const getBalance = db.prepare(
      'SELECT balance FROM account_balances WHERE account_id = ? AND currency = ?'
    );

    const upsertBalance = db.prepare(`
      INSERT INTO account_balances (account_id, currency, balance)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id, currency) DO UPDATE SET
        balance = excluded.balance, updated_at = datetime('now')
    `);

    const transaction = db.transaction(() => {
      for (const rec of records) {
        try {
          const date = rec.date || new Date().toISOString().slice(0, 10);
          const currency = rec.currency || 'CNY';
          const amount = Math.abs(Number(rec.amount) || 0);
          const type = rec.type || 'deposit';
          const notes = rec.description || '银行日结单导入';

          if (amount <= 0) { errors.push(`金额无效：${JSON.stringify(rec)}`); continue; }

          // Insert transaction record
          insertTx.run(accountId, type, amount, currency, date, notes);

          // Update balance
          const delta = type === 'deposit' ? amount : -amount;
          const existing = getBalance.get(accountId, currency) as any;
          const newBalance = (existing?.balance || 0) + delta;
          upsertBalance.run(accountId, currency, newBalance);

          imported++;
        } catch (err: any) {
          errors.push(`${rec.description || '未知记录'}：${err.message}`);
        }
      }

      // Sync main account balance to sum of all currency balances
      const totalRow = db.prepare(
        'SELECT COALESCE(SUM(balance), 0) as total FROM account_balances WHERE account_id = ?'
      ).get(accountId) as { total: number };
      db.prepare("UPDATE accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?")
        .run(totalRow.total, accountId);

      return imported;
    });

    transaction();
    return { imported, errors };
  });

  ipcMain.handle('bank:importExcel', async (_e, formatName?: string) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');

    const result = await dialog.showOpenDialog({
      title: '选择银行日结单 Excel 文件',
      filters: [
        { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
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
      const fileBuffer = fs.readFileSync(filePath);
      const ext = filePath.split('.').pop()?.toLowerCase();
      const workbook = ext === 'xls'
        ? xlsx.read(fileBuffer, { type: 'buffer', codepage: 936 })
        : xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const parseResult = bankParser.parseBankRows(rows, formatName);
      return {
        canceled: false,
        fileName: filePath.split(/[\\/]/).pop() || filePath,
        ...parseResult,
      };
    } catch (err: any) {
      return {
        canceled: false, success: false, format: '未知',
        records: [], errors: [`读取 Excel 失败：${err.message}`],
      };
    }
  });

  // ── Currencies ──
  ipcMain.handle('currency:list', () => currencyService.listCurrencies());
  ipcMain.handle('currency:getBase', () => currencyService.getBaseCurrency());
  ipcMain.handle('currency:get', (_e, code: string) => currencyService.getCurrency(code));
  ipcMain.handle('currency:updateRate', (_e, code: string, rate: number) => currencyService.updateRate(code, rate));
  ipcMain.handle('currency:rateHistory', (_e, code: string, limit?: number) => currencyService.getRateHistory(code, limit));
  ipcMain.handle('currency:convert', (_e, amount: number, from: string, to: string) =>
    currencyService.convertAmount(amount, from, to)
  );

  // ── Data Refresh ──
  const { runManualUpdate } = require('../services/scheduler');
  ipcMain.handle('data:refreshRates', async () => {
    const { fetchExchangeRates } = require('../services/exchange-rate-fetcher');
    return fetchExchangeRates();
  });
  ipcMain.handle('data:refreshPrices', async () => {
    const { fetchAllPrices } = require('../services/price-fetcher');
    return fetchAllPrices();
  });
  ipcMain.handle('data:refreshAll', async () => runManualUpdate());

  // ── Budgets ──
  const budgetService = require('../database/services/budget-service');
  ipcMain.handle('budget:list', (_e, month?: string) => budgetService.listBudgets(month));
  ipcMain.handle('budget:get', (_e, id: number) => budgetService.getBudget(id));
  ipcMain.handle('budget:create', (_e, data: any) => budgetService.createBudget(data));
  ipcMain.handle('budget:update', (_e, id: number, data: any) => budgetService.updateBudget(id, data));
  ipcMain.handle('budget:delete', (_e, id: number) => budgetService.deleteBudget(id));
  ipcMain.handle('budget:status', (_e, month: string) => budgetService.getBudgetStatus(month));

  // ── Alerts ──
  const alertService = require('../database/services/alert-service');
  ipcMain.handle('alert:listConfig', () => alertService.listAlertConfigs());
  ipcMain.handle('alert:updateConfig', (_e, id: number, data: any) => alertService.updateAlertConfig(id, data));

  // ── Social Obligations ──
  const socialObligationService = require('../database/services/social-obligation-service');
  ipcMain.handle('socialObligation:list', (_e, type?: string) => socialObligationService.listObligations(type));
  ipcMain.handle('socialObligation:create', (_e, data: any) => socialObligationService.createObligation(data));
  ipcMain.handle('socialObligation:update', (_e, id: number, data: any) => socialObligationService.updateObligation(id, data));
  ipcMain.handle('socialObligation:delete', (_e, id: number) => socialObligationService.deleteObligation(id));

  // ── App Settings ──
  const settingsService = require('../database/services/settings-service');
  ipcMain.handle('settings:getAiConfig', () => settingsService.getAiConfigPublic());
  ipcMain.handle('settings:saveAiConfig', (_e, config: any) => {
    settingsService.saveAiConfig(config);
    return { success: true };
  });
  ipcMain.handle('settings:testAiConnection', async (_e, config?: any) => {
    return settingsService.testAiConnection(config);
  });

  // ── AI Chat ──
  const aiService = require('../services/ai-service');
  ipcMain.handle('ai:chat', async (_e, params: { message: string; history?: any[] }) => {
    try {
      const result = await aiService.chat(params.message, params.history || []);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message || 'AI 请求失败' };
    }
  });

  ipcMain.handle('ai:dailySummary', async (_e, date?: string) => {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    // Check cache first
    const cached = settingsService.getDailySummary(targetDate);
    if (cached) {
      return { success: true, content: cached, date: targetDate, cached: true };
    }
    // Generate new summary
    try {
      const result = await aiService.generateInvestmentSummary(targetDate);
      settingsService.saveDailySummary(targetDate, result.content);
      return { success: true, content: result.content, date: targetDate, cached: false };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai:chatStream', async (event, params: { message: string; history?: any[] }) => {
    try {
      await aiService.chatStreaming(
        params.message, params.history || [],
        (chunk: string) => { event.sender.send('ai:streamChunk', chunk); }
      );
      event.sender.send('ai:streamDone', { success: true });
      return { success: true };
    } catch (err: any) {
      event.sender.send('ai:streamDone', { success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ── Data Export / Import ──
  ipcMain.handle('data:exportAll', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');
    const db = getDatabase();

    const result = await dialog.showSaveDialog({
      title: '保存数据备份',
      defaultPath: `财务数据备份_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      const tables: { sheet: string; sql: string }[] = [
        { sheet: '账户', sql: 'SELECT * FROM accounts ORDER BY id' },
        { sheet: '投资账户', sql: 'SELECT * FROM investment_accounts ORDER BY id' },
        { sheet: '资产持仓', sql: 'SELECT * FROM assets ORDER BY id' },
        { sheet: '投资交易', sql: 'SELECT * FROM transactions ORDER BY date DESC, id DESC' },
        { sheet: '存取记录', sql: 'SELECT * FROM account_transactions ORDER BY date DESC, id DESC' },
        { sheet: '收支记账', sql: 'SELECT * FROM ledgers ORDER BY date DESC, id DESC' },
        { sheet: '收支分类', sql: 'SELECT * FROM categories ORDER BY id' },
        { sheet: '货币汇率', sql: 'SELECT * FROM currencies ORDER BY id' },
        { sheet: '汇率历史', sql: 'SELECT * FROM exchange_rates ORDER BY date DESC' },
        { sheet: '价格历史', sql: 'SELECT * FROM asset_prices ORDER BY date DESC' },
        { sheet: '净值历史', sql: 'SELECT * FROM net_worth_history ORDER BY date DESC' },
        { sheet: '预算', sql: 'SELECT * FROM budgets ORDER BY month DESC' },
        { sheet: '提醒配置', sql: 'SELECT * FROM alert_config ORDER BY id' },
        { sheet: '自定义格式', sql: 'SELECT * FROM custom_statement_formats ORDER BY id' },
        { sheet: '人情债', sql: 'SELECT * FROM social_obligations ORDER BY created_at DESC' },
      ];

      const workbook = xlsx.utils.book_new();
      for (const t of tables) {
        const rows = db.prepare(t.sql).all() as any[];
        if (rows.length > 0) {
          const ws = xlsx.utils.json_to_sheet(rows);
          xlsx.utils.book_append_sheet(workbook, ws, t.sheet);
        }
      }
      xlsx.writeFile(workbook, result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      return { success: false, error: `导出失败：${err.message}` };
    }
  });

  ipcMain.handle('data:importAll', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');

    const result = await dialog.showOpenDialog({
      title: '选择数据备份文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    try {
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(result.filePaths[0]);
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

      const requiredSheets = ['账户', '资产持仓', '投资交易', '收支记账'];
      for (const s of requiredSheets) {
        if (!workbook.SheetNames.includes(s)) {
          return { success: false, error: `无效的备份文件：缺少"${s}"工作表` };
        }
      }

      const preview: { sheet: string; count: number }[] = [];
      for (const name of workbook.SheetNames) {
        const ws = workbook.Sheets[name];
        const rows = xlsx.utils.sheet_to_json(ws) as any[];
        preview.push({ sheet: name, count: rows.length });
      }

      return { success: true, preview, filePath: result.filePaths[0], workbookReady: true };
    } catch (err: any) {
      return { success: false, error: `读取备份文件失败：${err.message}` };
    }
  });

  ipcMain.handle('data:confirmImport', async (_e, filePath: string) => {
    const xlsx = require('xlsx') as typeof import('xlsx');
    const db = getDatabase();
    const fs = require('fs');

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

      const sheetToTable: Record<string, string> = {
        '账户': 'accounts', '投资账户': 'investment_accounts', '资产持仓': 'assets',
        '投资交易': 'transactions', '存取记录': 'account_transactions', '收支记账': 'ledgers',
        '收支分类': 'categories', '货币汇率': 'currencies', '汇率历史': 'exchange_rates',
        '价格历史': 'asset_prices', '净值历史': 'net_worth_history', '预算': 'budgets',
        '提醒配置': 'alert_config', '自定义格式': 'custom_statement_formats',
        '人情债': 'social_obligations',
      };

      const importOrder = [
        '货币汇率', '收支分类', '账户', '投资账户', '自定义格式',
        '资产持仓', '投资交易', '存取记录', '收支记账',
        '汇率历史', '价格历史', '净值历史', '预算', '提醒配置',
        '人情债',
      ];

      const transaction = db.transaction(() => {
        const reverseOrder = [...importOrder].reverse();
        for (const sheet of reverseOrder) {
          const table = sheetToTable[sheet];
          if (table && workbook.SheetNames.includes(sheet)) {
            db.prepare(`DELETE FROM ${table}`).run();
          }
        }

        let totalImported = 0;
        for (const sheet of importOrder) {
          const table = sheetToTable[sheet];
          if (!table || !workbook.SheetNames.includes(sheet)) continue;

          const ws = workbook.Sheets[sheet];
          const rows = xlsx.utils.sheet_to_json(ws) as any[];
          if (rows.length === 0) continue;

          const keys = Object.keys(rows[0]);
          const placeholders = keys.map(() => '?').join(', ');
          const cols = keys.join(', ');
          const insert = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`);

          for (const row of rows) {
            try { insert.run(...keys.map(k => row[k])); totalImported++; }
            catch { /* skip individual row errors */ }
          }
        }
        return totalImported;
      });

      const total = transaction();
      return { success: true, totalImported: total };
    } catch (err: any) {
      return { success: false, error: `导入失败：${err.message}` };
    }
  });

  // ── Data Archive ──
  const archiveService = require('../services/archive-service');
  ipcMain.handle('archive:getPendingMonths', () => archiveService.getPendingMonths());
  ipcMain.handle('archive:execute', (_e, months: string[]) => archiveService.executeArchive(months));
  ipcMain.handle('archive:getSettings', () => archiveService.getArchiveSettings());
  ipcMain.handle('archive:setFolder', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const result = await dialog.showOpenDialog({
      title: '选择归档文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    archiveService.setArchiveFolder(result.filePaths[0]);
    return { canceled: false, folderPath: result.filePaths[0] };
  });
  ipcMain.handle('archive:setRetentionMonths', (_e, months: number) => {
    archiveService.setRetentionMonths(months);
    return { success: true };
  });

  // ── One-click Data Clear ──
  ipcMain.handle('data:clearAll', () => {
    const db = getDatabase();
    // Delete in dependency order to respect foreign keys
    const tables = [
      'asset_prices',
      'transactions',
      'account_transactions',
      'ledgers',
      'assets',
      'net_worth_history',
      'budgets',
      'social_obligations',
      'account_balances',
      'accounts',
      'investment_accounts',
    ];
    let totalDeleted = 0;
    const txn = db.transaction(() => {
      for (const table of tables) {
        const result = db.prepare(`DELETE FROM ${table}`).run();
        totalDeleted += result.changes;
      }
      return totalDeleted;
    });
    const count = txn();
    return { success: true, deletedCount: count };
  });
}
