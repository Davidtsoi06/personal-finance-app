/**
 * dividend-service — 股息/分红登记（v1.10.21）。
 * 一次登记写三处，与买卖写库口径一致：
 *   1) transactions(type='dividend')：数量 0、total_amount = 税后实收、fee = 预扣税（备注记税前）
 *   2) 现金：券商关联银行 → 直达银行余额（v1.10.14 规则）；未关联 → 记券商流动金并重算余额
 *   3) 可选 ledgers 一笔「投资收入」（纯记录，不联动账户余额，避免与 2) 重复）
 * 分红不改持仓数量与成本价（成本重放明确排除 dividend）。
 */
import type Database from 'better-sqlite3';
import { getDatabase } from '../index';
import { applyTradeCashToAccountInDb, removeFlowsForTransactionInDb } from './cash-flow-core';
import { roundMoney } from '../../../shared/utils/money';
import { detectMarket } from '../../../shared/utils/market';
import { normalizeCode, normalizeCurrency, normalizeString } from '../../services/data-normalizer';

export interface DividendInput {
  investmentAccountId: number;
  /** 关联持仓（可空：按 code 在当前账户查找，找不到则建 0 持仓占位，仅用于挂靠分红历史） */
  assetId?: number | null;
  code?: string;
  name?: string;
  currency?: string;
  date: string;
  /** 税前总额 */
  grossAmount: number;
  /** 预扣税 */
  taxAmount?: number;
  /** 每股派息（记录用） */
  perShare?: number;
  /** 股数（记录用） */
  quantity?: number;
  /** 是否同步写一笔「股息收入」记账（默认 true） */
  writeLedger?: boolean;
  /** 现金处理：auto = 按券商规则（默认）；none = 不动现金（银行流水已入账，仅登记股息收入） */
  cashEffect?: 'auto' | 'none';
  notes?: string;
}

export interface DividendResult {
  transactionId: number;
  assetId: number;
  ledgerId: number | null;
  gross: number;
  tax: number;
  net: number;
}

interface AssetLite {
  id: number;
  name: string;
  code: string;
  currency: string;
  quantity: number;
  investment_account_id: number | null;
  notes: string | null;
}

const PLACEHOLDER_NOTE = '分红登记占位（0 持仓）';

/** 找到（或建占位）用于挂靠分红的持仓行 */
function resolveAssetInDb(db: Database.Database, input: DividendInput): AssetLite {
  if (input.assetId) {
    const byId = db.prepare('SELECT * FROM assets WHERE id = ?').get(input.assetId) as AssetLite | undefined;
    if (byId) return byId;
  }
  const code = normalizeCode(input.code || '');
  const currency = normalizeCurrency(input.currency, 'CNY');
  const existing = db.prepare('SELECT * FROM assets WHERE code = ? AND investment_account_id = ?')
    .get(code, input.investmentAccountId) as AssetLite | undefined;
  if (existing) return existing;

  const name = normalizeString(input.name) || code;
  const det = detectMarket(code);
  const market = det !== 'other' ? det : currency === 'HKD' ? 'hk_stock' : currency === 'USD' ? 'us_stock' : 'a_stock';
  const r = db.prepare([
    'INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price,',
    ' market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id, notes)',
    " VALUES (?, ?, 'stock', ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)",
  ].join('')).run(name, code, market, currency, input.investmentAccountId, PLACEHOLDER_NOTE);
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(r.lastInsertRowid)) as AssetLite;
}

/** 「投资收入」分类（不存在则建） */
function investmentIncomeCategoryInDb(db: Database.Database): number {
  const cat = db.prepare("SELECT id FROM categories WHERE name = '投资收入' AND type = 'income'").get() as { id: number } | undefined;
  if (cat) return cat.id;
  const r = db.prepare(
    "INSERT INTO categories (name, type, parent_id, icon, sort_order, is_default) VALUES ('投资收入', 'income', NULL, '💰', 7, 1)"
  ).run();
  return Number(r.lastInsertRowid);
}

/** 写/更新/删除股息对应的记账（source_type='dividend', source_id=交易id） */
function syncDividendLedgerInDb(
  db: Database.Database,
  data: { transactionId: number; enabled: boolean; amount: number; currency: string; date: string; description: string }
): number | null {
  const linked = db.prepare("SELECT id FROM ledgers WHERE source_type = 'dividend' AND source_id = ?")
    .all(data.transactionId) as { id: number }[];
  if (!data.enabled || !(data.amount > 0)) {
    for (const l of linked) db.prepare('DELETE FROM ledgers WHERE id = ?').run(l.id);
    return null;
  }
  // 与定存利息同口径：直接 SQL，不联动账户余额（余额已由 2) 的现金流入调整）
  if (linked.length > 0) {
    db.prepare('UPDATE ledgers SET type = ?, amount = ?, currency = ?, date = ?, description = ? WHERE id = ?')
      .run('income', data.amount, data.currency, data.date, data.description, linked[0].id);
    return linked[0].id;
  }
  const catId = investmentIncomeCategoryInDb(db);
  const r = db.prepare([
    'INSERT INTO ledgers (type, amount, currency, category_id, account_id, date, description, source_type, source_id)',
    " VALUES ('income', ?, ?, ?, NULL, ?, ?, 'dividend', ?)",
  ].join('')).run(data.amount, data.currency, catId, data.date, data.description, data.transactionId > 0 ? data.transactionId : null);
  return Number(r.lastInsertRowid);
}

/** 登记一笔股息（调用方负责事务；导入路径复用，见 dividend-service 头部说明） */
export function recordDividendInDb(db: Database.Database, input: DividendInput): DividendResult {
  const gross = roundMoney(Math.max(0, Number(input.grossAmount) || 0));
  const tax = Math.min(roundMoney(Math.max(0, Number(input.taxAmount) || 0)), gross);
  const net = roundMoney(gross - tax);
  if (!(net > 0)) throw new Error('股息实收金额必须大于 0');
  const currency = normalizeCurrency(input.currency, 'CNY');
  const notes = ['股息', '税前 ' + gross.toFixed(2), '税 ' + tax.toFixed(2)]
    .concat(input.notes ? [normalizeString(input.notes)] : []).join(' · ');

  const asset = resolveAssetInDb(db, input);
  const txRes = db.prepare([
      'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)',
      " VALUES (?, 'dividend', 0, ?, ?, ?, ?, ?, ?)",
  ].join('')).run(asset.id, Number(input.perShare) || 0, tax, net, currency, input.date, notes);
  const transactionId = Number(txRes.lastInsertRowid);

  if (input.cashEffect !== 'none') {
    applyTradeCashToAccountInDb(db, {
      investmentAccountId: input.investmentAccountId, type: 'dividend', amount: net,
      assetId: asset.id, transactionId, currency, date: input.date,
      notes: '股息 ' + (asset.name || asset.code),
    });
  }

  const ledgerId = syncDividendLedgerInDb(db, {
    transactionId, enabled: input.writeLedger !== false, amount: net, currency, date: input.date,
    description: '股息收入 ' + asset.code + ' ' + asset.name,
  });

  return { transactionId, assetId: asset.id, ledgerId, gross, tax, net };
}

/** 登记一笔股息（自带事务） */
export function recordDividend(input: DividendInput): DividendResult {
  const db = getDatabase();
  return db.transaction(() => recordDividendInDb(db, input))();
}

/** 修改一笔股息（金额/日期/备注/是否记账），现金流与记账同步重建 */
export function updateDividend(id: number, input: Partial<DividendInput>): DividendResult {
  const db = getDatabase();
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as
    { id: number; asset_id: number; type: string; fee: number; total_amount: number; currency: string; date: string; price: number } | undefined;
  if (!tx || tx.type !== 'dividend') throw new Error('未找到该股息记录');
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(tx.asset_id) as AssetLite;
  const accountId = input.investmentAccountId ?? asset.investment_account_id;
  if (!accountId) throw new Error('该股息没有关联券商账户');

  const oldGross = roundMoney(Number(tx.total_amount) + Number(tx.fee));
  const gross = input.grossAmount !== undefined ? roundMoney(Math.max(0, Number(input.grossAmount) || 0)) : oldGross;
  const tax = Math.min(roundMoney(Math.max(0, Number(input.taxAmount) || 0)), gross);
  const net = roundMoney(gross - tax);
  if (!(net > 0)) throw new Error('股息实收金额必须大于 0');
  const currency = normalizeCurrency(input.currency || tx.currency, 'CNY');
  const date = input.date || tx.date;
  const notes = ['股息', '税前 ' + gross.toFixed(2), '税 ' + tax.toFixed(2)]
    .concat(input.notes ? [normalizeString(input.notes)] : []).join(' · ');

  const run = db.transaction((): DividendResult => {
    db.prepare('UPDATE transactions SET price = ?, fee = ?, total_amount = ?, currency = ?, date = ?, notes = ? WHERE id = ?')
      .run(input.perShare !== undefined ? Number(input.perShare) || 0 : tx.price, tax, net, currency, date, notes, id);
    // 现金流重建（先删旧流水，再按新金额插入；关联银行则同步银行存取记录）
    removeFlowsForTransactionInDb(db, id);
    applyTradeCashToAccountInDb(db, {
      investmentAccountId: accountId, type: 'dividend', amount: net,
      assetId: asset.id, transactionId: id, currency, date,
      notes: '股息 ' + (asset.name || asset.code),
    });
    const ledgerId = syncDividendLedgerInDb(db, {
      transactionId: id, enabled: input.writeLedger !== false, amount: net, currency, date,
      description: '股息收入 ' + asset.code + ' ' + asset.name,
    });
    return { transactionId: id, assetId: asset.id, ledgerId, gross, tax, net };
  });

  return run();
}

/** 删除一笔股息：连带删除记账、现金流、券商直达银行记录，并清理占位持仓 */
export function deleteDividend(id: number): boolean {
  const db = getDatabase();
  const tx = db.prepare('SELECT id, asset_id, type FROM transactions WHERE id = ?').get(id) as
    { id: number; asset_id: number; type: string } | undefined;
  if (!tx || tx.type !== 'dividend') return false;

  const run = db.transaction((): boolean => {
    db.prepare("DELETE FROM ledgers WHERE source_type = 'dividend' AND source_id = ?").run(id);
    removeFlowsForTransactionInDb(db, id);
    const r = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    // 占位持仓（0 数量、无其它交易）一并清理，避免残留空壳资产
    const asset = db.prepare('SELECT id, quantity, notes FROM assets WHERE id = ?').get(tx.asset_id) as
      { id: number; quantity: number; notes: string | null } | undefined;
    if (asset && asset.notes === PLACEHOLDER_NOTE) {
      const left = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE asset_id = ?').get(asset.id) as { c: number };
      const held = db.prepare('SELECT COUNT(*) as c FROM asset_prices WHERE asset_id = ?').get(asset.id) as { c: number };
      if (left.c === 0 && held.c === 0) db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    }
    return r.changes > 0;
  });

  return run();
}

/** 某账户下的股息记录（编辑入口用） */
export function listDividendsByAccount(accountId: number, year?: number): any[] {
  const db = getDatabase();
  const args: any[] = [accountId];
  let sql = [
    'SELECT t.id, t.date, t.total_amount as netAmount, t.fee as taxAmount, t.currency, t.notes,',
    ' t.asset_id as assetId, a.code, a.name FROM transactions t',
    ' JOIN assets a ON t.asset_id = a.id',
    " WHERE t.type = 'dividend' AND a.investment_account_id = ?",
  ].join('');
  if (year) { sql += " AND strftime('%Y', t.date) = ?"; args.push(String(year)); }
  sql += ' ORDER BY t.date DESC, t.id DESC';
  return db.prepare(sql).all(...args);
}

/**
 * v1.10.21：银行日结单里的股息行——现金已由银行存取记录入账，这里只补「股息收入」：
 *   1) 摘要中出现某持仓代码 → 补一条 transactions(type='dividend')（不动现金），报表可见
 *   2) 无论如何都写一笔 ledgers「投资收入 · 股息收入」（account_id NULL，不联动余额）
 */
export function recordBankDividendInDb(
  db: Database.Database,
  data: { amount: number; currency: string; date: string; description: string }
): { transactionId: number | null; ledgerId: number | null } {
  const net = roundMoney(Math.max(0, Number(data.amount) || 0));
  if (!(net > 0)) return { transactionId: null, ledgerId: null };

  const upper = (data.description || '').toUpperCase();
  const candidates = db.prepare(
    'SELECT a.id, a.name, a.code, a.currency, a.investment_account_id FROM assets a' +
    ' WHERE a.investment_account_id IS NOT NULL ORDER BY a.id'
  ).all() as { id: number; name: string; code: string; currency: string; investment_account_id: number }[];
  const matched = candidates.find((a) => a.code.length >= 3 && upper.includes(a.code.toUpperCase()));

  let transactionId: number | null = null;
  if (matched) {
    const notes = '股息 · 银行流水导入 · ' + (data.description || '').slice(0, 60);
    const r = db.prepare(
      'INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)' +
      " VALUES (?, 'dividend', 0, 0, 0, ?, ?, ?, ?)"
    ).run(matched.id, net, data.currency || matched.currency || 'CNY', data.date, notes);
    transactionId = Number(r.lastInsertRowid);
  }

  const ledgerId = syncDividendLedgerInDb(db, {
    transactionId: transactionId ?? -1,
    enabled: true,
    amount: net,
    currency: data.currency || 'CNY',
    date: data.date,
    description: '股息收入 ' + (matched ? matched.code + ' ' + matched.name : (data.description || '').slice(0, 40)),
  });
  return { transactionId, ledgerId };
}
