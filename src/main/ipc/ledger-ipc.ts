/**
 * IPC handlers for ledgers and categories.
 */
import { ipcMain } from 'electron';
import * as ledgerService from '../database/services/ledger-service';
import * as categoryService from '../database/services/category-service';
import { normalizeDate, normalizeCurrency, normalizeString } from '../services/data-normalizer';

export function registerLedgerIpcHandlers(): void {
  // ── Ledgers ──
  ipcMain.handle('ledger:list', (_e, params?: any) => ledgerService.listLedgers(params));
  ipcMain.handle('ledger:get', (_e, id: number) => ledgerService.getLedger(id));
  ipcMain.handle('ledger:create', (_e, data: any) => {
    data.date = normalizeDate(data.date);
    data.currency = normalizeCurrency(data.currency, 'CNY');
    data.description = normalizeString(data.description);
    return ledgerService.createLedger(data);
  });
  ipcMain.handle('ledger:update', (_e, id: number, data: any) => ledgerService.updateLedger(id, data));
  ipcMain.handle('ledger:delete', (_e, id: number) => ledgerService.deleteLedger(id));
  ipcMain.handle('ledger:monthlySummary', (_e, year: number, month: number) =>
    ledgerService.getMonthlySummary(year, month)
  );

  // ── Categories ──
  ipcMain.handle('category:list', (_e, type?: string) => categoryService.listCategories(type));
  ipcMain.handle('category:get', (_e, id: number) => categoryService.getCategory(id));
  ipcMain.handle('category:create', (_e, data: any) => categoryService.createCategory(data));
  ipcMain.handle('category:update', (_e, id: number, data: any) => categoryService.updateCategory(id, data));
  ipcMain.handle('category:delete', (_e, id: number) => categoryService.deleteCategory(id));
}
