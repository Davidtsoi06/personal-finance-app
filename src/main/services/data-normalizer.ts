/**
 * Data normalizer — centralized normalization for all data entering the database.
 * Every write path MUST normalize its data through these functions before INSERT/UPDATE.
 *
 * Usage:
 *   import { normalizeDate, normalizeCurrency, normalizeCode, normalizeTradeType, normalizeString } from './data-normalizer';
 */

// ── Currency name → ISO code ──
// v1.10.9：扩展银行结单常见写法（人民币元/元/货币符号/主要外币中文名）
const CURRENCY_NORMALIZE_MAP: Record<string, string> = {
  '人民币': 'CNY', '人民币元': 'CNY', '元': 'CNY', 'RMB': 'CNY', '¥': 'CNY', '￥': 'CNY',
  '港元': 'HKD', '港币': 'HKD', '港币元': 'HKD', 'HK$': 'HKD',
  '美元': 'USD', '美金': 'USD', 'US$': 'USD', '$': 'USD',
  '欧元': 'EUR', '英镑': 'GBP', '日元': 'JPY', '日圆': 'JPY',
  '新加坡元': 'SGD', '澳元': 'AUD', '澳大利亚元': 'AUD',
  '加元': 'CAD', '加拿大元': 'CAD', '新台币': 'TWD',
  '韩元': 'KRW', '泰铢': 'THB', '瑞士法郎': 'CHF', '纽元': 'NZD', '新西兰元': 'NZD',
};

/**
 * Normalize a date string to YYYY-MM-DD format.
 * Accepts: YYYYMMDD, YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD,
 *   美式 M/D/YYYY（银行日结单常用，可带时间）, M/D/YY（2 位年）, Excel 日期序列号.
 * v1.10.3：直接支持 number（Excel 日期序列号）与 Date 对象（按 UTC 格式化）——
 *   Excel 里「日期格式」单元格经 xlsx 读取后是序列号数字（如 46251 = 2026-08-17），不再漏转。
 * Falls back to today if no valid date provided.
 */
export function normalizeDate(raw: string | number | Date | undefined | null): string {
  if (!raw) return today();

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return today();
    return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}-${String(raw.getUTCDate()).padStart(2, '0')}`;
  }

  const trimmed = typeof raw === 'number' ? String(raw) : raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // v1.10.6：YYYY-MM-DD 带时间（微信账单：2026-08-16 12:30:45）
  const withTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (withTime) return withTime[1];

  // YYYYMMDD → YYYY-MM-DD
  if (trimmed.length === 8 && /^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }

  // YYYY/MM/DD or YYYY/M/D → YYYY-MM-DD
  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    const valid = toValidDate(y, m, d);
    if (valid) return valid;
  }

  // YYYY.MM.DD → YYYY-MM-DD
  const dotMatch = trimmed.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dotMatch) {
    const [, y, m, d] = dotMatch;
    const valid = toValidDate(y, m, d);
    if (valid) return valid;
  }

  // 美式月/日/年：M/D/YYYY（可带时间，如 8/16/2026 或 8/16/2026 14:30:05）
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const valid = toValidDate(y, m, d);
    if (valid) {
      // v1.10.10：银行结单不可能有未来日期——美式结果晚于今天（如 11/08/2026 解析成 11月8日但今天才 8月）
      // → 回退日/月（DD/MM 歧义消解），与中文「X月Y日」同规则
      if (valid > today()) {
        const dayFirst = toValidDate(y, d, m);
        if (dayFirst && dayFirst <= today()) return dayFirst;
      }
      return valid;
    }
    // v1.10.1：月/日解析失败（如 18/08/2026）→ 回退日/月（银行 DD/MM/YYYY 常见）
    const dayFirst = toValidDate(y, d, m);
    if (dayFirst) return dayFirst;
  }

  // 美式月/日/年（2 位年）：M/D/YY → 2000+YY（>=70 视为 19YY）
  const usShortMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (usShortMatch) {
    const [, m, d, yy] = usShortMatch;
    const y = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const valid = toValidDate(y, m, d);
    if (valid) {
      // v1.10.10：2 位年歧义最大（11/8/26 美式=11月8日 vs 英式=8月11日）——晚于今天回退日/月
      if (valid > today()) {
        const dayFirst = toValidDate(y, d, m);
        if (dayFirst && dayFirst <= today()) return dayFirst;
      }
      return valid;
    }
    const dayFirst = toValidDate(y, d, m);
    if (dayFirst) return dayFirst;
  }

  // v1.10.1：中文日期——YYYY年M月D日 / M月D日 / D月M日（可带时间，如 10月8日 12:30）
  // 无年份默认今年；「X月Y日」歧义（部分银行按日/月渲染，如 10月8日=8月10日）：
  // 先按标准「月日」解析，若结果晚于今天则回退「日月」再验证
  const cnMatch = trimmed.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (cnMatch) {
    const [, yStr, a, b] = cnMatch;
    const todayDate = today();
    const year = yStr || todayDate.slice(0, 4);
    const candidates: string[] = [];
    const std = toValidDate(year, a, b); // 月= a, 日= b（标准中文）
    const flip = toValidDate(year, b, a); // 日= a, 月= b（日在前渲染）
    if (std) candidates.push(std);
    if (flip && flip !== std) candidates.push(flip);
    // 选择不晚于今天的结果；都合法时优先「月日」；都不合法则取最早（跨年回退）
    const past = candidates.filter((c) => c <= todayDate);
    if (past.length > 0) return past[0];
    if (candidates.length > 0) {
      candidates.sort();
      // 跨年：取最近的一个（排序后最接近今天的），否则取最早的
      return candidates[candidates.length - 1] <= todayDate ? candidates[candidates.length - 1] : candidates[0];
    }
  }

  // Excel 日期序列号（数字单元格转字符串，如 46080 → 2026-02-27；可带时间小数）
  const serialMatch = trimmed.match(/^(\d{5})(?:\.\d+)?$/);
  if (serialMatch) {
    const serial = parseInt(serialMatch[1], 10);
    if (serial >= 20000 && serial <= 80000) {
      const date = new Date((serial - 25569) * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }

  // Unrecognized format — return as-is
  return trimmed;
}

/** 组装并校验日期：月 1~12、日 1~31 且与构造结果一致；无效返回 null。 */
function toValidDate(y: string, m: string, d: string): string | null {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Normalize a currency string to ISO 4217 code (CNY, HKD, USD, etc.).
 * Maps Chinese names to codes. Uppercases the result.
 * @param raw    Raw currency string
 * @param fallback  Default if empty (default: 'CNY')
 */
export function normalizeCurrency(raw: string | undefined | null, fallback = 'CNY'): string {
  if (!raw) return fallback;
  const upper = raw.trim().toUpperCase();
  const direct = CURRENCY_NORMALIZE_MAP[upper];
  if (direct) return direct;
  // v1.10.9：尾部「元」剥离再匹配（人民币元→人民币、美元元→美元）
  if (upper.endsWith('元') && upper.length > 1) {
    const stripped = CURRENCY_NORMALIZE_MAP[upper.slice(0, -1)];
    if (stripped) return stripped;
  }
  return upper;
}

/**
 * Normalize a security code: trim + uppercase.
 * v1.10.9：美股市场后缀清理——AAPL.US / AAPL.NYSE / AAPL.NASDAQ → AAPL；
 *   BRK.B 等带点号的特殊代码保留（.B 不是已知市场后缀）。
 */
export function normalizeCode(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = raw.trim().toUpperCase();
  return trimmed.replace(/\.(US|NYSE|NASDAQ)$/, '');
}

/**
 * Normalize a trade direction / business type string.
 * Accepts Chinese, English, and mixed variants.
 * Returns 'other' for unrecognized values (instead of skipping).
 */
export function normalizeTradeType(raw: string | undefined | null): 'buy' | 'sell' | 'split' | 'other' {
  if (!raw) return 'other';
  const lower = raw.trim().toLowerCase();

  if (lower.includes('买') || lower === 'buy' || lower === 'b') return 'buy';
  if (lower.includes('卖') || lower === 'sell' || lower === 's') return 'sell';
  if (lower.includes('分拆') || lower.includes('拆分') || lower === 'split') return 'split';

  return 'other';
}

/**
 * Normalize a general-purpose string: trim, empty → ''.
 */
export function normalizeString(raw: string | undefined | null): string {
  return (raw || '').trim();
}

/** Return today's date as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
