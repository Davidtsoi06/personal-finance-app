import electron = require('electron');

/**
 * Preload script - exposes a safe API to the renderer process.
 * All communication between renderer and main process goes through here.
 *
 * ⚠️ 安全白名单：invoke 仅放行主进程已注册的频道。
 * 本列表与 src/shared/types/ipc.ts 类型联合三处一致，由 scripts/check-ipc-whitelist.js
 * 校验（npm test 自动执行）。新增 IPC 频道时先在主进程注册，再运行 npm run check:ipc。
 */
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  'app:ping',
  // ── 启动密码锁（v1.7.0） ──
  'auth:status',
  'auth:setRecoveryEmail',
  'auth:setupSmtp',
  'auth:sendTestEmail',
  'auth:enable',
  'auth:changePassword',
  'auth:disable',
  'auth:verify',
  'auth:lock',
  'auth:quit',
  'auth:requestResetCode',
  'auth:verifyResetCode',
  'auth:resetPassword',
  'auth:setIdleMinutes',
  'onboarding:complete',
  'account:allAssetsSummary',
  'account:balances',
  'account:create',
  'account:createWithChildren',
  'account:delete',
  'account:deleteImpact',
  'account:forceDelete',
  'account:get',
  'account:list',
  'account:listBankAccounts',
  'account:listByBankName',
  'account:listTree',
  'account:totalBalance',
  'account:update',
  'accountTransaction:create',
  'accountTransaction:delete',
  'accountTransaction:deleteWithMode',
  'accountTransaction:list',
  'accountTransaction:update',
  'ai:chat',
  'ai:chatStream',
  'ai:dailySummary',
  'ai:generateFormat',
  'ai:readSampleFile',
  'ai:balance',
  'ai:usageToday',
  'alert:listConfig',
  'alert:updateConfig',
  'archive:execute',
  'archive:getPendingMonths',
  'archive:getSettings',
  'archive:setFolder',
  'archive:setRetentionMonths',
  'asset:create',
  'asset:delete',
  'asset:get',
  'asset:list',
  'asset:listAll',
  'asset:lookupName',
  'asset:listByAccount',
  'asset:listOrphaned',
  'asset:reassignOrphaned',
  'asset:totalMarketValue',
  'asset:update',
  'asset:updatePrice',
  'bank:importExcel',
  'bank:importParsed',
  'bank:suggestActions',
  'bank:listFormats',
  'bank:parseStatement',
  'bankFormat:create',
  'bankFormat:delete',
  'bankFormat:list',
  'bankFormat:update',
  'budget:create',
  'budget:delete',
  'budget:get',
  'budget:list',
  'budget:status',
  'budget:update',
  'category:create',
  'category:delete',
  'category:get',
  'category:list',
  'category:update',
  'currency:convert',
  'currency:get',
  'currency:getBase',
  'currency:list',
  'currency:rateHistory',
  'currency:updateRate',
  'customFormat:create',
  'customFormat:delete',
  'customFormat:list',
  'customFormat:update',
  'data:clearAll',
  'data:exportPackage',
  'data:importPackage',
  'data:confirmImport',
  'data:exportAll',
  'data:importAll',
  'data:refreshAll',
  'data:refreshPrices',
  'data:refreshRates',
  'export:dailyTrades',
  'export:toExcel',
  'fixedDeposit:create',
  'fixedDeposit:delete',
  'fixedDeposit:listByAccount',
  'fixedDeposit:update',
  'fixedDeposit:settle',
  'fixedDeposit:deleteWithMode',
  'fixedDeposit:findMatchingTx',
  'insurance:createPolicy',
  'insurance:deletePolicy',
  'insurance:getDuePolicies',
  'insurance:getPolicy',
  'insurance:listPayments',
  'insurance:listPolicies',
  'insurance:payPremium',
  'insurance:totalCashValue',
  'insurance:updatePolicy',
  'investmentAccount:addCash',
  'investmentAccount:adjustCash',
  'investmentAccount:cashFlows',
  'investmentAccount:allSummary',
  'investmentAccount:create',
  'investmentAccount:dailyStats',
  'investmentAccount:delete',
  'investmentAccount:get',
  'investmentAccount:holdings',
  'investmentAccount:list',
  'investmentAccount:summary',
  'investmentAccount:update',
  'investmentAccount:withdrawCash',
  'ledger:create',
  'ledger:delete',
  'ledger:get',
  'ledger:list',
  'ledger:monthlySummary',
  'ledger:update',
  'netWorth:history',
  'netWorth:record',
  'report:assetPerformance',
  'report:categoryBreakdown',
  'report:dailyTrades',
  'report:monthlyTrend',
  'report:realizedPnl',
  'report:recentSellPnl',
  'report:yearlyStats',
  'settings:getAiConfig',
  'settings:getAppName',
  'settings:getUserDataPath',
  'settings:openUserDataDir',
  'settings:saveAiConfig',
  'settings:setAppName',
  'settings:testAiConnection',
  'socialObligation:create',
  'socialObligation:delete',
  'socialObligation:list',
  'socialObligation:update',
  'trade:importExcel',
  'trade:importParsed',
  'trade:listBrokerFormats',
  'trade:parseStatement',
  'trade:record',
  'transaction:create',
  'transaction:delete',
  'transaction:get',
  'transaction:list',
  'transaction:listByAccount',
  'transaction:todayList',
  'transaction:update',
  'update:check',
  'update:download',
  'update:getVersion',
  'update:install',
  'wallet:getSystemWallets',
  'wallet:importBills',
]);

electron.contextBridge.exposeInMainWorld('electronAPI', {
  // Ping test
  ping: () => electron.ipcRenderer.invoke('app:ping'),

  // Generic invoke helper (channels filtered by allowlist above)
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      console.error(`[preload] 已拦截未授权 IPC 频道: ${channel}`);
      return Promise.reject(new Error(`IPC 频道不在白名单中: ${channel}`));
    }
    return electron.ipcRenderer.invoke(channel, ...args);
  },

  // ── Update events (main → renderer) ──
  onUpdateStatus: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('update:status', (_event, data) => callback(data));
  },
  removeUpdateStatusListener: () => {
    electron.ipcRenderer.removeAllListeners('update:status');
  },

  // ── Currency rate update events (main → renderer, v1.6.1) ──
  onCurrencyUpdated: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('currency:updated', (_event, data) => callback(data));
  },
  removeCurrencyUpdatedListener: () => {
    electron.ipcRenderer.removeAllListeners('currency:updated');
  },

  // ── Price update events (main → renderer, v1.8.0) ──
  onPricesUpdated: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('prices:updated', (_event, data) => callback(data));
  },
  removePricesUpdatedListener: () => {
    electron.ipcRenderer.removeAllListeners('prices:updated');
  },

  // ── AI stream events (main → renderer) ──
  onAiStreamChunk: (callback: (text: string) => void) => {
    electron.ipcRenderer.on('ai:streamChunk', (_event, text) => callback(text));
  },
  onAiStreamDone: (callback: (data: any) => void) => {
    electron.ipcRenderer.on('ai:streamDone', (_event, data) => callback(data));
  },
  removeAiStreamListeners: () => {
    electron.ipcRenderer.removeAllListeners('ai:streamChunk');
    electron.ipcRenderer.removeAllListeners('ai:streamDone');
  },
});
