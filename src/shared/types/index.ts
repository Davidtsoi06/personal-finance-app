// ========================================
// 共享类型定义
// ========================================

/** 货币代码 */
export type CurrencyCode = 'CNY' | 'HKD' | 'USD' | 'EUR' | 'JPY' | 'GBP';

/** 账户类型 */
export type AccountType = 'cash' | 'bank_card' | 'credit_card' | 'online_pay';

/** 资产类型 */
export type AssetType = 'stock' | 'fund' | 'etf' | 'gold' | 'crypto' | 'fixed_deposit';

/** 交易类型 */
export type TransactionType = 'buy' | 'sell' | 'dividend' | 'split';

/** 市场 */
export type MarketType = 'a_stock' | 'hk_stock' | 'us_stock' | 'other';

/** 记账类型 */
export type LedgerType = 'income' | 'expense';

/** 借贷类型 */
export type BorrowType = 'borrow' | 'lend';

/** 账户 */
export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  balance: number;
  bank_name: string | null;
  card_number: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 资产持仓 */
export interface Asset {
  id: number;
  name: string;
  code: string;
  type: AssetType;
  market: MarketType;
  currency: CurrencyCode;
  quantity: number;
  cost_price: number;
  current_price: number;
  market_value: number;
  total_cost: number;
  profit_loss: number;
  profit_loss_pct: number;
  account_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** 投资交易 */
export interface Transaction {
  id: number;
  asset_id: number;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  total_amount: number;
  currency: CurrencyCode;
  date: string;
  notes: string | null;
  created_at: string;
}

/** 收支记账 */
export interface Ledger {
  id: number;
  type: LedgerType;
  amount: number;
  currency: CurrencyCode;
  category_id: number;
  subcategory_id: number | null;
  account_id: number | null;
  date: string;
  description: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

/** 分类 */
export interface Category {
  id: number;
  name: string;
  type: LedgerType;
  parent_id: number | null;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
}

/** 货币 */
export interface Currency {
  id: number;
  code: CurrencyCode;
  name: string;
  symbol: string;
  rate_to_base: number;
  is_base: boolean;
  updated_at: string;
}

/** 汇率历史 */
export interface ExchangeRate {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: number;
  date: string;
}
