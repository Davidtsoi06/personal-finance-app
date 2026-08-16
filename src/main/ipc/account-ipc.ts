/**
 * IPC handlers for accounts and account transactions.
 */
import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import * as accountService from '../database/services/account-service';
import * as atService from '../database/services/account-transaction-service';
import { normalizeDate, normalizeCurrency } from '../services/data-normalizer';
import { handleValidated } from './validation';

export function registerAccountIpcHandlers(): void {
  // ── Accounts ──
  ipcMain.handle('account:list', () => accountService.listAccounts());
  ipcMain.handle('account:listTree', () => accountService.listAccountsAsTree());
  ipcMain.handle('account:get', (_e, id: number) => accountService.getAccountWithTree(id));
  handleValidated('account:create', (data: any) => accountService.createAccount(data));
  handleValidated('account:update', (id: number, data: any) => accountService.updateAccount(id, data));
  handleValidated('account:delete', (id: number) => accountService.deleteAccount(id));
  handleValidated('account:forceDelete', (id: number) => accountService.forceDeleteAccount(id));
  handleValidated('account:deleteImpact', (id: number) => accountService.getForceDeleteImpact(id));
  ipcMain.handle('account:totalBalance', (_e, currency?: string) => accountService.getTotalBalance(currency));
  ipcMain.handle('account:balances', (_e, accountId: number) => accountService.getAccountBalances(accountId));
  handleValidated('account:createWithChildren', (data: any) => accountService.createAccountWithChildren(data));
  ipcMain.handle('account:allAssetsSummary', () => accountService.getAllAssetsSummary());

  // ── Account Transactions (deposit/withdraw) ──
  ipcMain.handle('accountTransaction:list', (_e, accountId: number) =>
    atService.listAccountTransactions(accountId)
  );
  handleValidated('accountTransaction:create', (data: any) => {
    data.date = normalizeDate(data.date);
    data.currency = normalizeCurrency(data.currency, 'CNY');
    return atService.createAccountTransaction(data);
  });
  handleValidated('accountTransaction:update', (id: number, data: any, syncBrokerCash?: boolean) => {
    if (data.date) data.date = normalizeDate(data.date);
    if (data.currency) data.currency = normalizeCurrency(data.currency, 'CNY');
    // v1.6.1：联动询问式——默认同步券商流动金（渲染端弹窗确认后传入）
    return atService.updateAccountTransaction(id, data, syncBrokerCash !== false);
  });
  handleValidated('accountTransaction:delete', (id: number) =>
    atService.deleteAccountTransaction(id)
  );
}
