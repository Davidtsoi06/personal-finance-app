/**
 * Report / export data service — builds report datasets and export sheets
 * without touching Electron APIs (dialogs/xlsx are handled in report-ipc.ts).
 */
import { getDatabase } from '../database';
import { ASSET_SORT_SQL } from '../database/services/asset-service';
import { ASSET_TYPE_LABELS, MARKET_LABELS, TRADE_TYPE_LABELS } from '../../shared/constants/labels';

// ─── 每日交易报表 ────────────────────────────────────────────────

export interface DailyTradesSummary {
  totalCount: number;
  buyCount: number;
  sellCount: number;
  buyAmount: number;
  sellAmount: number;
  realizedPnl: number;
}

export interface DailyTradesResult {
  date: string;
  rows: any[];
  summary: DailyTradesSummary;
}

/** Trades for a single day, joined with asset name/code, plus summary stats. */
export function getDailyTrades(date: string): DailyTradesResult {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT t.id, t.date, t.type, t.quantity, t.price, t.fee, t.total_amount,
      t.currency, t.notes, t.created_at, a.name, a.code
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date = ?
    ORDER BY t.created_at ASC, t.id ASC
  `).all(date) as any[];

  const summary: DailyTradesSummary = {
    totalCount: rows.length, buyCount: 0, sellCount: 0,
    buyAmount: 0, sellAmount: 0, realizedPnl: 0,
  };
  for (const r of rows) {
    if (r.type === 'buy') { summary.buyCount++; summary.buyAmount += r.total_amount; }
    if (r.type === 'sell') {
      summary.sellCount++; summary.sellAmount += r.total_amount;
      // Realized P&L: net proceeds − (asset cost_price × sold quantity)
      const asset = db.prepare('SELECT cost_price FROM assets WHERE id = (SELECT asset_id FROM transactions WHERE id = ?)').get(r.id) as any;
      if (asset) summary.realizedPnl += r.total_amount - asset.cost_price * r.quantity;
    }
  }
  return { date, rows, summary };
}

// ─── 完整资产汇总（多 sheet 快照） ────────────────────────────────

export interface SheetData {
  name: string;
  rows: Record<string, any>[];
}

/** Current full asset snapshot across all 7 asset classes. */
export function buildAssetSummarySheets(): SheetData[] {
  const db = getDatabase();

  // 总览
  const bankCash = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM account_balances ab
    JOIN accounts a ON a.id = ab.account_id AND a.is_active = 1 AND a.asset_type = 'bank'
    LEFT JOIN currencies c ON ab.currency = c.code
  `).get() as any;
  const walletCash = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM account_balances ab
    JOIN accounts a ON a.id = ab.account_id AND a.is_active = 1 AND a.asset_type IN ('e_wallet', 'cash')
    LEFT JOIN currencies c ON ab.currency = c.code
  `).get() as any;
  const brokerRows = db.prepare(`
    SELECT COALESCE(SUM(a.market_value * COALESCE(c.rate_to_base, 1)), 0) as holdings,
      COALESCE((SELECT SUM(ia2.cash_balance * COALESCE(cc.rate_to_base, 1))
        FROM investment_accounts ia2
        LEFT JOIN currencies cc ON cc.code = ia2.currency), 0) as cash
    FROM assets a
    JOIN investment_accounts ia ON a.investment_account_id = ia.id
    LEFT JOIN currencies c ON a.currency = c.code
  `).get() as any;
  const fdRow = db.prepare(`
    SELECT COALESCE(SUM(fd.amount * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM fixed_deposits fd
    JOIN accounts a ON a.id = fd.account_id AND a.is_active = 1
    LEFT JOIN currencies c ON fd.currency = c.code
  `).get() as any;
  const insRow = db.prepare(`
    SELECT COALESCE(SUM(cash_value * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM insurance_policies p
    LEFT JOIN currencies c ON p.cash_value_currency = c.code
    WHERE p.is_active = 1
  `).get() as any;

  const bankTotal = bankCash.total || 0;
  const walletTotal = walletCash.total || 0;
  const brokerHoldings = brokerRows?.holdings || 0;
  const brokerCash = brokerRows?.cash || 0;
  const fdTotal = fdRow.total || 0;
  const insTotal = insRow.total || 0;
  const grandTotal = bankTotal + walletTotal + brokerHoldings + brokerCash + fdTotal + insTotal;

  const overview = [
    { category: '银行账户', amount_cny: bankTotal },
    { category: '电子钱包与现金', amount_cny: walletTotal },
    { category: '券商持仓市值', amount_cny: brokerHoldings },
    { category: '券商现金余额', amount_cny: brokerCash },
    { category: '定期存款', amount_cny: fdTotal },
    { category: '保险现金价值', amount_cny: insTotal },
    { category: '总计', amount_cny: grandTotal },
  ];

  // 银行账户
  const banks = db.prepare(`
    SELECT a.name, a.display_alias, a.bank_name, a.card_number,
      ab.currency, ab.balance, ab.balance * COALESCE(c.rate_to_base, 1) as balance_cny
    FROM accounts a
    JOIN account_balances ab ON ab.account_id = a.id
    LEFT JOIN currencies c ON ab.currency = c.code
    WHERE a.asset_type = 'bank' AND a.is_active = 1
    ORDER BY a.bank_name, a.id, ab.currency
  `).all() as any[];

  // 电子钱包与现金
  const wallets = db.prepare(`
    SELECT a.name, a.asset_type, ab.currency, ab.balance,
      ab.balance * COALESCE(c.rate_to_base, 1) as balance_cny
    FROM accounts a
    JOIN account_balances ab ON ab.account_id = a.id
    LEFT JOIN currencies c ON ab.currency = c.code
    WHERE a.asset_type IN ('e_wallet', 'cash') AND a.is_active = 1
    ORDER BY a.asset_type, a.sort_order, a.id, ab.currency
  `).all() as any[];

  // 券商账户
  const brokers = db.prepare(`
    SELECT ia.name, ia.broker, ia.currency, ia.account_number,
      COALESCE(SUM(a.market_value), 0) as holdings_value,
      ia.cash_balance,
      COALESCE(SUM(a.market_value), 0) + ia.cash_balance as total_value
    FROM investment_accounts ia
    LEFT JOIN assets a ON a.investment_account_id = ia.id
    GROUP BY ia.id
    ORDER BY ia.id
  `).all() as any[];

  // 投资持仓（按新排序）
  const holdings = db.prepare(`
    SELECT name, code, type, market, currency,
      quantity, cost_price, current_price, market_value, total_cost,
      profit_loss, profit_loss_pct, notes
    FROM assets
    WHERE quantity > 0
    ORDER BY ${ASSET_SORT_SQL}
  `).all() as any[];

  // 定期存款
  const fixedDeposits = db.prepare(`
    SELECT a.name as account_name, fd.amount, fd.currency, fd.interest_rate,
      fd.start_date, fd.maturity_date, fd.notes
    FROM fixed_deposits fd
    JOIN accounts a ON fd.account_id = a.id
    WHERE a.is_active = 1
    ORDER BY fd.maturity_date, fd.id
  `).all() as any[];

  // 保险
  const insurance = db.prepare(`
    SELECT name, company, type, annual_premium, premium_currency,
      cash_value, cash_value_currency, start_date, insured_person
    FROM insurance_policies
    WHERE is_active = 1
    ORDER BY id
  `).all() as any[];

  return [
    { name: '总览', rows: transformRows(overview, H.overview, 'overview') },
    { name: '银行账户', rows: transformRows(banks, H.banks, 'overview') },
    { name: '电子钱包', rows: transformRows(wallets, H.wallets, 'overview') },
    { name: '券商账户', rows: transformRows(brokers, H.brokers, 'overview') },
    { name: '投资持仓', rows: transformRows(holdings, H.holdings, 'assets') },
    { name: '定期存款', rows: transformRows(fixedDeposits, H.fixedDeposits, 'overview') },
    { name: '保险', rows: transformRows(insurance, H.insurance, 'overview') },
  ];
}

// ─── 导出转换与表头 ──────────────────────────────────────────────

export type ExportHeader = { key: string; label: string };

export function transformRows(
  rows: any[], headers: ExportHeader[], ctx: 'assets' | 'trades' | 'ledgers' | 'overview'
): Record<string, any>[] {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const h of headers) {
      let value = row[h.key];
      if (h.key === 'type') {
        if (ctx === 'trades') value = TRADE_TYPE_LABELS[value as string] || value;
        else if (ctx === 'ledgers') value = value === 'income' ? '收入' : value === 'expense' ? '支出' : value;
        else if (ctx === 'assets') value = ASSET_TYPE_LABELS[value as string] || value;
        else if (ctx === 'overview') value = value === 'life' ? '人寿' : value === 'health' ? '医疗'
          : value === 'annuity' ? '年金' : value === 'critical' ? '重疾'
          : value === 'accident' ? '意外' : value;
      }
      if (h.key === 'market') value = MARKET_LABELS[value as string] || value;
      if (h.key === 'asset_type') value = value === 'e_wallet' ? '电子钱包' : value === 'cash' ? '现金' : value;
      if (h.key === 'card_number' && value) value = `尾号${String(value).slice(-4)}`;
      out[h.label] = value !== undefined && value !== null ? value : '';
    }
    return out;
  });
}

const H: Record<string, ExportHeader[]> = {
  overview: [
    { key: 'category', label: '类别' },
    { key: 'amount_cny', label: '金额(CNY)' },
  ],
  banks: [
    { key: 'name', label: '账户名' }, { key: 'display_alias', label: '别名' },
    { key: 'bank_name', label: '银行' }, { key: 'card_number', label: '卡号' },
    { key: 'currency', label: '币种' }, { key: 'balance', label: '余额' },
    { key: 'balance_cny', label: 'CNY等值' },
  ],
  wallets: [
    { key: 'name', label: '名称' }, { key: 'asset_type', label: '类别' },
    { key: 'currency', label: '币种' }, { key: 'balance', label: '余额' },
    { key: 'balance_cny', label: 'CNY等值' },
  ],
  brokers: [
    { key: 'name', label: '账户名' }, { key: 'broker', label: '券商' },
    { key: 'currency', label: '币种' }, { key: 'account_number', label: '账号' },
    { key: 'holdings_value', label: '持仓市值' }, { key: 'cash_balance', label: '现金余额' },
    { key: 'total_value', label: '合计' },
  ],
  holdings: [
    { key: 'name', label: '名称' }, { key: 'code', label: '代码' },
    { key: 'type', label: '类型' }, { key: 'market', label: '市场' },
    { key: 'currency', label: '币种' }, { key: 'quantity', label: '持有数量' },
    { key: 'cost_price', label: '成本价' }, { key: 'current_price', label: '当前价' },
    { key: 'market_value', label: '市值' }, { key: 'total_cost', label: '总成本' },
    { key: 'profit_loss', label: '盈亏金额' }, { key: 'profit_loss_pct', label: '收益率(%)' },
    { key: 'notes', label: '备注' },
  ],
  fixedDeposits: [
    { key: 'account_name', label: '关联账户' }, { key: 'amount', label: '本金' },
    { key: 'currency', label: '币种' }, { key: 'interest_rate', label: '年利率(%)' },
    { key: 'start_date', label: '起始日期' }, { key: 'maturity_date', label: '到期日期' },
    { key: 'notes', label: '备注' },
  ],
  insurance: [
    { key: 'name', label: '保单名称' }, { key: 'company', label: '保险公司' },
    { key: 'type', label: '险种' }, { key: 'annual_premium', label: '年保费' },
    { key: 'premium_currency', label: '保费币种' }, { key: 'cash_value', label: '现金价值' },
    { key: 'cash_value_currency', label: '价值币种' }, { key: 'start_date', label: '投保日期' },
    { key: 'insured_person', label: '被保险人' },
  ],
  trades: [
    { key: 'date', label: '日期' }, { key: 'name', label: '股票名称' },
    { key: 'code', label: '代码' }, { key: 'type', label: '买卖方向' },
    { key: 'quantity', label: '数量' }, { key: 'price', label: '成交价' },
    { key: 'fee', label: '手续费' }, { key: 'total_amount', label: '总金额' },
    { key: 'currency', label: '币种' }, { key: 'notes', label: '备注' },
  ],
  ledgers: [
    { key: 'date', label: '日期' }, { key: 'type', label: '类型' },
    { key: 'category', label: '分类' }, { key: 'amount', label: '金额' },
    { key: 'currency', label: '币种' }, { key: 'account_name', label: '账户' },
    { key: 'description', label: '描述' },
  ],
};

export function getExportHeaders(type: 'assets' | 'trades' | 'ledgers'): ExportHeader[] {
  if (type === 'assets') return H.holdings;
  if (type === 'trades') return H.trades;
  return H.ledgers;
}
