/**
 * Investment account service — brokerage accounts that hold assets.
 */
import { getDatabase } from '../index';

export interface InvestmentAccountRow {
  id: number;
  name: string;
  broker: string | null;
  currency: string;
  account_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listInvestmentAccounts(): InvestmentAccountRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM investment_accounts ORDER BY id').all() as InvestmentAccountRow[];
}

export function getInvestmentAccount(id: number): InvestmentAccountRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(id) as InvestmentAccountRow | undefined;
}

export function createInvestmentAccount(data: {
  name: string;
  broker?: string;
  currency?: string;
  account_number?: string;
  notes?: string;
}): InvestmentAccountRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO investment_accounts (name, broker, currency, account_number, notes)
    VALUES (@name, @broker, @currency, @account_number, @notes)
  `);
  const result = stmt.run({
    name: data.name,
    broker: data.broker || null,
    currency: data.currency || 'CNY',
    account_number: data.account_number || null,
    notes: data.notes || null,
  });
  return getInvestmentAccount(result.lastInsertRowid as number) as InvestmentAccountRow;
}

export function updateInvestmentAccount(id: number, data: Partial<InvestmentAccountRow>): InvestmentAccountRow | undefined {
  const db = getDatabase();
  const existing = getInvestmentAccount(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE investment_accounts SET name=?, broker=?, currency=?, account_number=?, notes=?, updated_at=?
    WHERE id=?
  `).run(merged.name, merged.broker, merged.currency, merged.account_number, merged.notes, merged.updated_at, id);
  return getInvestmentAccount(id);
}

export function deleteInvestmentAccount(id: number): boolean {
  const db = getDatabase();
  // Unlink assets
  db.prepare('UPDATE assets SET investment_account_id = NULL WHERE investment_account_id = ?').run(id);
  const result = db.prepare('DELETE FROM investment_accounts WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Get assets belonging to an investment account */
export function getAccountHoldings(investmentAccountId: number) {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM assets WHERE investment_account_id = ? ORDER BY market_value DESC'
  ).all(investmentAccountId);
}

/** Get summary stats for an investment account */
export function getAccountSummary(id: number) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) as asset_count,
      COALESCE(SUM(market_value), 0) as total_market_value,
      COALESCE(SUM(profit_loss), 0) as total_profit_loss
    FROM assets WHERE investment_account_id = ?
  `).get(id) as any;
  return {
    assetCount: row.asset_count,
    totalMarketValue: row.total_market_value,
    totalProfitLoss: row.total_profit_loss,
  };
}
