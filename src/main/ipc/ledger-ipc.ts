/**
 * IPC handlers for ledgers and categories.
 */
import { ipcMain } from 'electron';
import * as ledgerService from '../database/services/ledger-service';
import * as categoryService from '../database/services/category-service';
import { normalizeDate, normalizeCurrency, normalizeString } from '../services/data-normalizer';
import { handleValidated } from './validation';

export function registerLedgerIpcHandlers(): void {
  // ── Ledgers ──
  ipcMain.handle('ledger:list', (_e, params?: any) => ledgerService.listLedgers(params));
  ipcMain.handle('ledger:get', (_e, id: number) => ledgerService.getLedger(id));
  handleValidated('ledger:create', (data: any) => {
    data.date = normalizeDate(data.date);
    data.currency = normalizeCurrency(data.currency, 'CNY');
    data.description = normalizeString(data.description);
    return ledgerService.createLedger(data);
  });
  handleValidated('ledger:update', (id: number, data: any) => {
    if (data.date) data.date = normalizeDate(data.date);
    if (data.currency) data.currency = normalizeCurrency(data.currency, 'CNY');
    if (data.description) data.description = normalizeString(data.description);
    return ledgerService.updateLedger(id, data);
  });
  handleValidated('ledger:delete', (id: number) => ledgerService.deleteLedger(id));
  ipcMain.handle('ledger:monthlySummary', (_e, year: number, month: number) =>
    ledgerService.getMonthlySummary(year, month)
  );

  // ── Categories ──
  ipcMain.handle('category:list', (_e, type?: string) => categoryService.listCategories(type));
  ipcMain.handle('category:get', (_e, id: number) => categoryService.getCategory(id));
  handleValidated('category:create', (data: any) => categoryService.createCategory(data));
  handleValidated('category:update', (id: number, data: any) => categoryService.updateCategory(id, data));
  handleValidated('category:delete', (id: number) => categoryService.deleteCategory(id));
}
