/**
 * Report / export data service — builds report datasets and export sheets
 * without touching Electron APIs (dialogs/xlsx are handled in report-ipc.ts).
 */
import { getDatabase } from '../database';
import { ASSET_SORT_SQL } from '../database/services/asset-service';
import { ASSET_TYPE_LABELS, MARKET_LABELS, TRADE_TYPE_LABELS } from '../../shared/constants/labels';
import { roundMoney, roundPct } from '../../shared/utils/money';
import { addPosition, removePosition, type AssetState } from '../../shared/utils/investment';

/** 本地时区的 YYYY-MM-DD（toISOString 是 UTC，跨时区会错一天） */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── 每日交易报表 ────────────────────────────────────────────────

export interface DailyTradesSummary {
  totalCount: number;
  buyCount: number;
  sellCount: number;
  buyAmount: number;
  sellAmount: number;
  realizedPnl: number;
  /** v1.8.4：卖出但无成本价、盈亏未计入的笔数 */
  unknownPnlCount: number;
}

export interface DailyTradesResult {
  date: string;
  rows: any[];
  summary: DailyTradesSummary;
}

/** v1.8.4：买入加权平均成本（Σ净额 ÷ Σ数量）；无有效买入返回 null（纯函数，可单测） */
export function weightedAvgCost(buys: { total_amount: number; quantity: number }[]): number | null {
  let amt = 0;
  let qty = 0;
  for (const b of buys) {
    const a = Number(b.total_amount) || 0;
    const q = Number(b.quantity) || 0;
    if (q <= 0) continue;
    amt += a;
    qty += q;
  }
  if (qty <= 0) return null;
  const avg = amt / qty;
  return Number.isFinite(avg) ? Math.round(avg * 10000) / 10000 : null;
}

/**
 * Trades for a single day, joined with asset name/code, plus summary stats.
 * v1.10.0 成本基础改版（完整重放法，与迁移 v21 同口径）：
 *   - 每只资产按 (date, id) 顺序重放买卖：买入加仓（含费）、卖出按当时加权成本冲销；
 *     清仓后持仓归零，重新买入从新成本开始（修复「清仓后成本价残留」）；
 *   - 买入行成本价 = 该笔买入后的持仓加权成本（与卖出口径一致）；
 *   - 卖出行无持仓（无买入记录或已清仓）→ 成本价 null 显示 —，不再回退资产表旧值；
 *   - 零成本买入（total_amount=0，如送股/红股）标记 zero_cost，摊薄计算保留（财务正确）。
 */
export function getDailyTrades(date: string): DailyTradesResult {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT t.id, t.date, t.type, t.quantity, t.price, t.fee, t.total_amount,
      t.currency, t.notes, t.created_at, t.asset_id, a.name, a.code
    FROM transactions t
    JOIN assets a ON t.asset_id = a.id
    WHERE t.date = ?
    ORDER BY t.created_at ASC, t.id ASC
  `).all(date) as any[];

  // 当日(含)前全部买卖（按时间排序），供逐行推进重放
  const allTrades = db.prepare(`
    SELECT asset_id, type, quantity, total_amount, price, date, id FROM transactions
    WHERE type IN ('buy', 'sell') AND date <= ?
    ORDER BY date ASC, id ASC
  `).all(date) as { asset_id: number; type: string; quantity: number; total_amount: number; price: number; date: string; id: number }[];
  const tradesByAsset = new Map<number, typeof allTrades>();
  for (const t of allTrades) {
    const arr = tradesByAsset.get(t.asset_id) || [];
    arr.push(t);
    tradesByAsset.set(t.asset_id, arr);
  }
  const cursor = new Map<number, number>();
  const position = new Map<number, AssetState>();

  /** 推进到指定 (date, id)：inclusive=true 包含该笔自身（买入行取「买入后」状态） */
  const advanceTo = (assetId: number, rowDate: string, rowId: number, inclusive: boolean): AssetState => {
    const list = tradesByAsset.get(assetId) || [];
    let idx = cursor.get(assetId) || 0;
    let st = position.get(assetId) || { quantity: 0, totalCost: 0, costPrice: 0 };
    while (idx < list.length) {
      const t = list[idx];
      const before = t.date < rowDate || (t.date === rowDate && (inclusive ? t.id <= rowId : t.id < rowId));
      if (!before) break;
      if (t.type === 'buy') {
        st = addPosition(st, t.quantity, t.total_amount);
      } else if (t.type === 'sell') {
        const basis = st.costPrice > 0 ? st.costPrice * t.quantity : t.quantity * t.price;
        st = removePosition(st, t.quantity, basis);
      }
      idx++;
    }
    cursor.set(assetId, idx);
    position.set(assetId, st);
    return st;
  };

  const summary: DailyTradesSummary = {
    totalCount: rows.length, buyCount: 0, sellCount: 0,
    buyAmount: 0, sellAmount: 0, realizedPnl: 0, unknownPnlCount: 0,
  };
  for (const r of rows) {
    if (r.type === 'buy') {
      summary.buyCount++;
      summary.buyAmount += r.total_amount;
      r.realized_pnl = null;
      r.zero_cost = Number(r.total_amount) === 0 && Number(r.quantity) > 0;
      // 买入行成本价 = 该笔买入后的持仓加权成本（清仓后重新买入 → 新成本）
      const st = advanceTo(r.asset_id, r.date, r.id, true);
      r.cost_price = st.quantity > 0 && st.costPrice > 0
        ? Math.round(st.costPrice * 10000) / 10000
        : (r.quantity > 0 ? Math.round((r.total_amount / r.quantity) * 10000) / 10000 : null);
    } else if (r.type === 'sell') {
      summary.sellCount++;
      summary.sellAmount += r.total_amount;
      r.zero_cost = false;
      // 卖出成本基础 = 卖出前持仓的加权成本（不含本笔）
      const st = advanceTo(r.asset_id, r.date, r.id, false);
      const basis: number | null = st.quantity > 0 && st.costPrice > 0
        ? Math.round(st.costPrice * 10000) / 10000
        : null;
      r.cost_price = basis;
      if (basis === null) {
        // 无持仓/无成本价 → 盈亏显示 —，不参与汇总（不回退资产表旧值）
        r.realized_pnl = null;
        summary.unknownPnlCount++;
      } else {
        const pnl = Math.round((r.total_amount - basis * r.quantity) * 100) / 100;
        r.realized_pnl = pnl;
        summary.realizedPnl = Math.round((summary.realizedPnl + pnl) * 100) / 100;
      }
    } else {
      // dividend / split 等：不参与买卖统计与盈亏
      r.realized_pnl = null;
      r.cost_price = null;
      r.zero_cost = false;
    }
  }
  return { date, rows, summary };
}

// ─── 投资收益明细（近 N 天卖出收益，v1.10.0） ──────────────────────

export interface RecentSellRow {
  id: number;
  name: string;
  code: string;
  currency: string;
  quantity: number;
  price: number;
  total_amount: number;
  /** 成本价（当日(含)前买入加权平均，无则 null） */
  cost_price: number | null;
  /** 单笔已实现盈亏 = 卖出净额 − 成本价×数量（无成本价 null） */
  realized_pnl: number | null;
  /** 收益率（%） = 盈亏 ÷ 成本基数 × 100 */
  rate_pct: number | null;
}

export interface RecentSellDay {
  date: string;
  sells: RecentSellRow[];
  sellCount: number;
  realizedPnl: number;
  sellAmount: number;
}

/**
 * 投资收益明细：最近 days 天（今天起往前）每天的卖出交易明细，按天分组。
 * 只含卖出（买入不创造收益）；成本基础复用 getDailyTrades 的历史加权平均逻辑。
 */
export function getRecentSellPnl(days = 3): RecentSellDay[] {
  const out: RecentSellDay[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = localDateStr(d);
    const { rows } = getDailyTrades(dateStr);
    const sells: RecentSellRow[] = [];
    let realizedPnl = 0;
    let sellAmount = 0;
    for (const r of rows) {
      if (r.type !== 'sell') continue;
      const basis = r.cost_price != null && r.cost_price > 0 ? r.cost_price * r.quantity : 0;
      const rate = basis > 0 && r.realized_pnl != null ? roundPct((r.realized_pnl / basis) * 100) : null;
      sells.push({
        id: r.id, name: r.name, code: r.code, currency: r.currency,
        quantity: r.quantity, price: r.price, total_amount: r.total_amount,
        cost_price: r.cost_price, realized_pnl: r.realized_pnl, rate_pct: rate,
      });
      realizedPnl = roundMoney(realizedPnl + (r.realized_pnl ?? 0));
      sellAmount = roundMoney(sellAmount + r.total_amount);
    }
    out.push({ date: dateStr, sells, sellCount: sells.length, realizedPnl, sellAmount });
  }
  return out;
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
    WHERE fd.status = 'active'
  `).get() as any;
  const insRow = db.prepare(`
    SELECT COALESCE(SUM(cash_value * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM insurance_policies p
    LEFT JOIN currencies c ON p.cash_value_currency = c.code
    WHERE p.is_active = 1
  `).get() as any;

  // v1.7.4：债务债权（未结，按币种折算）
  const creditRow = db.prepare(`
    SELECT COALESCE(SUM(s.amount * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM social_obligations s
    LEFT JOIN currencies c ON s.currency = c.code
    WHERE s.type = 'owed' AND s.status = 'pending'
  `).get() as any;
  const debtRow = db.prepare(`
    SELECT COALESCE(SUM(s.amount * COALESCE(c.rate_to_base, 1)), 0) as total
    FROM social_obligations s
    LEFT JOIN currencies c ON s.currency = c.code
    WHERE s.type = 'owe' AND s.status = 'pending'
  `).get() as any;

  const bankTotal = bankCash.total || 0;
  const walletTotal = walletCash.total || 0;
  const brokerHoldings = brokerRows?.holdings || 0;
  const brokerCash = brokerRows?.cash || 0;
  const fdTotal = fdRow.total || 0;
  const insTotal = insRow.total || 0;
  const creditTotal = creditRow.total || 0;
  const debtTotal = debtRow.total || 0;
  const grandTotal = bankTotal + walletTotal + brokerHoldings + brokerCash + fdTotal + insTotal + creditTotal - debtTotal;

  const overview = [
    { category: '银行账户', amount_cny: bankTotal },
    { category: '电子钱包与现金', amount_cny: walletTotal },
    { category: '券商持仓市值', amount_cny: brokerHoldings },
    { category: '券商现金余额', amount_cny: brokerCash },
    { category: '定期存款', amount_cny: fdTotal },
    { category: '保险现金价值', amount_cny: insTotal },
    { category: '债权', amount_cny: creditTotal },
    { category: '债务', amount_cny: -debtTotal },
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
    WHERE a.is_active = 1 AND fd.status = 'active'
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

  // 债务债权（v1.7.4）
  const debtCredit = db.prepare(`
    SELECT s.type, s.person, s.item, s.amount, s.currency,
      s.amount * COALESCE(c.rate_to_base, 1) as amount_cny,
      s.status, s.completed_at, s.notes, date(s.created_at) as created_date
    FROM social_obligations s
    LEFT JOIN currencies c ON s.currency = c.code
    ORDER BY s.status, s.type, s.id DESC
  `).all() as any[];

  return [
    { name: '总览', rows: transformRows(overview, H.overview, 'overview') },
    { name: '银行账户', rows: transformRows(banks, H.banks, 'overview') },
    { name: '电子钱包', rows: transformRows(wallets, H.wallets, 'overview') },
    { name: '券商账户', rows: transformRows(brokers, H.brokers, 'overview') },
    { name: '投资持仓', rows: transformRows(holdings, H.holdings, 'assets') },
    { name: '定期存款', rows: transformRows(fixedDeposits, H.fixedDeposits, 'overview') },
    { name: '保险', rows: transformRows(insurance, H.insurance, 'overview') },
    { name: '债务债权', rows: transformRows(debtCredit, H.debtCredit, 'debtCredit') },
  ];
}

// ─── 导出转换与表头 ──────────────────────────────────────────────

export type ExportHeader = { key: string; label: string };

export function transformRows(
  rows: any[], headers: ExportHeader[], ctx: 'assets' | 'trades' | 'ledgers' | 'overview' | 'debtCredit'
): Record<string, any>[] {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const h of headers) {
      let value = row[h.key];
      if (ctx === 'debtCredit' && h.key === 'type') {
        value = value === 'owe' ? '债务（我欠）' : value === 'owed' ? '债权（欠我）' : value;
      } else if (ctx === 'debtCredit' && h.key === 'status') {
        value = value === 'pending' ? '未结' : value === 'done' ? '已结' : value;
      } else if (h.key === 'type') {
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
  debtCredit: [
    { key: 'type', label: '类型' }, { key: 'person', label: '对方' },
    { key: 'item', label: '事项' }, { key: 'amount', label: '金额' },
    { key: 'currency', label: '币种' }, { key: 'amount_cny', label: 'CNY等值' },
    { key: 'status', label: '状态' }, { key: 'completed_at', label: '完成日期' },
    { key: 'notes', label: '备注' }, { key: 'created_date', label: '创建日期' },
  ],
  trades: [
    { key: 'date', label: '日期' }, { key: 'name', label: '股票名称' },
    { key: 'code', label: '代码' }, { key: 'type', label: '买卖方向' },
    { key: 'quantity', label: '数量' }, { key: 'price', label: '成交价' },
    { key: 'cost_price', label: '成本价' },
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
