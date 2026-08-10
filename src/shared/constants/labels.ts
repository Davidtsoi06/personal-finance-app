/**
 * Shared label maps — single source of truth for display labels.
 * Import from this file instead of defining inline maps in each page/IPC handler.
 */

/** Account type → display label (with emoji) */
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: '💵 现金',
  bank_card: '🏦 银行卡',
  credit_card: '💳 信用卡',
  online_pay: '📱 在线支付',
};

/** Account asset_type (asset class) → display label */
export const ACCOUNT_ASSET_TYPE_LABELS: Record<string, string> = {
  bank: '🏦 银行',
  cash: '💵 现金',
  insurance: '🛡️ 保险',
  investment: '📈 投资',
  custom: '✏️ 自定义',
};

/** Asset type → display label */
export const ASSET_TYPE_LABELS: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  etf: 'ETF',
  gold: '黄金',
  crypto: '加密货币',
  fixed_deposit: '定期存款',
};

/** Market → display label */
export const MARKET_LABELS: Record<string, string> = {
  a_stock: 'A股',
  hk_stock: '港股',
  us_stock: '美股',
  other: '其他',
};

/** Trade / transaction type → display label */
export const TRADE_TYPE_LABELS: Record<string, string> = {
  buy: '买入',
  sell: '卖出',
  split: '分拆',
  deposit: '存入',
  withdraw: '取出',
};

/** Big category labels for dashboard asset distribution pie chart */
export const BIG_CATEGORY_LABEL: Record<string, string> = {
  cash: '💵 现金',
  bank_card: '🏦 银行卡',
  online_pay: '📱 在线支付',
};

export const BIG_CATEGORY_ORDER = ['💵 现金', '🏦 银行卡', '📱 在线支付', '📈 投资'] as const;
