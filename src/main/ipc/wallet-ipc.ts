/**
 * IPC handlers for wallet (WeChat/Alipay/Cash) flow management.
 */
import { ipcMain } from 'electron';
import * as atService from '../database/services/account-transaction-service';
import * as accountService from '../database/services/account-service';
import { handleValidated } from './validation';

export function registerWalletIpcHandlers(): void {
  // v1.10.6：解析微信/支付宝账单文件（文件对话框 → 主进程解析 → 返回记录供预览）
  handleValidated('wallet:parseFile', async () => {
    const { dialog } = require('electron') as typeof import('electron');
    const result = await dialog.showOpenDialog({
      title: '选择账单文件（微信 Excel / 支付宝或微信 CSV）',
      filters: [
        { name: '账单文件', extensions: ['xlsx', 'xls', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    const fs = require('fs');
    const ext = filePath.split('.').pop()?.toLowerCase();
    const parser = require('../services/wallet-bill-parser') as typeof import('../services/wallet-bill-parser');
    try {
      if (ext === 'csv') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const parsed = parser.parseCsvAuto(text);
        return {
          canceled: false,
          fileName: filePath.split(/[\\/]/).pop() || filePath,
          ...parsed,
        };
      }
      const xlsx = require('xlsx') as typeof import('xlsx');
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = ext === 'xls'
        ? xlsx.read(fileBuffer, { type: 'buffer', codepage: 936 })
        : xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rows: unknown[][] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      const parsed = parser.parseWechatExcel(rows);
      return {
        canceled: false,
        fileName: filePath.split(/[\\/]/).pop() || filePath,
        ...parsed,
      };
    } catch (err: any) {
      return { canceled: false, format: 'unknown', records: [], errors: [`读取账单文件失败：${err.message}`] };
    }
  });

  // Get system wallets
  ipcMain.handle('wallet:getSystemWallets', () => accountService.getSystemWallets());

  // Import bills (WeChat/Alipay CSV)
  handleValidated('wallet:importBills', (accountId: number, records: any[]) =>
    atService.importWalletBills(accountId, records)
  );

  // List bank accounts grouped by bank name
  ipcMain.handle('account:listByBankName', () => {
    const groups = accountService.listByBankName();
    const result: { bankName: string; accounts: any[] }[] = [];
    for (const [bankName, accounts] of groups) {
      result.push({ bankName, accounts });
    }
    return result;
  });

  // List bank-type accounts for dropdowns
  ipcMain.handle('account:listBankAccounts', () => accountService.listBankAccounts());
}
