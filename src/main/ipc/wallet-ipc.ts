/**
 * IPC handlers for wallet (WeChat/Alipay/Cash) flow management.
 */
import { ipcMain } from 'electron';
import * as atService from '../database/services/account-transaction-service';
import * as accountService from '../database/services/account-service';
import { handleValidated } from './validation';

export function registerWalletIpcHandlers(): void {
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
