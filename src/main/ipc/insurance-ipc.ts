/**
 * IPC handlers for insurance policies and premium payments.
 */
import { ipcMain } from 'electron';
import * as insuranceService from '../database/services/insurance-service';

export function registerInsuranceIpcHandlers(): void {
  // ── Policies ──
  ipcMain.handle('insurance:listPolicies', () => insuranceService.listPolicies());
  ipcMain.handle('insurance:getPolicy', (_e, id: number) => insuranceService.getPolicy(id));
  ipcMain.handle('insurance:createPolicy', (_e, data: any) => insuranceService.createPolicy(data));
  ipcMain.handle('insurance:updatePolicy', (_e, id: number, data: any) => insuranceService.updatePolicy(id, data));
  ipcMain.handle('insurance:deletePolicy', (_e, id: number) => insuranceService.deletePolicy(id));

  // ── Premium Payments ──
  ipcMain.handle('insurance:payPremium', (_e, data: any) => insuranceService.payPremium(data));
  ipcMain.handle('insurance:listPayments', (_e, policyId: number) => insuranceService.listPayments(policyId));

  // ── Queries ──
  ipcMain.handle('insurance:totalCashValue', () => insuranceService.getTotalCashValue());
  ipcMain.handle('insurance:getDuePolicies', (_e, month: number, day: number) =>
    insuranceService.getDuePolicies(month, day)
  );
}
