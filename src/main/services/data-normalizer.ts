/**
 * Data normalizer — centralized normalization for all data entering the database.
 * Every write path MUST normalize its data through these functions before INSERT/UPDATE.
 *
 * Usage:
 *   import { normalizeDate, normalizeCurrency, normalizeCode, normalizeTradeType, normalizeString } from './data-normalizer';
 */

// ── Currency name → ISO code ──
const CURRENCY_NORMALIZE_MAP: Record<string, string> = {
  '人民币': 'CNY', 'RMB': 'CNY',
  '港元': 'HKD', '港币': 'HKD',
  '美元': 'USD', '美金': 'USD',
};

/**
 * Normalize a date string to YYYY-MM-DD format.
 * Accepts: YYYYMMDD, YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD
 * Falls back to today if no valid date provided.
 */
export function normalizeDate(raw: string | undefined | null): string {
  if (!raw) return today();

  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // YYYYMMDD → YYYY-MM-DD
  if (trimmed.length === 8 && /^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }

  // YYYY/MM/DD or YYYY/M/D → YYYY-MM-DD
  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY.MM.DD → YYYY-MM-DD
  const dotMatch = trimmed.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dotMatch) {
    const [, y, m, d] = dotMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Unrecognized format — return as-is
  return trimmed;
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
  return CURRENCY_NORMALIZE_MAP[upper] || upper;
}

/**
 * Normalize a security code: trim + uppercase.
 */
export function normalizeCode(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.trim().toUpperCase();
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
