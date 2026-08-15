/**
 * market — 股票代码智能市场检测（从 price-fetcher 提取，供复用与测试）。
 * 6 位纯数字 → A 股；1-5 位数字 → 港股；1-5 位字母 → 美股；其他 → other。
 */
export function detectMarket(code: string, explicitMarket?: string): string {
  // 显式指定的非模糊市场优先
  if (explicitMarket && explicitMarket !== 'other') return explicitMarket;

  const trimmed = code.trim();
  // 交易所后缀：600519.SH / 0700.HK / AAPL.US 等
  const suffixMatch = trimmed.match(/^([A-Za-z0-9]+)\.(SH|SZ|HK|US|SS)$/i);
  const cleaned = suffixMatch ? suffixMatch[1].toUpperCase() : trimmed.replace(/[^A-Za-z0-9]/g, '');

  // 6 位纯数字 → A 股
  if (/^\d{6}$/.test(cleaned)) {
    return 'a_stock';
  }

  // 1-5 位数字 → 港股
  if (/^\d{1,5}$/.test(cleaned)) {
    return 'hk_stock';
  }

  // 1-5 位字母 → 美股
  if (/^[A-Za-z]{1,5}$/.test(cleaned)) {
    return 'us_stock';
  }

  return explicitMarket || 'other';
}
