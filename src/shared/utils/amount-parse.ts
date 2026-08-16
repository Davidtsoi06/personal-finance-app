/**
 * amount-parse — 日结单/账单金额解析（v1.7.1）。
 * 支持：千分位逗号（1,234.56）、括号负数（(100.00)）、货币符号（¥/$/€/£）、空格。
 * 解析失败返回 null（由调用方决定跳过或报错），绝不静默返回 NaN。
 */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
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