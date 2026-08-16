/**
 * IPC 入参校验 schema（zod，无 electron 依赖，可单元测试）。
 * 渲染进程传错类型/缺字段时在 IPC 边界拒绝，防止脏数据落库。
 * 对象 schema 一律 .passthrough()：仅校验关键字段，多余字段放行（向前兼容）。
 * 与 src/main/ipc/validation.ts（handleValidated 包装器）配套。
 */
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const num = z.coerce.number().finite();
const money = z.coerce.number().finite();
const optStr = z.string().optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const accountData = z.object({
  name: z.string().min(1).max(100),
  type: z.string().max(30),
  asset_type: z.string().max(30).optional(),
  currency: z.string().max(10).optional(),
  balance: money.optional(),
  bank_name: z.string().max(100).nullish(),
  card_number: z.string().max(30).nullish(),
  display_alias: z.string().max(50).nullish(),
  parent_account_id: id.nullish(),
  sort_order: z.coerce.number().int().optional(),
}).passthrough();

const accountTxData = z.object({
  account_id: id,
  type: z.enum(['deposit', 'withdraw']),
  amount: z.coerce.number().positive(),
  currency: optStr,
  date: dateStr.optional(),
  notes: z.string().nullish(),
  // "不转入" 时渲染端提交空串（coerce → 0），此处归一化为 null；负数/非数字仍拒绝（v1.6.1）
  investment_account_id: z.coerce.number().int().nonnegative().nullish()
    .transform((v) => (v && v > 0 ? v : null)),
}).passthrough();

const ledgerData = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.coerce.number().positive(),
  currency: optStr,
  date: dateStr.optional(),
  category_id: id.nullish(),
  subcategory_id: id.nullish(),
  account_id: id.nullish(),
  description: z.string().optional(),
  tags: z.string().nullish(),
}).passthrough();

const tradeRecordData = z.object({
  investmentAccountId: id,
  type: z.enum(['buy', 'sell']),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().min(0),
  fee: z.coerce.number().min(0).optional(),
  currency: optStr,
  date: dateStr.optional(),
  market: z.string().max(30).optional(),
  assetType: z.string().max(30).optional(),
  notes: z.string().nullish(),
}).passthrough();

const assetData = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().max(20).optional(),
  type: z.string().max(30).optional(),
  market: z.string().max(30).optional(),
  currency: z.string().max(10).optional(),
  quantity: z.coerce.number().min(0).optional(),
  cost_price: z.coerce.number().min(0).optional(),
  current_price: z.coerce.number().min(0).optional(),
  account_id: id.nullish(),
  investment_account_id: id.nullish(),
  notes: z.string().nullish(),
}).passthrough();

const transactionData = z.object({
  asset_id: id,
  type: z.enum(['buy', 'sell', 'dividend', 'split']),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().min(0),
  fee: z.coerce.number().min(0).optional(),
  currency: optStr,
  date: dateStr.optional(),
  notes: z.string().nullish(),
}).passthrough();

const budgetData = z.object({
  name: z.string().min(1).max(100),
  amount: z.coerce.number().positive(),
  currency: optStr,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  notify_at: z.coerce.number().min(0).max(1).optional(),
}).passthrough();

const categoryData = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['income', 'expense']),
  parent_id: id.nullish(),
  icon: optStr,
  sort_order: z.coerce.number().int().optional(),
}).passthrough();

const fixedDepositData = z.object({
  account_id: id,
  amount: z.coerce.number().positive(),
  currency: optStr,
  interest_rate: z.coerce.number().min(0).optional(),
  start_date: z.string().min(1),
  maturity_date: z.string().min(1),
  notes: z.string().nullish(),
  deductMode: z.enum(['deduct', 'record_only']).optional(),
  deductAccountId: id.nullish(),
}).passthrough();

const fdSettleData = z.object({
  amount: z.coerce.number().positive(),
  toAccountId: id,
  currency: optStr,
  date: dateStr.optional(),
}).passthrough();

const insurancePolicyData = z.object({
  name: z.string().min(1).max(100),
  company: z.string().nullish(),
  policy_number: z.string().nullish(),
  type: z.string().max(30).optional(),
  annual_premium: z.coerce.number().min(0).optional(),
  premium_currency: optStr,
  cash_value: z.coerce.number().min(0).optional(),
  cash_value_currency: optStr,
  insured_person: z.string().nullish(),
  start_date: z.string().nullish(),
  premium_due_month: z.coerce.number().int().min(1).max(12).nullish(),
  premium_due_day: z.coerce.number().int().min(1).max(31).nullish(),
  account_id: id.nullish(),
  notes: z.string().nullish(),
  is_active: z.coerce.number().int().optional(),
}).passthrough();

const premiumData = z.object({
  policy_id: id,
  amount: z.coerce.number().positive(),
  currency: optStr,
  paid_date: z.string().min(1),
  account_id: id.nullish(),
  notes: z.string().nullish(),
}).passthrough();

const investmentAccountData = z.object({
  name: z.string().min(1).max(100),
  broker: z.string().nullish(),
  currency: optStr,
  account_number: z.string().nullish(),
  notes: z.string().nullish(),
  funding_account_id: id.nullish(),
  cash_balance: z.coerce.number().min(0).optional(),
}).passthrough();

const socialData = z.object({
  type: z.enum(['owe', 'owed']),
  person: z.string().min(1).max(100),
  item: z.string().min(1).max(200),
  status: z.enum(['pending', 'done']).optional(),
  notes: z.string().nullish(),
}).passthrough();

const formatData = z.object({
  name: z.string().min(1).max(100),
  keywords: z.string().min(1),
  column_mapping: z.string().min(1),
  has_header: z.coerce.number().int().min(0).max(1).optional(),
}).passthrough();

const recordItem = z.object({
  date: z.string().optional(),
  amount: z.coerce.number().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  currency: z.string().optional(),
}).passthrough();

const aiConfigData = z.object({
  provider: z.string().max(30),
  apiUrl: z.string().max(300),
  apiKey: z.string().max(200),
  model: z.string().max(100),
  includePortfolio: z.union([z.boolean(), z.coerce.number()]).optional(),
}).passthrough();

/** channel → 参数元组 schema（顺序与 handler 实参一致） */
const SCHEMAS: Record<string, z.ZodTypeAny> = {
  'account:create': z.tuple([accountData]),
  'account:update': z.tuple([id, accountData.partial()]),
  'account:delete': z.tuple([id]),
  'account:forceDelete': z.tuple([id]),
  'account:deleteImpact': z.tuple([id]),
  'account:createWithChildren': z.tuple([accountData]),
  'accountTransaction:create': z.tuple([accountTxData]),
  'accountTransaction:update': z.tuple([id, accountTxData.partial(), z.boolean().optional()]),
  'accountTransaction:delete': z.tuple([id]),
  'trade:record': z.tuple([tradeRecordData]),
  'asset:listAll': z.tuple([]),
  'asset:listOrphaned': z.tuple([]),
  'asset:reassignOrphaned': z.tuple([id, id]),
  'asset:create': z.tuple([assetData]),
  'asset:update': z.tuple([id, assetData.partial()]),
  'asset:updatePrice': z.tuple([id, z.coerce.number().positive()]),
  'asset:delete': z.tuple([id]),
  'transaction:create': z.tuple([transactionData]),
  'transaction:update': z.tuple([id, transactionData.partial()]),
  'transaction:delete': z.tuple([id]),
  'ledger:create': z.tuple([ledgerData]),
  'ledger:update': z.tuple([id, ledgerData.partial()]),
  'ledger:delete': z.tuple([id]),
  'category:create': z.tuple([categoryData]),
  'category:update': z.tuple([id, categoryData.partial()]),
  'category:delete': z.tuple([id]),
  'budget:create': z.tuple([budgetData]),
  'budget:update': z.tuple([id, budgetData.partial()]),
  'budget:delete': z.tuple([id]),
  'currency:updateRate': z.tuple([z.string().min(1), z.coerce.number().positive()]),
  'fixedDeposit:create': z.tuple([fixedDepositData]),
  'fixedDeposit:update': z.tuple([id, fixedDepositData.partial(), z.enum(['sync', 'record_only']).optional()]),
  'fixedDeposit:delete': z.tuple([id, z.boolean().optional()]),
  'fixedDeposit:settle': z.tuple([id, fdSettleData]),
  'insurance:createPolicy': z.tuple([insurancePolicyData]),
  'insurance:updatePolicy': z.tuple([id, insurancePolicyData.partial()]),
  'insurance:deletePolicy': z.tuple([id]),
  'insurance:payPremium': z.tuple([premiumData]),
  'investmentAccount:create': z.tuple([investmentAccountData]),
  'investmentAccount:update': z.tuple([id, investmentAccountData.partial()]),
  'investmentAccount:delete': z.tuple([id]),
  'investmentAccount:cashFlows': z.tuple([id, z.coerce.number().int().positive().optional()]),
  'investmentAccount:adjustCash': z.tuple([id, z.coerce.number().finite(), z.string().max(200).optional()]),
  'investmentAccount:addCash': z.tuple([id, z.coerce.number().positive()]),
  'investmentAccount:withdrawCash': z.tuple([id, z.coerce.number().positive()]),
  'socialObligation:create': z.tuple([socialData]),
  'socialObligation:update': z.tuple([id, socialData.partial()]),
  'socialObligation:delete': z.tuple([id]),
  'customFormat:create': z.tuple([formatData]),
  'customFormat:update': z.tuple([id, formatData.partial()]),
  'customFormat:delete': z.tuple([id]),
  'bankFormat:create': z.tuple([formatData]),
  'bankFormat:update': z.tuple([id, formatData.partial()]),
  'bankFormat:delete': z.tuple([id]),
  'settings:setAppName': z.tuple([z.string().min(1).max(50)]),
  'settings:saveAiConfig': z.tuple([aiConfigData]),
  'data:confirmImport': z.tuple([z.string().min(1)]),
  'archive:execute': z.tuple([z.array(z.string())]),
  'report:realizedPnl': z.tuple([z.coerce.number().int().positive()]),
  'trade:importParsed': z.tuple([z.array(recordItem), id]),
  'bank:importParsed': z.tuple([z.array(recordItem), id]),
  'wallet:importBills': z.tuple([id, z.array(recordItem)]),
};

export { SCHEMAS };

