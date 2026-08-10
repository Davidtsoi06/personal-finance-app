/**
 * IPC handlers for accounts and account transactions.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import * as accountService from '../database/services/account-service';
import * as atService from '../database/services/account-transaction-service';
import { normalizeDate, normalizeCurrency } from '../services/data-normalizer';

export function registerAccountIpcHandlers(): void {
  // ── Accounts ──
  ipcMain.handle('account:list', () => accountService.listAccounts());
  ipcMain.handle('account:listTree', () => accountService.listAccountsAsTree());
  ipcMain.handle('account:get', (_e, id: number) => accountService.getAccountWithTree(id));
  ipcMain.handle('account:create', (_e, data: any) => accountService.createAccount(data));
  ipcMain.handle('account:update', (_e, id: number, data: any) => accountService.updateAccount(id, data));
  ipcMain.handle('account:delete', (_e, id: number) => accountService.deleteAccount(id));
  ipcMain.handle('account:forceDelete', (_e, id: number) => accountService.forceDeleteAccount(id));
  ipcMain.handle('account:totalBalance', (_e, currency?: string) => accountService.getTotalBalance(currency));
  ipcMain.handle('account:balances', (_e, accountId: number) => accountService.getAccountBalances(accountId));
  ipcMain.handle('account:createWithChildren', (_e, data: any) => accountService.createAccountWithChildren(data));
  ipcMain.handle('account:allAssetsSummary', () => accountService.getAllAssetsSummary());

  // ── Account Transactions (deposit/withdraw) ──
  ipcMain.handle('accountTransaction:list', (_e, accountId: number) =>
    atService.listAccountTransactions(accountId)
  );
  ipcMain.handle('accountTransaction:create', (_e, data: any) => {
    data.date = normalizeDate(data.date);
    data.currency = normalizeCurrency(data.currency, 'CNY');
    return atService.createAccountTransaction(data);
  });
  ipcMain.handle('accountTransaction:update', (_e, id: number, data: any) => {
    if (data.date) data.date = normalizeDate(data.date);
    if (data.currency) data.currency = normalizeCurrency(data.currency, 'CNY');
    return atService.updateAccountTransaction(id, data);
  });
  ipcMain.handle('accountTransaction:delete', (_e, id: number) =>
    atService.deleteAccountTransaction(id)
  );
}
