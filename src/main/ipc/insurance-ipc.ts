/**
 * IPC handlers for insurance policies and premium payments.
 */
import { ipcMain } from 'electron';
import * as insuranceService from '../database/services/insurance-service';
import { handleValidated } from './validation';

export function registerInsuranceIpcHandlers(): void {
  // ── Policies ──
  ipcMain.handle('insurance:listPolicies', () => insuranceService.listPolicies());
  ipcMain.handle('insurance:getPolicy', (_e, id: number) => insuranceService.getPolicy(id));
  handleValidated('insurance:createPolicy', (data: any) => insuranceService.createPolicy(data));
  handleValidated('insurance:updatePolicy', (id: number, data: any) => insuranceService.updatePolicy(id, data));
  handleValidated('insurance:deletePolicy', (id: number) => insuranceService.deletePolicy(id));

  // ── Premium Payments ──
  handleValidated('insurance:payPremium', (data: any) => insuranceService.payPremium(data));
  ipcMain.handle('insurance:listPayments', (_e, policyId: number) => insuranceService.listPayments(policyId));

  // ── Queries ──
  ipcMain.handle('insurance:totalCashValue', () => insuranceService.getTotalCashValue());
  ipcMain.handle('insurance:getDuePolicies', (_e, month: number, day: number) =>
    insuranceService.getDuePolicies(month, day)
  );
}
