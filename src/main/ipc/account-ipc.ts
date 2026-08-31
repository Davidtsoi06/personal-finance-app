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
  // v1.10.9：删除余额为 0 的币种桶（多币种卡片清理占位格子）
  handleValidated('account:deleteBalanceBucket', (accountId: number, currency: string) =>
    accountService.deleteAccountBalanceBucket(accountId, currency)
  );
  handleValidated('account:delete', (id: number) => accountService.deleteAccount(id));
  handleValidated('account:forceDelete', (id: number) => accountService.forceDeleteAccount(id));
  handleValidated('account:deleteImpact', (id: number) => accountService.getForceDeleteImpact(id));
  ipcMain.handle('account:totalBalance', (_e, currency?: string) => accountService.getTotalBalance(currency));
  ipcMain.handle('account:balances', (_e, accountId: number) => accountService.getAccountBalances(accountId));
  handleValidated('account:createWithChildren', (data: any) => accountService.createAccountWithChildren(data));
  // v1.10.6：支付宝多区域模板（父账户 + 国内/香港子账户）
  handleValidated('account:createAlipayFamily', () => accountService.createAlipayFamily());
  // v1.10.7：支付宝账户归类升级（幂等）——现有支付宝账户归入「支付宝（国内）」子账户 + 自动补建香港子账户
  handleValidated('account:ensureAlipayFamily', () => accountService.ensureAlipayFamily());
  ipcMain.handle('account:allAssetsSummary', () => accountService.getAllAssetsSummary());

  // ── Account Transactions (deposit/withdraw) ──
  // v1.8.0：支持 limit 分页（默认 100，渲染端「加载更多」递增）
  ipcMain.handle('accountTransaction:list', (_e, accountId: number, limit?: number) =>
    atService.listAccountTransactions(accountId, limit)
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
  // v1.9.0：联动删除——tx_only 仅删流水（定期脱钩保留）；both 流水与定期一起删
  handleValidated('accountTransaction:deleteWithMode', (id: number, mode: 'tx_only' | 'both') =>
    atService.deleteAccountTransactionWithMode(id, mode)
  );
}
