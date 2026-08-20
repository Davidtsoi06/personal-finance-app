/**
 * Investment account service — brokerage accounts that hold assets.
 */
import { getDatabase } from '../index';
import { recordCashFlow } from './investment-cash-flow-service';
import type { TransactionRow } from './transaction-service';
import { ASSET_SORT_SQL } from './asset-service';

export interface InvestmentAccountRow {
  id: number;
  name: string;
  broker: string | null;
  currency: string;
  account_number: string | null;
  funding_account_id: number | null;
  cash_balance: number;
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
  funding_account_id?: number;
  cash_balance?: number;
  notes?: string;
}): InvestmentAccountRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO investment_accounts (name, broker, currency, account_number, funding_account_id, cash_balance, notes)
    VALUES (@name, @broker, @currency, @account_number, @funding_account_id, @cash_balance, @notes)
  `);
  const result = stmt.run({
    name: data.name,
    broker: data.broker || null,
    currency: data.currency || 'CNY',
    account_number: data.account_number || null,
    funding_account_id: data.funding_account_id || null,
    cash_balance: data.cash_balance || 0,
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
    UPDATE investment_accounts SET name=?, broker=?, currency=?, account_number=?, funding_account_id=?, cash_balance=?, notes=?, updated_at=?
    WHERE id=?
  `).run(merged.name, merged.broker, merged.currency, merged.account_number, merged.funding_account_id, merged.cash_balance ?? 0, merged.notes, merged.updated_at, id);
  return getInvestmentAccount(id);
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export function deleteInvestmentAccount(id: number): DeleteResult {
  const db = getDatabase();
  const existing = getInvestmentAccount(id);
  if (!existing) return { success: false, error: '投资账户不存在' };

  // 级联删除：持仓/交易/价格历史/现金流一并清理（v1.6.0 起不再产生孤儿持仓）
  const deleteAll = db.transaction(() => {
    // 现金流（引用账户与持仓，先删）
    db.prepare('DELETE FROM investment_cash_flows WHERE investment_account_id = ?').run(id);

    // 持仓相关：交易与价格历史先删（外键引用 assets）
    const assetIds = db.prepare('SELECT id FROM assets WHERE investment_account_id = ?').all(id) as { id: number }[];
    for (const a of assetIds) {
      db.prepare('DELETE FROM transactions WHERE asset_id = ?').run(a.id);
      db.prepare('DELETE FROM asset_prices WHERE asset_id = ?').run(a.id);
    }
    db.prepare('DELETE FROM assets WHERE investment_account_id = ?').run(id);

    const result = db.prepare('DELETE FROM investment_accounts WHERE id = ?').run(id);
    return result.changes;
  });

  try {
    const changes = deleteAll();
    return { success: changes > 0, error: changes > 0 ? undefined : '删除失败' };
  } catch (err: any) {
    return { success: false, error: err.message || '删除失败' };
  }
}

/** Get assets belonging to an investment account (sorted: 港股→A股→…, code ASC). */
export function getAccountHoldings(investmentAccountId: number) {
  const db = getDatabase();
  // v1.10.2：持仓明细只显示现有持仓（数量为 0 的股票不再显示）
  return db.prepare(`
    SELECT * FROM assets WHERE investment_account_id = ? AND quantity > 0
    ORDER BY ${ASSET_SORT_SQL}
  `).all(investmentAccountId);
}

/** Daily trade stats — buy/sell counts and realized P&L for today. */
export function getDailyTradeStats(): {
  buyCount: number;
  sellCount: number;
  realizedPnl: number;
  currency: string;
} {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  const buyRow = db.prepare(
    "SELECT COUNT(*) as count FROM transactions WHERE type = 'buy' AND date = ?"
  ).get(today) as { count: number };

  const sells = db.prepare(`
    SELECT t.*, a.cost_price, COALESCE(c.rate_to_base, 1) as rate_to_cny
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    LEFT JOIN currencies c ON a.currency = c.code
    WHERE t.type = 'sell' AND t.date = ?
  `).all(today) as (TransactionRow & { cost_price: number; rate_to_cny: number })[];

  // Realized P&L（CNY 口径）：(卖出净额 − 成本基数) × 持仓币种汇率
  let realizedPnl = 0;
  for (const s of sells) {
    realizedPnl += (s.total_amount - s.cost_price * s.quantity) * s.rate_to_cny;
  }

  return {
    buyCount: buyRow.count,
    sellCount: sells.length,
    realizedPnl,
    currency: 'CNY',
  };
}

/** Get summary stats for an investment account (holdings + cash). */
export function getAccountSummary(id: number) {
  const db = getDatabase();
  // 市值/盈亏按持仓币种换算 CNY（修正混币口径）；现金按账户币种换算
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN a.quantity > 0 THEN 1 ELSE 0 END) as asset_count, -- v1.10.2：只计现有持仓
      COALESCE(SUM(a.market_value), 0) as total_market_value,
      COALESCE(SUM(a.profit_loss), 0) as total_profit_loss,
      COALESCE(SUM(a.market_value * COALESCE(c.rate_to_base, 1)), 0) as total_market_value_cny,
      COALESCE(SUM(a.profit_loss * COALESCE(c.rate_to_base, 1)), 0) as total_profit_loss_cny,
      (SELECT cash_balance FROM investment_accounts WHERE id = ?) as cash_balance,
      (SELECT COALESCE(c2.rate_to_base, 1) FROM investment_accounts ia
         LEFT JOIN currencies c2 ON ia.currency = c2.code WHERE ia.id = ?) as account_rate
    FROM assets a
    LEFT JOIN currencies c ON a.currency = c.code
    WHERE a.investment_account_id = ?
  `).get(id, id, id) as any;
  const cashBalance = row?.cash_balance || 0;
  const accountRate = row?.account_rate || 1;
  const marketValueCny = row?.total_market_value_cny || 0;
  const profitLossCny = row?.total_profit_loss_cny || 0;
  const cashBalanceCny = cashBalance * accountRate;
  return {
    assetCount: row?.asset_count || 0,
    totalMarketValue: row?.total_market_value || 0,
    totalProfitLoss: row?.total_profit_loss || 0,
    cashBalance,
    /** Holdings market value + cash balance — the real total. */
    totalValue: (row?.total_market_value || 0) + cashBalance,
    /** CNY 口径（v1.5.6，跨币种汇总统一用这组字段） */
    totalMarketValueCny: marketValueCny,
    totalProfitLossCny: profitLossCny,
    cashBalanceCny,
    totalValueCny: marketValueCny + cashBalanceCny,
  };
}

/** 存入现金（记 deposit 流水，余额由流水派生）。 */
export function addCashBalance(investmentAccountId: number, amount: number): void {
  const db = getDatabase();
  const acc = db.prepare('SELECT currency FROM investment_accounts WHERE id = ?').get(investmentAccountId) as any;
  recordCashFlow({
    investmentAccountId, type: 'deposit', amount,
    currency: acc?.currency || 'CNY', notes: '存入现金',
  });
}

/** 取出现金（记 withdraw 流水；允许余额为负以暴露差异，对账界面红色提示）。 */
export function withdrawCashBalance(investmentAccountId: number, amount: number): void {
  const db = getDatabase();
  const acc = db.prepare('SELECT currency FROM investment_accounts WHERE id = ?').get(investmentAccountId) as any;
  recordCashFlow({
    investmentAccountId, type: 'withdraw', amount: -amount,
    currency: acc?.currency || 'CNY', notes: '取出现金',
  });
}
