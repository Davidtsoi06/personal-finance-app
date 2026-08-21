/**
 * Account service — CRUD operations for accounts table.
 * Supports parent-child hierarchy and multi-currency balances (v7).
 */
import { getDatabase } from '../index';
import { normalizeCardNumber } from '../../../shared/utils/card';

export interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string;
  balance: number;
  bank_name: string | null;
  card_number: string | null;
  asset_type: string;
  display_alias: string | null;
  parent_account_id: number | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AccountBalanceRow {
  id: number;
  account_id: number;
  currency: string;
  balance: number;
  updated_at: string;
}

export interface AccountWithTree extends AccountRow {
  children: AccountWithTree[];
  balances: AccountBalanceRow[];
}

// ── CRUD ──

export function listAccounts(): AccountRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM accounts WHERE is_active = 1 ORDER BY sort_order, id'
  ).all() as AccountRow[];
}

/** Return accounts as a tree structure (parents with nested children). */
export function listAccountsAsTree(): AccountWithTree[] {
  const db = getDatabase();
  const all = db.prepare(
    'SELECT * FROM accounts WHERE is_active = 1 ORDER BY sort_order, id'
  ).all() as AccountRow[];

  const balances = db.prepare(
    'SELECT * FROM account_balances ORDER BY currency'
  ).all() as AccountBalanceRow[];

  const balanceMap = new Map<number, AccountBalanceRow[]>();
  for (const b of balances) {
    const list = balanceMap.get(b.account_id) || [];
    list.push(b);
    balanceMap.set(b.account_id, list);
  }

  const byId = new Map<number, AccountWithTree>();
  const roots: AccountWithTree[] = [];
  for (const a of all) {
    byId.set(a.id, { ...a, children: [], balances: balanceMap.get(a.id) || [] });
  }
  for (const a of byId.values()) {
    if (a.parent_account_id && byId.has(a.parent_account_id)) {
      byId.get(a.parent_account_id)!.children.push(a);
    } else {
      roots.push(a);
    }
  }
  return roots;
}

export function getAccount(id: number): AccountRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

/** Get account with its balances and children. */
export function getAccountWithTree(id: number): AccountWithTree | undefined {
  const db = getDatabase();
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  if (!acc) return undefined;

  const balances = db.prepare(
    'SELECT * FROM account_balances WHERE account_id = ? ORDER BY currency'
  ).all(id) as AccountBalanceRow[];

  const children = db.prepare(
    'SELECT * FROM accounts WHERE parent_account_id = ? AND is_active = 1 ORDER BY sort_order, id'
  ).all(id) as AccountRow[];

  return {
    ...acc,
    balances,
    children: children.map(c => ({ ...c, children: [], balances: [] })),
  };
}

export function createAccount(data: {
  name: string;
  type: string;
  asset_type?: string;
  currency?: string;
  balance?: number;
  bank_name?: string;
  card_number?: string;
  parent_account_id?: number | null;
  sort_order?: number;
}): AccountRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';
  const balance = data.balance || 0;
  const assetType = data.asset_type || 'bank';

  const stmt = db.prepare(`
    INSERT INTO accounts (name, type, asset_type, currency, balance, bank_name, card_number, parent_account_id, sort_order)
    VALUES (@name, @type, @asset_type, @currency, @balance, @bank_name, @card_number, @parent_account_id, @sort_order)
  `);
  const result = stmt.run({
    name: data.name,
    type: data.type,
    asset_type: assetType,
    currency,
    balance,
    bank_name: data.bank_name || null,
    card_number: normalizeCardNumber(data.card_number),
    parent_account_id: data.parent_account_id || null,
    sort_order: data.sort_order || 0,
  });

  // Also create initial account_balances entry
  const accId = result.lastInsertRowid as number;
  if (balance !== 0) {
    db.prepare(
      'INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)'
    ).run(accId, currency, balance);
  }

  return getAccount(accId) as AccountRow;
}

export function updateAccount(id: number, data: Partial<AccountRow> & {
  parent_account_id?: number | null;
}): AccountRow | undefined {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...data, id, updated_at: new Date().toISOString() };
  merged.card_number = normalizeCardNumber(merged.card_number);

  const balanceChanged = data.balance !== undefined && data.balance !== existing.balance;
  const currencyChanged = data.currency !== undefined && data.currency !== existing.currency;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE accounts SET name=?, type=?, asset_type=?, currency=?, balance=?, bank_name=?, card_number=?,
        parent_account_id=?, is_active=?, sort_order=?, updated_at=?
      WHERE id=?
    `).run(
      merged.name, merged.type, merged.asset_type, merged.currency, merged.balance,
      merged.bank_name, merged.card_number,
      merged.parent_account_id ?? null,
      merged.is_active, merged.sort_order, merged.updated_at, id
    );

    // v1.7.1 修复：编辑余额/币种必须同步 account_balances（此前只改 accounts.balance，
    // 总览以 account_balances 为准，导致两表漂移、编辑后数字不变）
    if (balanceChanged || currencyChanged) {
      const newCurrency = merged.currency || existing.currency || 'CNY';
      const newBalance = merged.balance ?? existing.balance ?? 0;
      const oldBucket = db.prepare(
        'SELECT * FROM account_balances WHERE account_id = ? AND currency = ?'
      ).get(id, existing.currency) as { id: number; balance: number } | undefined;
      const oldVal = oldBucket ? oldBucket.balance : 0;
      if (currencyChanged) {
        if (oldBucket) db.prepare('DELETE FROM account_balances WHERE id = ?').run(oldBucket.id);
        updateAccountBalance(id, newCurrency, newBalance);
      } else {
        updateAccountBalance(id, existing.currency, newBalance - oldVal);
      }
    }
  });

  tx();
  return getAccount(id);
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export function deleteAccount(id: number): DeleteResult {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return { success: false, error: '账户不存在' };

  // Check for child accounts
  const childCount = db.prepare(
    'SELECT COUNT(*) as count FROM accounts WHERE parent_account_id = ? AND is_active = 1'
  ).get(id) as { count: number };
  if (childCount.count > 0) {
    return { success: false, error: `该账户下有 ${childCount.count} 个子账户，请先删除子账户` };
  }

  // Check for linked ledgers
  const ledgerCount = db.prepare(
    'SELECT COUNT(*) as count FROM ledgers WHERE account_id = ?'
  ).get(id) as { count: number };
  if (ledgerCount.count > 0) {
    return { success: false, error: `该账户关联了 ${ledgerCount.count} 条记账记录，无法删除` };
  }

  // Check for linked account transactions
  const atCount = db.prepare(
    'SELECT COUNT(*) as count FROM account_transactions WHERE account_id = ?'
  ).get(id) as { count: number };
  if (atCount.count > 0) {
    return { success: false, error: `该账户关联了 ${atCount.count} 条存取记录，无法删除` };
  }

  // Check for linked assets
  const assetCount = db.prepare(
    'SELECT COUNT(*) as count FROM assets WHERE account_id = ?'
  ).get(id) as { count: number };
  if (assetCount.count > 0) {
    return { success: false, error: `该账户关联了 ${assetCount.count} 个投资持仓，无法删除` };
  }

  // Safe to soft-delete
  db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(id);
  return { success: true };
}

/** 强制删除前的影响范围统计（供确认弹窗展示） */
export function getForceDeleteImpact(id: number) {
  const db = getDatabase();
  const count = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c;
  return {
    childCount: count('SELECT COUNT(*) as c FROM accounts WHERE parent_account_id = ? AND is_active = 1'),
    transactionCount: count('SELECT COUNT(*) as c FROM account_transactions WHERE account_id = ?'),
    ledgerCount: count('SELECT COUNT(*) as c FROM ledgers WHERE account_id = ?'),
    fixedDepositCount: count("SELECT COUNT(*) as c FROM fixed_deposits WHERE account_id = ? AND status = 'active'"),
    bankAssetCount: count('SELECT COUNT(*) as c FROM assets WHERE account_id = ?'),
    insuranceCount: count('SELECT COUNT(*) as c FROM insurance_policies WHERE account_id = ?'),
    premiumCount: count('SELECT COUNT(*) as c FROM premium_payments WHERE account_id = ?'),
    linkedBrokerCount: count('SELECT COUNT(*) as c FROM investment_accounts WHERE funding_account_id = ?'),
  };
}

/** Force-delete account and all related records (cascade). */
export function forceDeleteAccount(id: number): DeleteResult {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return { success: false, error: '账户不存在' };

  const deleteAll = db.transaction(() => {
    // Soft-delete child accounts recursively
    const childIds = db.prepare(
      'SELECT id FROM accounts WHERE parent_account_id = ? AND is_active = 1'
    ).all(id) as { id: number }[];
    for (const child of childIds) {
      forceDeleteAccount(child.id);
    }

    // Delete account_transactions
    db.prepare('DELETE FROM account_transactions WHERE account_id = ?').run(id);

    // Delete account_balances
    db.prepare('DELETE FROM account_balances WHERE account_id = ?').run(id);

    // Delete ledgers
    db.prepare('DELETE FROM ledgers WHERE account_id = ?').run(id);

    // Delete fixed deposits（定期存款属于账户数据，强制删除时一并清理）
    // v1.9.0：定存流水一并清理（FK 级联之外显式删除，防外键关闭时残留）
    db.prepare('DELETE FROM fixed_deposit_flows WHERE fd_id IN (SELECT id FROM fixed_deposits WHERE account_id = ?)').run(id);
    db.prepare('DELETE FROM fixed_deposits WHERE account_id = ?').run(id);

    // Nullify asset links (keep the assets, just remove account linkage)
    db.prepare('UPDATE assets SET account_id = NULL WHERE account_id = ?').run(id);

    // 解除保单与保费的扣款账户关联（保单数据保留）
    db.prepare('UPDATE insurance_policies SET account_id = NULL WHERE account_id = ?').run(id);
    db.prepare('UPDATE premium_payments SET account_id = NULL WHERE account_id = ?').run(id);

    // 解除券商与本账户的资金关联（券商数据保留）
    db.prepare('UPDATE investment_accounts SET funding_account_id = NULL WHERE funding_account_id = ?').run(id);

    // Soft-delete the account itself
    db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(id);
  });

  try {
    deleteAll();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || '强制删除失败' };
  }
}

// ── Balances ──

export function getAccountBalances(accountId: number): AccountBalanceRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM account_balances WHERE account_id = ? ORDER BY currency'
  ).all(accountId) as AccountBalanceRow[];
}

export function updateAccountBalance(accountId: number, currency: string, delta: number): void {
  const db = getDatabase();
  // Upsert balance
  const existing = db.prepare(
    'SELECT * FROM account_balances WHERE account_id = ? AND currency = ?'
  ).get(accountId, currency) as AccountBalanceRow | undefined;

  if (existing) {
    const newBalance = existing.balance + delta;
    if (newBalance === 0) {
      db.prepare('DELETE FROM account_balances WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        "UPDATE account_balances SET balance = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newBalance, existing.id);
    }
  } else if (delta !== 0) {
    db.prepare(
      "INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)"
    ).run(accountId, currency, delta);
  }

  // Sync accounts.balance to CNY-equivalent total from all currency balances
  const row = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total_cny
    FROM account_balances ab
    LEFT JOIN currencies c ON ab.currency = c.code
    WHERE ab.account_id = ?
  `).get(accountId) as { total_cny: number };
  db.prepare(
    "UPDATE accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(row.total_cny, accountId);
}

// ── Aggregation ──

export function getTotalBalance(currency?: string): number {
  const db = getDatabase();
  if (currency) {
    const row = db.prepare(
      'SELECT COALESCE(SUM(balance), 0) as total FROM account_balances WHERE currency = ?'
    ).get(currency) as any;
    return row.total;
  }
  // Return CNY-equivalent total across all active accounts
  const row = db.prepare(`
    SELECT COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as total_cny
    FROM account_balances ab
    JOIN accounts a ON a.id = ab.account_id AND a.is_active = 1
    LEFT JOIN currencies c ON ab.currency = c.code
  `).get() as any;
  return row.total_cny;
}

/**
 * Recalculate accounts.balance for ALL active accounts as CNY-equivalent total.
 * Run once after migrating from the old raw-sum balance to CNY-equivalent balance.
 * Safe to call multiple times — it's idempotent.
 */
export function recalculateAllAccountBalances(): { updated: number } {
  const db = getDatabase();
  let updated = 0;

  const allRows = db.prepare(`
    SELECT ab.account_id,
      COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as balance_cny
    FROM account_balances ab
    LEFT JOIN currencies c ON ab.currency = c.code
    GROUP BY ab.account_id
  `).all() as { account_id: number; balance_cny: number }[];

  const stmt = db.prepare("UPDATE accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?");
  for (const row of allRows) {
    stmt.run(row.balance_cny, row.account_id);
    updated++;
  }

  return { updated };
}

/** Create a parent account + multiple children in a single transaction (bank type). */
export function createAccountWithChildren(parent: {
  name: string;
  type: string;
  asset_type?: string;
  currency?: string;
  bank_name?: string;
  children: Array<{
    name: string;
    type: string;
    currency?: string;
    balance?: number;
    card_number?: string;
  }>;
}): { parent: AccountRow; children: AccountRow[] } {
  const db = getDatabase();
  const currency = parent.currency || 'CNY';
  const assetType = parent.asset_type || 'bank';

  const createParent = db.prepare(`
    INSERT INTO accounts (name, type, asset_type, currency, balance, bank_name, card_number, parent_account_id, sort_order)
    VALUES (@name, @type, @asset_type, @currency, 0, @bank_name, NULL, NULL, 0)
  `);

  const createChild = db.prepare(`
    INSERT INTO accounts (name, type, asset_type, currency, balance, bank_name, card_number, parent_account_id, sort_order)
    VALUES (@name, @type, @asset_type, @currency, @balance, @bank_name, @card_number, @parent_account_id, @sort_order)
  `);

  const createBalance = db.prepare(`
    INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const pResult = createParent.run({
      name: parent.name,
      type: parent.type,
      asset_type: assetType,
      currency,
      bank_name: parent.bank_name || null,
    });
    const parentId = pResult.lastInsertRowid as number;

    const childRows: AccountRow[] = [];
    parent.children.forEach((child, idx) => {
      const childCurrency = child.currency || currency;
      const childBalance = child.balance || 0;
      const cResult = createChild.run({
        name: child.name,
        type: child.type,
        asset_type: assetType,
        currency: childCurrency,
        balance: childBalance,
        bank_name: parent.bank_name || null,
        card_number: child.card_number || null,
        parent_account_id: parentId,
        sort_order: idx,
      });
      const childId = cResult.lastInsertRowid as number;
      if (childBalance !== 0) {
        createBalance.run(childId, childCurrency, childBalance);
      }
      childRows.push(getAccount(childId) as AccountRow);
    });

    return { parent: getAccount(parentId) as AccountRow, children: childRows };
  });

  return transaction();
}

// ── Unified Asset Summary ──

export interface AssetSummaryItem {
  id: number;
  name: string;
  asset_type: string;
  type: string;
  currency: string;
  balance: number;
  bank_name: string | null;
  broker: string | null;
  card_number: string | null;
  display_alias: string | null;
  market_value_cny: number;
  cash_balance?: number;
  asset_count?: number;
  total_profit_loss?: number;
  children?: AssetSummaryItem[];
  is_investment: boolean;
}

/**
 * v1.10.6：支付宝多区域模板——父账户「支付宝」+ 子账户「支付宝（国内）」CNY /「支付宝（香港）」HKD。
 * 资产管理页树形展开后即显示两个独立子账号（各自余额/流水）。
 */
export function createAlipayFamily(): { parentId: number; children: number[] } {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const parent = createAccount({ name: '支付宝', type: 'online_pay', asset_type: 'e_wallet', currency: 'CNY' });
    const cn = createAccount({
      name: '支付宝（国内）', type: 'online_pay', asset_type: 'e_wallet',
      currency: 'CNY', parent_account_id: parent.id,
    });
    const hk = createAccount({
      name: '支付宝（香港）', type: 'online_pay', asset_type: 'e_wallet',
      currency: 'HKD', parent_account_id: parent.id,
    });
    return { parentId: parent.id, children: [cn.id, hk.id] };
  });
  return tx();
}

/** Get system wallet accounts (WeChat, Alipay, Cash). */
export function getSystemWallets(): AccountRow[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM accounts WHERE (asset_type IN ('e_wallet', 'cash')) AND is_active = 1 ORDER BY asset_type, sort_order, id"
  ).all() as AccountRow[];
}

/** List all bank accounts grouped by bank_name. */
export function listByBankName(): Map<string, AccountRow[]> {
  const db = getDatabase();
  const all = db.prepare(
    "SELECT * FROM accounts WHERE asset_type = 'bank' AND type != 'credit_card' AND is_active = 1 ORDER BY sort_order, id"
  ).all() as AccountRow[];

  const groups = new Map<string, AccountRow[]>();
  for (const acc of all) {
    const key = acc.bank_name || '未分类银行';
    const list = groups.get(key) || [];
    list.push(acc);
    groups.set(key, list);
  }
  return groups;
}

/** Aggregate all asset types for the new 4-layer architecture. */
export function getAllAssetsSummary(): AssetSummaryItem[] {
  const db = getDatabase();

  // Fetch ALL active accounts
  const allAccounts = db.prepare(`
    SELECT a.*
    FROM accounts a
    WHERE a.is_active = 1
    ORDER BY a.asset_type, a.sort_order, a.id
  `).all() as AccountRow[];

  // Pre-compute CNY-equivalent balance per account from account_balances × currency rates
  const cnyBalances = db.prepare(`
    SELECT ab.account_id,
      COALESCE(SUM(ab.balance * COALESCE(c.rate_to_base, 1)), 0) as balance_cny
    FROM account_balances ab
    LEFT JOIN currencies c ON ab.currency = c.code
    GROUP BY ab.account_id
  `).all() as { account_id: number; balance_cny: number }[];

  const cnyMap = new Map<number, number>();
  for (const row of cnyBalances) {
    cnyMap.set(row.account_id, row.balance_cny);
  }

  // Fetch fixed deposits
  const allFixedDeposits = db.prepare(`
    SELECT fd.*, a.currency as account_currency, COALESCE(c.rate_to_base, 1) as rate_to_cny
    FROM fixed_deposits fd
    JOIN accounts a ON fd.account_id = a.id
    LEFT JOIN currencies c ON fd.currency = c.code
    WHERE a.is_active = 1 AND fd.status = 'active'
  `).all() as any[];

  const fdsByAccount = new Map<number, any[]>();
  for (const fd of allFixedDeposits) {
    const list = fdsByAccount.get(fd.account_id) || [];
    list.push(fd);
    fdsByAccount.set(fd.account_id, list);
  }

  // Fetch investment accounts with market values（按持仓币种换算 CNY，修正混币口径）
  const invAccounts = db.prepare(`
    SELECT ia.*, COALESCE(c.rate_to_base, 1) as rate_to_cny,
      COALESCE(SUM(a.market_value * COALESCE(ac.rate_to_base, 1)), 0) as total_market_value_cny,
      COUNT(a.id) as asset_count,
      COALESCE(SUM(a.profit_loss * COALESCE(ac.rate_to_base, 1)), 0) as total_profit_loss_cny
    FROM investment_accounts ia
    LEFT JOIN currencies c ON ia.currency = c.code
    LEFT JOIN assets a ON a.investment_account_id = ia.id
    LEFT JOIN currencies ac ON a.currency = ac.code
    GROUP BY ia.id
    ORDER BY ia.name
  `).all() as any[];

  // Bank assets (from assets.account_id) — bank wealth products
  const bankAssets = db.prepare(`
    SELECT a.*, acc.bank_name, acc.card_number, acc.display_alias,
      COALESCE(c.rate_to_base, 1) as rate_to_cny
    FROM assets a
    JOIN accounts acc ON a.account_id = acc.id
    LEFT JOIN currencies c ON a.currency = c.code
    WHERE a.account_id IS NOT NULL AND acc.is_active = 1
    ORDER BY a.market_value DESC
  `).all() as any[];

  const bankAssetsByAccount = new Map<number, any[]>();
  for (const ba of bankAssets) {
    const list = bankAssetsByAccount.get(ba.account_id) || [];
    list.push(ba);
    bankAssetsByAccount.set(ba.account_id, list);
  }

  // Fetch insurance total（v1.6.1 修复：按保单现金价值币种换算 CNY）
  const insRow = db.prepare(
    "SELECT COALESCE(SUM(p.cash_value * COALESCE(c.rate_to_base, 1)), 0) as total, COUNT(*) as cnt" +
    " FROM insurance_policies p" +
    " LEFT JOIN currencies c ON p.cash_value_currency = c.code" +
    " WHERE p.is_active = 1"
  ).get() as any;

  const result: AssetSummaryItem[] = [];

  // ═══ Layer 2: Individual items, not grouped by asset_type ═══

  // 1. e_wallet accounts (WeChat, Alipay)
  for (const acc of allAccounts) {
    if (acc.asset_type === 'e_wallet') {
      result.push({
        id: acc.id, name: acc.name, asset_type: 'e_wallet', type: acc.type,
        currency: acc.currency, balance: acc.balance,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: cnyMap.get(acc.id) || 0,
        children: [], is_investment: false,
      });
    }
  }

  // 2. Cash accounts
  for (const acc of allAccounts) {
    if (acc.asset_type === 'cash') {
      result.push({
        id: acc.id, name: acc.name, asset_type: 'cash', type: acc.type,
        currency: acc.currency, balance: acc.balance,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: cnyMap.get(acc.id) || 0,
        children: [], is_investment: false,
      });
    }
  }

  // 3. Insurance (from insurance_policies table)
  if (insRow.cnt > 0) {
    result.push({
      id: -2000, name: '保险', asset_type: 'insurance', type: '',
      currency: 'CNY', balance: insRow.total,
      bank_name: null, broker: null,
      card_number: null, display_alias: null,
      market_value_cny: insRow.total,
      children: [], is_investment: false,
    });
  }

  // 4. Bank accounts — grouped by bank_name
  const bankGroups = new Map<string, (typeof allAccounts)[0][]>();
  for (const acc of allAccounts) {
    if (acc.asset_type === 'bank') {
      const key = acc.bank_name || acc.name;
      const list = bankGroups.get(key) || [];
      list.push(acc);
      bankGroups.set(key, list);
    }
  }

  for (const [bankName, accList] of bankGroups) {
    let groupTotal = 0;
    const children: AssetSummaryItem[] = [];

    for (const acc of accList) {
      const fds = fdsByAccount.get(acc.id) || [];
      // 定存按币种换算 CNY（修复跨币种相加）
      const fdTotalCny = fds.reduce((s: number, fd: any) => s + fd.amount * (fd.rate_to_cny || 1), 0);

      const childItem: AssetSummaryItem = {
        id: acc.id, name: acc.display_alias || acc.name || `尾号${acc.card_number || '****'}`,
        asset_type: 'bank', type: acc.type,
        currency: acc.currency, balance: acc.balance,
        bank_name: acc.bank_name, broker: null,
        card_number: acc.card_number,
        display_alias: acc.display_alias || null,
        // 银行子项 = 余额 + 定存（银行理财已独立为 bank_wealth 投资类，v1.6.0）
        market_value_cny: (cnyMap.get(acc.id) || 0) + fdTotalCny,
        cash_balance: fdTotalCny,
        asset_count: fds.length,
        children: [],
        is_investment: false,
      };
      children.push(childItem);
      groupTotal += childItem.market_value_cny;

      // ── 关联券商内嵌（funding_account_id 指向本银行账户）──
      for (const ia of invAccounts) {
        if ((ia as any)._consumed || ia.funding_account_id !== acc.id) continue;
        (ia as any)._consumed = true;
        const mktCny = ia.total_market_value_cny || 0;
        children.push({
          id: ia.id, name: ia.name, asset_type: 'investment', type: 'investment_account',
          currency: ia.currency, balance: mktCny,
          bank_name: null, broker: ia.broker,
          card_number: null, display_alias: null,
          market_value_cny: mktCny, // 仅持仓市值；现金归入「券商流动金」独立类别
          cash_balance: ia.cash_balance,
          asset_count: ia.asset_count,
          total_profit_loss: ia.total_profit_loss_cny,
          children: [], is_investment: true,
        });
        groupTotal += mktCny;
      }
    }

    result.push({
      id: -(children[0]?.id || 1000), name: bankName,
      asset_type: 'bank', type: 'bank_card',
      currency: 'CNY', balance: groupTotal,
      bank_name: bankName, broker: null,
      card_number: null, display_alias: null,
      market_value_cny: groupTotal,
      children,
      is_investment: false,
    });
  }

  // 5. Investment accounts (brokers) — 仅未关联银行的券商保留为独立顶级项（仅持仓市值）
  for (const ia of invAccounts) {
    if ((ia as any)._consumed) continue;
    const mktCny = ia.total_market_value_cny || 0;
    result.push({
      id: ia.id, name: ia.name, asset_type: 'investment', type: 'investment_account',
      currency: ia.currency, balance: mktCny,
      bank_name: null, broker: ia.broker,
      card_number: null, display_alias: null,
      market_value_cny: mktCny, // 仅持仓市值；现金归入「券商流动金」
      cash_balance: ia.cash_balance,
      asset_count: ia.asset_count,
      total_profit_loss: ia.total_profit_loss_cny,
      children: [], is_investment: true,
    });
  }

  // 5.5 券商流动金（v1.5.8 独立类别：全部券商现金 CNY 合计，含关联银行的券商）
  {
    const brokerCashChildren: AssetSummaryItem[] = [];
    let brokerCashTotal = 0;
    for (const ia of invAccounts) {
      const cashCny = (ia.cash_balance || 0) * (ia.rate_to_cny || 1);
      if (cashCny === 0) continue;
      brokerCashTotal += cashCny;
      brokerCashChildren.push({
        id: ia.id, name: ia.name, asset_type: 'broker_cash', type: 'investment_account',
        currency: ia.currency, balance: ia.cash_balance || 0,
        bank_name: null, broker: ia.broker,
        card_number: null, display_alias: null,
        market_value_cny: cashCny,
        cash_balance: ia.cash_balance,
        asset_count: 0, total_profit_loss: 0,
        children: [], is_investment: false,
      });
    }
    if (brokerCashTotal > 0) {
      result.push({
        id: -3000, name: '券商流动金', asset_type: 'broker_cash', type: 'broker_cash',
        currency: 'CNY', balance: brokerCashTotal,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: brokerCashTotal,
        cash_balance: brokerCashTotal,
        asset_count: brokerCashChildren.length,
        total_profit_loss: 0,
        children: brokerCashChildren, is_investment: false,
      });
    }
  }

  // 5.6 银行理财（v1.6.0 独立投资类：挂在银行账户下的股票/基金/ETF 计入投资市值）
  {
    const wealthChildren: AssetSummaryItem[] = [];
    let wealthTotal = 0;
    for (const [accountId, list] of bankAssetsByAccount) {
      for (const ba of list) {
        const cny = ba.market_value * (ba.rate_to_cny || 1);
        wealthTotal += cny;
        wealthChildren.push({
          id: ba.id, name: ba.name, asset_type: 'bank_wealth', type: ba.type,
          currency: ba.currency, balance: ba.market_value,
          bank_name: ba.bank_name || null, broker: null,
          card_number: null, display_alias: null,
          market_value_cny: cny,
          cash_balance: 0,
          asset_count: 0,
          total_profit_loss: ba.profit_loss * (ba.rate_to_cny || 1),
          children: [], is_investment: true,
        });
      }
    }
    if (wealthTotal > 0) {
      result.push({
        id: -3100, name: '银行理财', asset_type: 'bank_wealth', type: 'bank_wealth',
        currency: 'CNY', balance: wealthTotal,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: wealthTotal,
        cash_balance: 0,
        asset_count: wealthChildren.length,
        total_profit_loss: wealthChildren.reduce((s: number, c: AssetSummaryItem) => s + (c.total_profit_loss || 0), 0),
        children: wealthChildren, is_investment: true,
      });
    }
  }

  // 5.7 债权（v1.7.3：别人欠我的未结金额计入资产，按币种折算 CNY）
  {
    const creditRow = db.prepare(`
      SELECT COALESCE(SUM(s.amount * COALESCE(c.rate_to_base, 1)), 0) as total
      FROM social_obligations s
      LEFT JOIN currencies c ON s.currency = c.code
      WHERE s.type = 'owed' AND s.status = 'pending'
    `).get() as { total: number };
    const creditTotal = creditRow.total;
    if (creditTotal > 0) {
      result.push({
        id: -3200, name: '债权', asset_type: 'credit', type: 'credit',
        currency: 'CNY', balance: creditTotal,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: creditTotal,
        cash_balance: 0, asset_count: 0, total_profit_loss: 0,
        children: [], is_investment: false,
      });
    }
  }

  // 5.8 债务（v1.7.3：我欠别人的未结金额冲减净资产，值为负；按币种折算 CNY）
  {
    const debtRow = db.prepare(`
      SELECT COALESCE(SUM(s.amount * COALESCE(c.rate_to_base, 1)), 0) as total
      FROM social_obligations s
      LEFT JOIN currencies c ON s.currency = c.code
      WHERE s.type = 'owe' AND s.status = 'pending'
    `).get() as { total: number };
    const debtTotal = debtRow.total;
    if (debtTotal > 0) {
      result.push({
        id: -3300, name: '债务', asset_type: 'debt', type: 'debt',
        currency: 'CNY', balance: debtTotal,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: -debtTotal, // 负值：冲减总资产
        cash_balance: 0, asset_count: 0, total_profit_loss: 0,
        children: [], is_investment: false,
      });
    }
  }

  // 6. Custom assets
  for (const acc of allAccounts) {
    if (acc.asset_type === 'custom') {
      result.push({
        id: acc.id, name: acc.name, asset_type: 'custom', type: acc.type,
        currency: acc.currency, balance: acc.balance,
        bank_name: null, broker: null,
        card_number: null, display_alias: null,
        market_value_cny: cnyMap.get(acc.id) || 0,
        children: [], is_investment: false,
      });
    }
  }

  return result;
}

/** Get all bank-type accounts for funding dropdowns */
export function listBankAccounts(): AccountRow[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM accounts WHERE asset_type = 'bank' AND is_active = 1 ORDER BY bank_name, sort_order, id"
  ).all() as AccountRow[];
}
