/**
 * 推算手续费（v1.8.3）：日结单仅有「发生金额」（净额）而无「成交金额」时，
 * 由数量×价格推算成交金额，手续费 = ||发生金额| − 成交金额|（与买卖方向无关）。
 */
export function deriveTradeFee(quantity: number, price: number, netAmount: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(price) || !Number.isFinite(netAmount)) return 0;
  if (quantity <= 0 || price < 0) return 0;
  const gross = quantity * price;
  const fee = Math.abs(Math.abs(netAmount) - gross);
  return Math.round(fee * 100) / 100;
}

/**
 * amount-parse — 日结单/账单金额解析（v1.7.1）。
 * 支持：千分位逗号（1,234.56）、括号负数（(100.00)）、货币符号（¥/$/€/£）、空格。
 * 解析失败返回 null（由调用方决定跳过或报错），绝不静默返回 NaN。
 */
/**
 * v1.10.11：剥离 Excel/CSV 公式包裹——单元格或 CSV 字段可能以 = 开头并被引号包裹
 * （如 ='20260813'、="HKD"、=='2026-08-13'），清洗为实际内容 20260813 / HKD。
 */
export function stripFormulaWrapper(raw: unknown): string {
  let s = String(raw ?? '').trim();
  while (s.startsWith('=')) s = s.slice(1).trim();
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = stripFormulaWrapper(raw);
  if (!s) return null;

  // 括号负数：(100.00) → -100.00
  const paren = s.match(/^\((.*)\)$/);
  if (paren) s = '-' + paren[1];

  // 剥离货币符号、字母货币前缀（HK$/US$/RMB…）、千分位逗号与空格
  s = s.replace(/[A-Za-z¥￥$€£,\s]/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}