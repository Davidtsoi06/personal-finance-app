/**
 * Currency service — CRUD for currencies and exchange rates.
 */
import { getDatabase } from '../index';

export interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol: string;
  rate_to_base: number;
  is_base: number;
  updated_at: string;
}

export function listCurrencies(): CurrencyRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM currencies ORDER BY is_base DESC, code').all() as CurrencyRow[];
}

export function getBaseCurrency(): CurrencyRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM currencies WHERE is_base = 1').get() as CurrencyRow | undefined;
}

export function getCurrency(code: string): CurrencyRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM currencies WHERE code = ?').get(code) as CurrencyRow | undefined;
}

export function updateRate(code: string, rateToBase: number): void {
  const db = getDatabase();
  db.prepare("UPDATE currencies SET rate_to_base = ?, updated_at = datetime('now') WHERE code = ?")
    .run(rateToBase, code);

  // Record in history
  const base = getBaseCurrency();
  if (base) {
    db.prepare('INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (?, ?, ?)')
      .run(code, base.code, rateToBase);
  }
}

export function getRateHistory(code: string, limit?: number) {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM exchange_rates WHERE from_currency = ? ORDER BY date DESC LIMIT ?'
  ).all(code, limit || 30);
}

export function convertAmount(amount: number, from: string, to: string): number {
  const fromCurrency = getCurrency(from);
  const toCurrency = getCurrency(to);
  if (!fromCurrency || !toCurrency) return amount;

  // Convert to base first, then to target
  const baseAmount = amount * fromCurrency.rate_to_base;
  return baseAmount / toCurrency.rate_to_base;
}
