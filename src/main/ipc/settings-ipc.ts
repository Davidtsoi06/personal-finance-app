/**
 * IPC handlers for investment accounts, net worth, currencies, data refresh,
 * budgets, alerts, app settings, AI chat, data export/import, and archive.
 */
import { ipcMain } from 'electron';
import { handleValidated } from './validation';
import { getDatabase } from '../database';
import * as iaService from '../database/services/investment-account-service';
import * as nwService from '../database/services/net-worth-service';
import * as currencyService from '../database/services/currency-service';
import * as cfService from '../database/services/custom-format-service';
import * as bfService from '../database/services/bank-format-service';
import * as bankParser from '../services/bank-statement-parser';
import { classifyBankRecord } from '../services/statement-classifier';
import { txFingerprint, findTxByHashInDb, findFdForOutRowInDb, findFdForInRowInDb } from '../database/services/statement-pairing';

export function registerSettingsIpcHandlers(): void {
  // ── Investment Accounts ──
  ipcMain.handle('investmentAccount:list', () => iaService.listInvestmentAccounts());
  ipcMain.handle('investmentAccount:get', (_e, id: number) => iaService.getInvestmentAccount(id));
  handleValidated('investmentAccount:create', (data: any) => iaService.createInvestmentAccount(data));
  handleValidated('investmentAccount:update', (id: number, data: any) => iaService.updateInvestmentAccount(id, data));
  handleValidated('investmentAccount:delete', (id: number) => iaService.deleteInvestmentAccount(id));
  ipcMain.handle('investmentAccount:holdings', (_e, id: number) => iaService.getAccountHoldings(id));
  ipcMain.handle('investmentAccount:summary', (_e, id: number) => iaService.getAccountSummary(id));
  ipcMain.handle('investmentAccount:dailyStats', () => iaService.getDailyTradeStats());
  handleValidated('investmentAccount:addCash', (id: number, amount: number) => {
    iaService.addCashBalance(id, amount);
    return { success: true };
  });
  handleValidated('investmentAccount:withdrawCash', (id: number, amount: number) => {
    iaService.withdrawCashBalance(id, amount);
    return { success: true };
  });
  // 现金流水（v1.5.6）
  const cashFlowService = require('../database/services/investment-cash-flow-service');
  handleValidated('investmentAccount:cashFlows', (id: number, limit?: number) =>
    cashFlowService.listCashFlows(id, limit || 200)
  );
  handleValidated('investmentAccount:adjustCash', (id: number, targetBalance: number, notes?: string) => ({
    success: true,
    balance: cashFlowService.adjustCashBalance(id, targetBalance, notes),
  }));
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

  // ── Fixed Deposits ──
  const fdService = require('../database/services/fixed-deposit-service');
  ipcMain.handle('fixedDeposit:listByAccount', (_e, accountId: number) =>
    fdService.listByAccount(accountId)
  );
  handleValidated('fixedDeposit:create', (data: any) =>
    fdService.createFixedDeposit(data)
  );
  // v1.6.1 询问式：balanceMode='sync' 按差额调整余额并写记录；'record_only' 不调余额并脱钩
  handleValidated('fixedDeposit:update', (id: number, data: any, balanceMode?: string) =>
    fdService.updateFixedDeposit(id, data, balanceMode === 'record_only' ? 'record_only' : 'sync')
  );
  // v1.6.1 询问式：restoreBalance=false 仅删记录不退回余额
  handleValidated('fixedDeposit:delete', (id: number, restoreBalance?: boolean) =>
    fdService.deleteFixedDeposit(id, restoreBalance !== false)
  );
  // v1.6.1 到期回款：确认后写存款记录并标记已结算
  handleValidated('fixedDeposit:settle', (id: number, data: any) =>
    fdService.settleFixedDeposit(id, data)
  );
  // v1.9.0：删除联动（both=流水与定期一起删；fd_only=仅删定期、流水脱钩保留）
  handleValidated('fixedDeposit:deleteWithMode', (id: number, mode: 'both' | 'fd_only') =>
    fdService.deleteFixedDepositWithMode(id, mode)
  );
  // v1.9.0：手动创建定期前的反向配对检测（金额+日期 ±3 天）
  handleValidated('fixedDeposit:findMatchingTx', (accountId: number, amount: number, date: string) =>
    fdService.findMatchingTx(accountId, amount, date) || null
  );

  // ── Custom Statement Formats ──
  ipcMain.handle('customFormat:list', () => cfService.listCustomFormats());
  handleValidated('customFormat:create', (data: any) => cfService.createCustomFormat(data));
  handleValidated('customFormat:update', (id: number, data: any) => cfService.updateCustomFormat(id, data));
  handleValidated('customFormat:delete', (id: number) => cfService.deleteCustomFormat(id));

  // ── Bank Statement Formats ──
  ipcMain.handle('bankFormat:list', () => bfService.listBankFormats());
  handleValidated('bankFormat:create', (data: any) => bfService.createBankFormat(data));
  handleValidated('bankFormat:update', (id: number, data: any) => bfService.updateBankFormat(id, data));
  handleValidated('bankFormat:delete', (id: number) => bfService.deleteBankFormat(id));

  // ── Bank Statement Import ──
  ipcMain.handle('bank:listFormats', () => bankParser.getBankFormats());
  ipcMain.handle('bank:parseStatement', (_e, csvText: string, formatName?: string) => {
    const result = bankParser.parseBankStatement(csvText, formatName);
    // v1.9.0：每行附加分类（fd_out/fd_in/normal）
    result.records = result.records.map((r) => ({ ...r, classification: classifyBankRecord(r) }));
    return result;
  });
  // v1.9.0：预览智能建议——每行分类/重复检测/定期配对 + 默认动作
  handleValidated('bank:suggestActions', (records: any[], accountId: number) => {
    const db = getDatabase();
    return records.map((rec, index) => {
      const classification: string = rec.classification || classifyBankRecord(rec);
      const hash = txFingerprint(rec);
      const duplicate = !!findTxByHashInDb(db, accountId, hash);
      let matchFdId: number | null = null;
      let note = '';
      let defaultAction: 'import' | 'skip' | 'create_fd' | 'settle_fd' = 'import';
      if (duplicate) {
        defaultAction = 'skip';
        note = '重复行（同一笔已导入过，自动跳过）';
      } else if (classification === 'fd_out' && rec.type === 'withdraw') {
        const fd = findFdForOutRowInDb(db, accountId, Number(rec.amount), rec.date);
        if (fd) {
          matchFdId = fd.id;
          defaultAction = 'skip';
          note = `已配对定期 #${fd.id}（跳过避免重复扣款）`;
        } else {
          defaultAction = 'create_fd';
          note = '将自动创建定期（到期日待定，回款后自动结清）';
        }
      } else if (classification === 'fd_in' && rec.type === 'deposit') {
        const fd = findFdForInRowInDb(db, accountId, Number(rec.amount), rec.date);
        if (fd) {
          matchFdId = fd.id;
          defaultAction = 'settle_fd';
          const interest = Math.round((Number(rec.amount) - fd.amount) * 100) / 100;
          note = `将结算定期 #${fd.id}（本金 ${fd.amount.toLocaleString()}，利息 ${interest >= 0 ? '+' : ''}${interest.toFixed(2)}）`;
        } else {
          defaultAction = 'import';
          note = '未找到对应定期，按普通存入导入';
        }
      }
      return { index, classification, duplicate, matchFdId, note, defaultAction };
    });
  });

  // v1.9.0：导入执行——行级动作驱动定期生命周期 + 防重复指纹 + 内部转账打标
  handleValidated('bank:importParsed', (records: any[], accountId: number) => {
    const db = getDatabase();
    const fdCore = require('../database/services/fixed-deposit-core');
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: string[] = [];
    const createdFds: { id: number; amount: number; date: string }[] = [];
    const settledFds: { id: number; principal: number; interest: number }[] = [];

    const insertTx = db.prepare(`
      INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, transfer_type, linked_fd_id, statement_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          const type = rec.type === 'withdraw' ? 'withdraw' : 'deposit';
          const notes = rec.description || '银行日结单导入';
          const action: string = rec.action || 'import';
          const hash = txFingerprint({ date, amount, type, description: rec.description || '', currency });

          if (amount <= 0) { errors.push(`金额无效：${JSON.stringify(rec)}`); continue; }

          // 防重复导入：指纹已存在 → 跳过
          if (findTxByHashInDb(db, accountId, hash)) { duplicates++; continue; }
          if (action === 'skip') { skipped++; continue; }

          let txId: number | null = null;

          if (action === 'create_fd' && type === 'withdraw') {
            // 自动创建定期：流水即银行扣款，定存不再扣
            const r = insertTx.run(accountId, type, amount, currency, date, notes, 'fd_out', null, hash);
            txId = Number(r.lastInsertRowid);
            const fd = fdCore.createFixedDepositFromStatementInDb(db, {
              account_id: accountId, amount, currency, start_date: date, linked_tx_id: txId, notes,
            });
            db.prepare('UPDATE account_transactions SET linked_fd_id = ? WHERE id = ?').run(fd.id, txId);
            createdFds.push({ id: fd.id, amount, date });
            imported++;
          } else if (action === 'settle_fd' && type === 'deposit') {
            const fd = findFdForInRowInDb(db, accountId, amount, date);
            if (!fd) {
              // 无匹配定期 → 降级为普通存入
              insertTx.run(accountId, type, amount, currency, date, notes, null, null, hash);
              imported++;
            } else {
              const r = insertTx.run(accountId, type, amount, currency, date, notes, 'fd_in', fd.id, hash);
              txId = Number(r.lastInsertRowid);
              const settled = fdCore.settleFixedDepositFromStatementInDb(db, fd.id, {
                creditAmount: amount, date, linked_tx_id: txId,
              });
              if (settled) settledFds.push({ id: fd.id, principal: settled.principal, interest: settled.interest });
              imported++;
            }
          } else {
            insertTx.run(accountId, type, amount, currency, date, notes, null, null, hash);
            imported++;
          }

          // Update balance
          const delta = type === 'deposit' ? amount : -amount;
          const existing = getBalance.get(accountId, currency) as any;
          const newBalance = (existing?.balance || 0) + delta;
          upsertBalance.run(accountId, currency, newBalance);
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
    return { imported, skipped, duplicates, errors, createdFds, settledFds };
  });

  ipcMain.handle('bank:importExcel', async (_e, formatName?: string) => {
    const { dialog } = require('electron') as typeof import('electron');
    const xlsx = require('xlsx') as typeof import('xlsx');

    const result = await dialog.showOpenDialog({
      title: '选择银行日结单文件',
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
        const parseResult = bankParser.parseBankStatement(csvText, formatName);
        parseResult.records = parseResult.records.map((r) => ({ ...r, classification: classifyBankRecord(r) }));
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
      const parseResult = bankParser.parseBankRows(rows, formatName);
      parseResult.records = parseResult.records.map((r) => ({ ...r, classification: classifyBankRecord(r) }));
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
  handleValidated('currency:updateRate', (code: string, rate: number) => currencyService.updateRate(code, rate));
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
  handleValidated('budget:create', (data: any) => budgetService.createBudget(data));
  handleValidated('budget:update', (id: number, data: any) => budgetService.updateBudget(id, data));
  handleValidated('budget:delete', (id: number) => budgetService.deleteBudget(id));
  ipcMain.handle('budget:status', (_e, month: string) => budgetService.getBudgetStatus(month));

  // ── Alerts ──
  const alertService = require('../database/services/alert-service');
  ipcMain.handle('alert:listConfig', () => alertService.listAlertConfigs());
  ipcMain.handle('alert:updateConfig', (_e, id: number, data: any) => alertService.updateAlertConfig(id, data));

  // ── Social Obligations ──
  const socialObligationService = require('../database/services/social-obligation-service');
  ipcMain.handle('socialObligation:list', (_e, type?: string) => socialObligationService.listObligations(type));
  handleValidated('socialObligation:create', (data: any) => socialObligationService.createObligation(data));
  handleValidated('socialObligation:update', (id: number, data: any) => socialObligationService.updateObligation(id, data));
  handleValidated('socialObligation:delete', (id: number) => socialObligationService.deleteObligation(id));

  // ── App Settings ──
  const settingsService = require('../database/services/settings-service');
  ipcMain.handle('settings:getAiConfig', () => settingsService.getAiConfigPublic());
  handleValidated('settings:saveAiConfig', (config: any) => {
    settingsService.saveAiConfig(config);
    return { success: true };
  });
  ipcMain.handle('settings:testAiConnection', async (_e, config?: any) => {
    return settingsService.testAiConnection(config);
  });
  ipcMain.handle('settings:getAppName', () => settingsService.getAppName());
  handleValidated('settings:setAppName', async (name: string) => {
    settingsService.setAppName(name);
    // Dynamically update window title
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setTitle(name.trim() || '个人理财投资软件');
    // v1.8.1：同步桌面/开始菜单快捷方式名称（失败非致命）
    const { syncShortcutNames } = require('../services/shortcut-sync') as typeof import('../services/shortcut-sync');
    const trimmed = name.trim();
    let synced = 0;
    if (trimmed) {
      const { app } = require('electron') as typeof import('electron');
      synced = await syncShortcutNames(app.getPath('exe'), trimmed);
    }
    return { success: true, syncedShortcuts: synced };
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

  // v1.10.0：AI 生成日结单模板（bank=银行 / broker=券商）
  handleValidated('ai:generateFormat', async (sample: string, kind: 'bank' | 'broker') => {
    const result = await aiService.generateStatementFormat(sample, kind);
    return { success: true, format: result };
  });

  // v1.10.1：AI 生成模板读取样例文件（CSV 取原文前 30 行；Excel 解析首表转制表符文本前 30 行）
  handleValidated('ai:readSampleFile', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const result = await dialog.showOpenDialog({
      title: '选择日结单文件（Excel / CSV）',
      filters: [
        { name: 'Excel / CSV 文件', extensions: ['xlsx', 'xls', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    const fs = require('fs');
    const ext = filePath.split('.').pop()?.toLowerCase();
    try {
      if (ext === 'csv') {
        const text = fs.readFileSync(filePath, 'utf-8');
        return {
          canceled: false,
          fileName: filePath.split(/[\\/]/).pop() || filePath,
          sampleText: text.split(/\r?\n/).filter((l: string) => l.trim()).slice(0, 30).join('\n'),
        };
      }
      const xlsx = require('xlsx') as typeof import('xlsx');
      const fileBuffer = fs.readFileSync(filePath);
      // v1.10.4：白名单日期格式识别（不用 cellDates——SheetJS 会把 HK$#,##0.00 里的 h 误判为小时）：
      // 日期格式单元格（序列号）→ 日期文本；金额等普通数字保持原样
      const workbook = ext === 'xls'
        ? xlsx.read(fileBuffer, { type: 'buffer', codepage: 936 })
        : xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = aiService.xlsxSheetToSampleRows(sheet);
      return {
        canceled: false,
        fileName: filePath.split(/[\\/]/).pop() || filePath,
        sampleText: aiService.rowsToSampleText(rows),
      };
    } catch (err: any) {
      return { canceled: false, error: `读取文件失败：${err.message}` };
    }
  });

  // v1.10.6：AI 会话持久化与报告归档
  const aiSession = require('../database/services/ai-session-service');
  handleValidated('ai:sessionCreate', (title: string) => aiSession.createSession(title));
  ipcMain.handle('ai:sessionList', () => aiSession.listSessions());
  handleValidated('ai:sessionDelete', (id: number) => aiSession.deleteSession(id));
  ipcMain.handle('ai:sessionMessages', (_e, sessionId: number) => aiSession.listMessages(sessionId));
  handleValidated('ai:messageAppend', (sessionId: number, role: string, content: string) =>
    aiSession.appendMessage(sessionId, role as 'user' | 'assistant', content)
  );
  handleValidated('ai:reportSave', (data: any) =>
    aiSession.saveReport(data.sessionId ?? null, data.title, data.content)
  );
  ipcMain.handle('ai:reportList', () => aiSession.listReports());
  ipcMain.handle('ai:reportGet', (_e, id: number) => aiSession.getReport(id) || null);
  handleValidated('ai:reportDelete', (id: number) => aiSession.deleteReport(id));

  /** 导出（md 直写 / pdf 隐藏窗口打印），report 与 session 共用 */
  const exportAiDocument = async (title: string, md: string, format: string) => {
    const { dialog } = require('electron') as typeof import('electron');
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const result = await dialog.showSaveDialog({
      title: '导出 AI 报告',
      defaultPath: `${safeTitle}.${format}`,
      filters: format === 'pdf'
        ? [{ name: 'PDF', extensions: ['pdf'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    const fs = require('fs');
    if (format !== 'pdf') {
      fs.writeFileSync(result.filePath, md, 'utf-8');
      return { success: true, filePath: result.filePath };
    }
    const { BrowserWindow } = require('electron') as typeof import('electron');
    const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<style>body{font-family:"Microsoft YaHei",sans-serif;padding:28px;line-height:1.8;color:#222}
h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #bbb;padding:4px 10px;font-size:13px}code{background:#f2f2f2;padding:1px 5px;border-radius:3px}
pre{background:#f7f7f7;padding:10px;overflow:auto;border-radius:4px}blockquote{border-left:4px solid #ddd;margin:0;padding-left:12px;color:#555}
ul{padding-left:22px}</style></head><body>${aiSession.mdToHtml(md)}</body></html>`;
    const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({ printBackground: true });
      fs.writeFileSync(result.filePath, pdf);
      return { success: true, filePath: result.filePath };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };

  handleValidated('ai:reportExport', async (reportId: number, format: string) => {
    const report = aiSession.getReport(reportId);
    if (!report) return { success: false, error: '报告不存在' };
    return exportAiDocument(report.title, report.content, format);
  });
  handleValidated('ai:sessionExport', async (sessionId: number, format: string) => {
    const sessions = aiSession.listSessions();
    const session = sessions.find((s: any) => s.id === sessionId);
    const messages = aiSession.listMessages(sessionId);
    if (!session || messages.length === 0) return { success: false, error: '会话无内容可导出' };
    return exportAiDocument(session.title, aiSession.sessionToMarkdown(session.title, messages), format);
  });

  // v1.10.5：API 余额查询（DeepSeek/OpenAI）
  handleValidated('ai:balance', async () => {
    try {
      const result = await aiService.fetchBalance();
      return { success: true, ...result, fetchedAt: new Date().toISOString() };
    } catch (err: any) {
      return { success: false, error: err.message || '余额查询失败' };
    }
  });

  // v1.10.5：今日 AI 用量（本地统计）
  handleValidated('ai:usageToday', () => aiService.getUsageToday());

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
  // v1.7.1：confirmImport 只接受 data:importAll 对话框回传的路径（防渲染端任意文件读取）
  let pendingImportPath: string | null = null;

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
        { sheet: '券商现金流水', sql: 'SELECT * FROM investment_cash_flows ORDER BY id' },
        { sheet: '存取记录', sql: 'SELECT * FROM account_transactions ORDER BY date DESC, id DESC' },
        { sheet: '多币种余额', sql: 'SELECT * FROM account_balances ORDER BY account_id, currency' },
        { sheet: '定期存款', sql: 'SELECT * FROM fixed_deposits ORDER BY id' },
        { sheet: '收支记账', sql: 'SELECT * FROM ledgers ORDER BY date DESC, id DESC' },
        { sheet: '收支分类', sql: 'SELECT * FROM categories ORDER BY id' },
        { sheet: '货币汇率', sql: 'SELECT * FROM currencies ORDER BY id' },
        { sheet: '汇率历史', sql: 'SELECT * FROM exchange_rates ORDER BY date DESC' },
        { sheet: '价格历史', sql: 'SELECT * FROM asset_prices ORDER BY date DESC' },
        { sheet: '净值历史', sql: 'SELECT * FROM net_worth_history ORDER BY date DESC' },
        { sheet: '预算', sql: 'SELECT * FROM budgets ORDER BY month DESC' },
        { sheet: '提醒配置', sql: 'SELECT * FROM alert_config ORDER BY id' },
        { sheet: '自定义格式', sql: 'SELECT * FROM custom_statement_formats ORDER BY id' },
        { sheet: '银行自定义格式', sql: 'SELECT * FROM custom_bank_formats ORDER BY id' },
        { sheet: '人情债', sql: 'SELECT * FROM social_obligations ORDER BY created_at DESC' },
        { sheet: '保单', sql: 'SELECT * FROM insurance_policies ORDER BY id' },
        { sheet: '保费缴纳', sql: 'SELECT * FROM premium_payments ORDER BY paid_date DESC, id DESC' },
        { sheet: '应用设置', sql: 'SELECT * FROM app_settings ORDER BY key' },
      ];

      const workbook = xlsx.utils.book_new();
      for (const t of tables) {
        let rows = db.prepare(t.sql).all() as any[];
        // v1.7.1：敏感配置不随备份导出（AI Key / 启动密码 / SMTP 凭据），恢复后需在设置中重新配置
        if (t.sheet === '应用设置') {
          rows = rows.filter((r: any) => !r.key.startsWith('ai.') && !r.key.startsWith('auth.') && !r.key.startsWith('smtp.'));
        }
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

      // v1.7.1：记录待导入路径，confirmImport 仅接受该路径
      pendingImportPath = result.filePaths[0];
      return { success: true, preview, filePath: result.filePaths[0], workbookReady: true };
    } catch (err: any) {
      console.error('[data:importAll] 读取备份失败:', err);
      return { success: false, error: '读取备份文件失败：文件格式不正确或已损坏' };
    }
  });

  handleValidated('data:confirmImport', async (filePath: string) => {
    // v1.7.1：路径必须与 data:importAll 对话框回传一致（一次性会话）
    const path = require('path') as typeof import('path');
    if (!pendingImportPath || path.resolve(filePath) !== path.resolve(pendingImportPath)) {
      throw new Error('导入文件校验失败，请重新选择备份文件');
    }
    if (!filePath.toLowerCase().endsWith('.xlsx')) {
      throw new Error('仅支持 .xlsx 备份文件');
    }
    pendingImportPath = null;

    const xlsx = require('xlsx') as typeof import('xlsx');
    const db = getDatabase();
    const fs = require('fs');

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

      const sheetToTable: Record<string, string> = {
        '账户': 'accounts', '投资账户': 'investment_accounts', '资产持仓': 'assets',
        '投资交易': 'transactions', '券商现金流水': 'investment_cash_flows', '存取记录': 'account_transactions', '收支记账': 'ledgers',
        '收支分类': 'categories', '货币汇率': 'currencies', '汇率历史': 'exchange_rates',
        '价格历史': 'asset_prices', '净值历史': 'net_worth_history', '预算': 'budgets',
        '提醒配置': 'alert_config', '自定义格式': 'custom_statement_formats',
        '银行自定义格式': 'custom_bank_formats', '人情债': 'social_obligations',
        '多币种余额': 'account_balances', '定期存款': 'fixed_deposits',
        '保单': 'insurance_policies', '保费缴纳': 'premium_payments',
        '应用设置': 'app_settings',
      };

      // 按外键依赖排序：被引用表先导入（删除时反向执行）
      const importOrder = [
        '货币汇率', '收支分类', '账户', '多币种余额', '定期存款', '投资账户',
        '自定义格式', '银行自定义格式',
        '资产持仓', '投资交易', '券商现金流水', '存取记录', '收支记账',
        '汇率历史', '价格历史', '净值历史', '预算', '提醒配置',
        '人情债', '保单', '保费缴纳', '应用设置',
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
        let totalSkipped = 0;
        for (const sheet of importOrder) {
          const table = sheetToTable[sheet];
          if (!table || !workbook.SheetNames.includes(sheet)) continue;

          const ws = workbook.Sheets[sheet];
          const rows = xlsx.utils.sheet_to_json(ws) as any[];
          if (rows.length === 0) continue;

          // 只允许数据库中真实存在的列名（防 SQL 注入 + 兼容列名差异）
          const tableCols = new Set(
            (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name)
          );
          const keys = Object.keys(rows[0]).filter((k) => tableCols.has(k));
          if (keys.length === 0) continue;

          const placeholders = keys.map(() => '?').join(', ');
          const cols = keys.map((k) => `"${k}"`).join(', ');
          const insert = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`);

          for (const row of rows) {
            try { insert.run(...keys.map((k) => row[k])); totalImported++; }
            catch { totalSkipped++; }
          }
        }
        return { totalImported, totalSkipped };
      });

      const { totalImported, totalSkipped } = transaction();
      if (totalSkipped > 0) {
        console.warn(`[data:confirmImport] ${totalSkipped} 行因数据不合法被跳过`);
      }
      return { success: true, totalImported, totalSkipped };
    } catch (err: any) {
      console.error('[data:confirmImport] 导入失败:', err);
      return { success: false, error: '导入失败：数据不完整或文件已损坏' };
    }
  });

  // ── Data Archive ──
  const archiveService = require('../services/archive-service');
  ipcMain.handle('archive:getPendingMonths', () => archiveService.getPendingMonths());
  handleValidated('archive:execute', (months: string[]) => archiveService.executeArchive(months));
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

  // ── 完整数据包导出/导入（v1.8.1：跨设备迁移，.pfbak = zip(DB+密钥)） ──
  handleValidated('data:exportPackage', async () => {
    const { dialog, app } = require('electron') as typeof import('electron');
    const result = await dialog.showSaveDialog({
      title: '导出完整数据包',
      defaultPath: `个人理财数据包_${new Date().toISOString().slice(0, 10)}.pfbak`,
      filters: [{ name: '数据包', extensions: ['pfbak'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    const { exportPackage } = require('../services/data-package') as typeof import('../services/data-package');
    // v1.9.1：在线备份自洽快照（WAL 已合并），避免导出缺数据
    await exportPackage(app.getPath('userData'), result.filePath, app.getVersion(), getDatabase());
    return { success: true, filePath: result.filePath };
  });

  handleValidated('data:importPackage', async () => {
    const { dialog, app } = require('electron') as typeof import('electron');
    const result = await dialog.showOpenDialog({
      title: '导入完整数据包',
      filters: [{ name: '数据包', extensions: ['pfbak'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const confirm = await dialog.showMessageBox({
      type: 'warning',
      title: '确认导入',
      message: '导入数据包将覆盖本机全部数据！',
      detail: '当前数据会自动备份到数据目录 backups 文件夹。导入完成后应用将自动重启。',
      buttons: ['取消', '我已了解，开始导入'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response !== 1) return { success: false, canceled: true };
    const { importPackage } = require('../services/data-package') as typeof import('../services/data-package');
    const { closeDatabase, initDatabase } = require('../database');
    // v1.9.1：关闭连接并清理残留 WAL/SHM 后再替换，重开失败自动回滚
    const backupPath = await importPackage(app.getPath('userData'), result.filePaths[0], getDatabase(), {
      close: () => closeDatabase(),
      reopen: () => {
        try { initDatabase(); return true; } catch (e) {
          console.error('[data:importPackage] 重新打开失败:', e);
          return false;
        }
      },
    });
    // 重启应用加载新数据
    setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
    return { success: true, backupPath };
  });

  handleValidated('settings:getUserDataPath', () => {
    const { app } = require('electron') as typeof import('electron');
    return app.getPath('userData');
  });

  handleValidated('settings:openUserDataDir', () => {
    const { shell, app } = require('electron') as typeof import('electron');
    shell.openPath(app.getPath('userData'));
    return { ok: true };
  });

  // ── One-click Data Clear（v1.7.1：handleValidated 校验 + 密码锁门禁 + 主进程二次确认） ──
  handleValidated('data:clearAll', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: '清空全部数据',
      message: '即将删除全部业务数据（账户/持仓/交易/记账/保单等）！',
      detail: '此操作不可撤销。系统设置（汇率/分类/应用设置）会保留。建议先「导出数据备份」。',
      buttons: ['取消', '我已备份，确认清空'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice.response !== 1) return { success: false, canceled: true };

    const db = getDatabase();
    // 按外键依赖顺序删除：子表在前、父表在后。
    // 保留系统数据：currencies / categories / alert_config / app_settings（应用设置与默认分类）。
    const tables = [
      'investment_cash_flows', // → transactions / investment_accounts（v1.7.1 补上，否则外键违约）
      'asset_prices',          // → assets
      'transactions',          // → assets
      'account_transactions',  // → accounts / investment_accounts
      'ledgers',               // → accounts / categories
      'fixed_deposits',        // → accounts
      'premium_payments',      // → insurance_policies / accounts
      'insurance_policies',    // → accounts
      'account_balances',      // → accounts
      'assets',                // → accounts / investment_accounts
      'social_obligations',
      'budgets',
      'net_worth_history',
      'investment_accounts',   // → accounts (funding_account_id)
      'accounts',
      'custom_statement_formats',
      'custom_bank_formats',
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
