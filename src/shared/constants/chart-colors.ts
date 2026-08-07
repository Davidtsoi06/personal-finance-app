/**
 * Shared chart color palette — single source of truth for all ECharts instances.
 */

/** Primary chart palette (blue-based, for pie/donut charts) */
export const CHART_PALETTE = ['#5B9BD5', '#3A7CC3', '#8BBDE4', '#FF9F43', '#54A0FF', '#5F27CD'];

/** Net worth trend chart colors */
export const NET_WORTH_COLORS = {
  netWorth: '#5B9BD5',
  cash: '#52C41A',
  investment: '#FF9F43',
} as const;

/** Income / expense bar colors */
export const INCOME_EXPENSE_COLORS = {
  income: '#52C41A',
  expense: '#FF4D4F',
} as const;

/** Category bar chart gradient */
export const CATEGORY_GRADIENT = ['#5B9BD5', '#8BBDE4'] as const;

/** Big category pie colors (matches dashboard asset distribution) */
export const BIG_CATEGORY_COLORS: Record<string, string> = {
  '💵 现金': '#52C41A',
  '🏦 银行卡': '#5B9BD5',
  '📱 在线支付': '#8BBDE4',
  '📈 投资': '#FF9F43',
};

/** Net worth area fill gradient stops */
export const NET_WORTH_AREA_GRADIENT = [
  { offset: 0, color: 'rgba(91,155,213,0.25)' },
  { offset: 1, color: 'rgba(91,155,213,0.02)' },
] as const;
