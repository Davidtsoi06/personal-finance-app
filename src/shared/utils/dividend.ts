/**
 * dividend — 股息/分红（v1.10.21）纯函数与关键词。
 * 口径：税前（gross）= 每股派息 × 股数（或直接录入税前总额）；预扣税（tax）；实收（net）= 税前 − 税。
 * 跨账户合并统计与已实现盈亏同口径：按「代码 + 币种」合并（mergeKey）。
 */
import { roundMoney } from './money';
import { mergeKey } from './investment';

/** 券商/银行日结单里的股息类关键词（命中且无数量/价格的行识别为分红） */
export const DIVIDEND_KEYWORDS: string[] = [
  '股息', '股利', '派息', '派發', '派发', '红利', '紅利', '分红', '分紅', '紅股', '红股',
  '利息收入', '存款利息', 'DIVIDEND', 'DIVIDENDS', 'DIV', 'INTEREST', 'DISTRIBUTION',
];

/** 摘要是否像股息/分红（大小写不敏感） */
export function isDividendText(text: string | null | undefined): boolean {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return false;
  return DIVIDEND_KEYWORDS.some((k) => t.includes(k.toUpperCase()));
}

/** 股息金额计算：支持「每股派息 × 股数」或直接录入税前总额，再扣预扣税 */
export function computeDividendAmounts(input: {
  perShare?: number | null;
  quantity?: number | null;
  grossAmount?: number | null;
  taxRatePct?: number | null;
  taxAmount?: number | null;
}): { gross: number; tax: number; net: number } {
  const perShare = Number(input.perShare) || 0;
  const quantity = Number(input.quantity) || 0;
  const manualGross = input.grossAmount === null || input.grossAmount === undefined ? null : Number(input.grossAmount);
  let gross = manualGross !== null && !Number.isNaN(manualGross)
    ? manualGross
    : perShare * quantity;
  if (!Number.isFinite(gross) || gross < 0) gross = 0;
  gross = roundMoney(gross);

  const rate = Number(input.taxRatePct) || 0;
  const manualTax = input.taxAmount === null || input.taxAmount === undefined ? null : Number(input.taxAmount);
  let tax = manualTax !== null && !Number.isNaN(manualTax) ? manualTax : (rate > 0 ? (gross * rate) / 100 : 0);
  if (!Number.isFinite(tax) || tax < 0) tax = 0;
  tax = Math.min(roundMoney(tax), gross);

  return { gross, tax, net: roundMoney(gross - tax) };
}

export interface DividendIncomeRow {
  assetId: number;
  code: string;
  name: string;
  currency: string;
  accountId?: number | null;
  accountName?: string | null;
  /** 预扣税（transactions.fee 存税） */
  fee: number;
  /** 实收（transactions.total_amount 存税后净额） */
  netAmount: number;
  date: string;
  notes?: string | null;
}

export interface DividendAccountRow {
  assetId: number;
  accountId: number | null;
  accountName: string;
  gross: number;
  tax: number;
  net: number;
  count: number;
}

export interface DividendIncomeEntry {
  key: string;
  code: string;
  name: string;
  currency: string;
  gross: number;
  tax: number;
  net: number;
  count: number;
  accountCount: number;
  accounts: DividendAccountRow[];
}

export interface DividendIncomeResult {
  gross: number;
  tax: number;
  net: number;
  count: number;
  byAsset: DividendIncomeEntry[];
}

/** 按「代码 + 币种」跨账户合并的股息收入汇总 */
export function buildDividendIncome(rows: DividendIncomeRow[]): DividendIncomeResult {
  const groups = new Map<string, DividendIncomeEntry>();
  let gross = 0;
  let tax = 0;
  let net = 0;
  let count = 0;

  for (const r of rows) {
    const key = mergeKey(r.code, r.currency);
    const rowTax = roundMoney(Number(r.fee) || 0);
    const rowNet = roundMoney(Number(r.netAmount) || 0);
    const rowGross = roundMoney(rowNet + rowTax);

    let entry = groups.get(key);
    if (!entry) {
      entry = { key, code: r.code, name: r.name, currency: r.currency, gross: 0, tax: 0, net: 0, count: 0, accountCount: 0, accounts: [] };
      groups.set(key, entry);
    }
    entry.gross = roundMoney(entry.gross + rowGross);
    entry.tax = roundMoney(entry.tax + rowTax);
    entry.net = roundMoney(entry.net + rowNet);
    entry.count += 1;
    entry.name = r.name || entry.name;

    const accName = r.accountName || '未指定账户';
    let acc = entry.accounts.find((a) => a.assetId === r.assetId);
    if (!acc) {
      acc = { assetId: r.assetId, accountId: r.accountId ?? null, accountName: accName, gross: 0, tax: 0, net: 0, count: 0 };
      entry.accounts.push(acc);
    }
    acc.gross = roundMoney(acc.gross + rowGross);
    acc.tax = roundMoney(acc.tax + rowTax);
    acc.net = roundMoney(acc.net + rowNet);
    acc.count += 1;

    gross = roundMoney(gross + rowGross);
    tax = roundMoney(tax + rowTax);
    net = roundMoney(net + rowNet);
    count += 1;
  }

  const byAsset = [...groups.values()].map((e) => ({ ...e, accountCount: e.accounts.length }));
  byAsset.sort((a, b) => b.net - a.net);
  return { gross, tax, net, count, byAsset };
}
