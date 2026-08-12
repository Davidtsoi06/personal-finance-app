/**
 * IPC handler registration — thin orchestrator that delegates to domain files.
 * Each domain file follows the pattern: register<Domain>IpcHandlers()
 */
import { registerUpdateIpcHandlers } from './update-ipc';
import { registerAccountIpcHandlers } from './account-ipc';
import { registerAssetIpcHandlers } from './asset-ipc';
import { registerLedgerIpcHandlers } from './ledger-ipc';
import { registerReportIpcHandlers } from './report-ipc';
import { registerSettingsIpcHandlers } from './settings-ipc';
import { registerInsuranceIpcHandlers } from './insurance-ipc';
import { registerWalletIpcHandlers } from './wallet-ipc';

export function registerIpcHandlers(): void {
  // Auto-update
  registerUpdateIpcHandlers();

  // Domain handlers
  registerAccountIpcHandlers();
  registerAssetIpcHandlers();
  registerLedgerIpcHandlers();
  registerReportIpcHandlers();
  registerSettingsIpcHandlers();
  registerInsuranceIpcHandlers();
  registerWalletIpcHandlers();
}
