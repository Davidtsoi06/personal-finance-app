/**
 * Portfolio context — gathers comprehensive user portfolio data and formats it
 * as structured Markdown text for injection into the AI system prompt.
 */
import { getDatabase } from '../database/index';

export function gatherPortfolioContext(): string {
  const db = getDatabase();
  const parts: string[] = [];

  parts.push('## 📊 用户当前资产数据快照\n');

  // ── 1. Asset overview ──
  try {
    const nw = db.prepare(
      'SELECT * FROM net_worth_history ORDER BY date DESC LIMIT 1'
    ).get() as any;
    if (nw) {
      parts.push('### 资产总览');
      parts.push(`- 现金及存款：¥ ${(nw.total_cash || 0).toLocaleString()}`);
      parts.push(`- 投资市值：¥ ${(nw.total_investments || 0).toLocaleString()}`);
      parts.push(`- 净资产：¥ ${(nw.net_worth || 0).toLocaleString()}`);
      parts.push(`- 快照日期：${nw.date}`);
      parts.push('');
    }
  } catch { /* ignore */ }

  // ── 2. Accounts ──
  try {
    const accounts = db.prepare(
      'SELECT name, type, currency, balance, bank_name FROM accounts WHERE is_active = 1 ORDER BY type, name'
    ).all() as any[];
    if (accounts.length > 0) {
      parts.push('### 账户列表');
      parts.push('| 名称 | 类型 | 币种 | 余额 |');
      parts.push('|------|------|------|------|');
      const typeLabels: Record<string, string> = { cash: '现金', bank_card: '银行卡', credit_card: '信用卡', online_pay: '在线支付' };
      for (const a of accounts) {
        const typeLabel = typeLabels[a.type] || a.type;
        parts.push(`| ${a.name} | ${typeLabel} | ${a.currency} | ¥ ${(a.balance || 0).toLocaleString()} |`);
      }
      parts.push('');
    }
  } catch { /* ignore */ }

  // ── 3. Holdings ──
  try {
    const assets = db.prepare(
      `SELECT a.name, a.code, a.type, a.market, a.currency, a.quantity,
              a.cost_price, a.current_price, a.market_value, a.total_cost,
              a.profit_loss, a.profit_loss_pct, ia.name as broker
       FROM assets a
       LEFT JOIN investment_accounts ia ON a.investment_account_id = ia.id
       WHERE a.quantity > 0
       ORDER BY a.market_value DESC
       LIMIT 50`
    ).all() as any[];
    if (assets.length > 0) {
      const countNote = assets.length >= 50 ? ' （仅显示前50项）' : '';
      parts.push(`### 投资持仓明细${countNote}`);
      parts.push('| 名称 | 代码 | 市场 | 数量 | 成本价 | 当前价 | 市值 | 盈亏 | 收益率 |');
      parts.push('|------|------|------|------|--------|--------|------|------|--------|');
      const marketLabels: Record<string, string> = { a_stock: 'A股', hk_stock: '港股', us_stock: '美股', other: '其他' };
      const typeLabels: Record<string, string> = { stock: '股票', fund: '基金', etf: 'ETF', gold: '黄金', crypto: '加密货币', fixed_deposit: '定存' };
      for (const a of assets) {
        const market = marketLabels[a.market] || a.market;
        const type = typeLabels[a.type] || a.type;
        const name = a.broker ? `${a.name} (${a.broker})` : a.name;
        const sign = (a.profit_loss || 0) >= 0 ? '+' : '';
        parts.push(
          `| ${name} | ${a.code} | ${market} | ${a.quantity} | ¥${(a.cost_price || 0).toFixed(2)} | ¥${(a.current_price || 0).toFixed(2)} | ¥${(a.market_value || 0).toLocaleString()} | ${sign}¥${(a.profit_loss || 0).toLocaleString()} | ${sign}${(a.profit_loss_pct || 0).toFixed(2)}% |`
        );
      }
      parts.push('');
    }
  } catch { /* ignore */ }

  // ── 4. Recent transactions ──
  try {
    const txns = db.prepare(
      `SELECT t.date, a.name, a.code, t.type, t.quantity, t.price, t.fee, t.total_amount, t.currency
       FROM transactions t
       JOIN assets a ON t.asset_id = a.id
       ORDER BY t.date DESC, t.id DESC
       LIMIT 20`
    ).all() as any[];
    if (txns.length > 0) {
      parts.push('### 近期交易（最近20笔）');
      parts.push('| 日期 | 名称 | 代码 | 方向 | 数量 | 价格 | 手续费 | 总金额 |');
      parts.push('|------|------|------|------|------|------|------|------|');
      const tradeLabels: Record<string, string> = { buy: '买入', sell: '卖出', split: '分拆', dividend: '分红' };
      for (const t of txns) {
        const direction = tradeLabels[t.type] || t.type;
        parts.push(
          `| ${t.date} | ${t.name} | ${t.code} | ${direction} | ${t.quantity} | ¥${(t.price || 0).toFixed(2)} | ¥${(t.fee || 0).toFixed(2)} | ¥${(t.total_amount || 0).toLocaleString()} |`
        );
      }
      parts.push('');
    }
  } catch { /* ignore */ }

  // ── 5. Monthly income/expense ──
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const summary = db.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
       FROM ledgers
       WHERE strftime('%Y-%m', date) = ?`
    ).get(month) as any;
    if (summary) {
      parts.push('### 本月收支概况');
      parts.push(`- 本月收入：¥ ${(summary.income || 0).toLocaleString()}`);
      parts.push(`- 本月支出：¥ ${(summary.expense || 0).toLocaleString()}`);
      parts.push(`- 本月结余：¥ ${((summary.income || 0) - (summary.expense || 0)).toLocaleString()}`);
      parts.push('');
    }

    // Category breakdown
    const cats = db.prepare(
      `SELECT c.name, COALESCE(SUM(l.amount), 0) as total
       FROM ledgers l
       JOIN categories c ON l.category_id = c.id
       WHERE l.type = 'expense' AND strftime('%Y-%m', l.date) = ?
       GROUP BY c.name
       ORDER BY total DESC
       LIMIT 10`
    ).all(month) as any[];
    if (cats.length > 0) {
      const grandTotal = cats.reduce((s: number, r: any) => s + r.total, 0);
      parts.push('### 本月支出分类排行');
      parts.push('| 分类 | 金额 | 占比 |');
      parts.push('|------|------|------|');
      for (const c of cats) {
        const pct = grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(1) : '0';
        parts.push(`| ${c.name} | ¥ ${(c.total || 0).toLocaleString()} | ${pct}% |`);
      }
      parts.push('');
    }
  } catch { /* ignore */ }

  parts.push('---');
  parts.push('*以上数据为当前应用内真实数据，请基于这些数据回答用户的问题。*');

  return parts.join('\n');
}
