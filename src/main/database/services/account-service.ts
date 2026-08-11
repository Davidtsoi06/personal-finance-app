/**
 * Account service — CRUD operations for accounts table.
 * Supports parent-child hierarchy and multi-currency balances (v7).
 */
import { getDatabase } from '../index';

export interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string;
  balance: number;
  bank_name: string | null;
  card_number: string | null;
  asset_type: string;
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
    card_number: data.card_number || null,
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

    // Nullify asset links (keep the assets, just remove account linkage)
    db.prepare('UPDATE assets SET account_id = NULL WHERE account_id = ?').run(id);

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

  // Sync the main balance field on accounts (sum of all currency balances)
  const row = db.prepare(
    'SELECT COALESCE(SUM(balance), 0) as total FROM account_balances WHERE account_id = ?'
  ).get(accountId) as { total: number };
  db.prepare(
    "UPDATE accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(row.total, accountId);
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
  const row = db.prepare(
    'SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE is_active = 1'
  ).get() as any;
  return row.total;
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
  market_value_cny: number;
  children?: AssetSummaryItem[];
  is_investment: boolean;
}

/** Aggregate all asset types (accounts + investment accounts) for unified view. */
export function getAllAssetsSummary(): AssetSummaryItem[] {
  const db = getDatabase();

  // Fetch ALL active accounts (not just roots) so we can roll up child balances
  const allAccounts = db.prepare(`
    SELECT a.*, COALESCE(c.rate_to_base, 1) as rate_to_cny
    FROM accounts a
    LEFT JOIN currencies c ON a.currency = c.code
    WHERE a.is_active = 1
    ORDER BY a.asset_type, a.sort_order, a.id
  `).all() as (AccountRow & { rate_to_cny: number })[];
  type AccountWithRate = typeof allAccounts[0];

  // Separate roots from children; build child lookup map
  const roots: AccountWithRate[] = [];
  const childrenOf = new Map<number, AccountWithRate[]>();
  for (const acc of allAccounts) {
    if (acc.parent_account_id && acc.parent_account_id > 0) {
      const list = childrenOf.get(acc.parent_account_id) || [];
      list.push(acc);
      childrenOf.set(acc.parent_account_id, list);
    } else {
      roots.push(acc);
    }
  }

  /** Recursively sum an account's own balance + all descendants' balances */
  function totalBalanceWithChildren(acc: AccountWithRate): number {
    let total = acc.balance;
    const kids = childrenOf.get(acc.id);
    if (kids) {
      for (const child of kids) {
        total += totalBalanceWithChildren(child);
      }
    }
    return total;
  }

  // Fetch fixed deposits linked to bank accounts for investment classification
  const allFixedDeposits = db.prepare(`
    SELECT fd.*, a.currency as account_currency
    FROM fixed_deposits fd
    JOIN accounts a ON fd.account_id = a.id
    WHERE a.is_active = 1
  `).all() as any[];

  // Build fixed deposit lookup by account_id
  const fdsByAccount = new Map<number, any[]>();
  for (const fd of allFixedDeposits) {
    const list = fdsByAccount.get(fd.account_id) || [];
    list.push(fd);
    fdsByAccount.set(fd.account_id, list);
  }

  const invAccounts = db.prepare(`
    SELECT ia.*, COALESCE(c.rate_to_base, 1) as rate_to_cny,
      COALESCE(SUM(a.market_value), 0) as total_market_value
    FROM investment_accounts ia
    LEFT JOIN currencies c ON ia.currency = c.code
    LEFT JOIN assets a ON a.investment_account_id = ia.id
    GROUP BY ia.id
    ORDER BY ia.name
  `).all() as any[];

  const result: AssetSummaryItem[] = [];

  // Group root-level accounts by asset_type
  const accountGroups = new Map<string, AccountWithRate[]>();
  for (const acc of roots) {
    const list = accountGroups.get(acc.asset_type) || [];
    list.push(acc);
    accountGroups.set(acc.asset_type, list);
  }

  for (const [assetType, accList] of accountGroups) {
    if (assetType === 'investment') {
      // Investment-type accounts: show individually
      for (const acc of accList) {
        const bal = totalBalanceWithChildren(acc);
        result.push({
          id: acc.id,
          name: acc.name,
          asset_type: acc.asset_type,
          type: acc.type,
          currency: acc.currency,
          balance: bal,
          bank_name: acc.bank_name,
          broker: null,
          market_value_cny: bal * acc.rate_to_cny,
          children: [],
          is_investment: false,
        });
      }
    } else {
      // Bank/cash/insurance/custom: group by asset type
      const groupItem: AssetSummaryItem = {
        id: -Math.abs(accList[0]?.id || 1), // negative ID for virtual group
        name: assetType === 'bank' ? '银行账户' :
              assetType === 'cash' ? '现金' :
              assetType === 'insurance' ? '保险' :
              assetType === 'custom' ? '自定义资产' : assetType,
        asset_type: assetType,
        type: '',
        currency: 'CNY',
        balance: 0,
        bank_name: null,
        broker: null,
        market_value_cny: 0,
        children: [],
        is_investment: false,
      };
      for (const acc of accList) {
        const bal = totalBalanceWithChildren(acc);
        // Fixed deposits linked to this account — subtract from cash and classify as investment
        const accFds = fdsByAccount.get(acc.id) || [];
        const fdTotal = accFds.reduce((s: number, fd: any) => s + fd.amount, 0);
        const availableBal = bal - fdTotal;

        const childSummary: AssetSummaryItem = {
          id: acc.id,
          name: acc.name,
          asset_type: acc.asset_type,
          type: acc.type,
          currency: acc.currency,
          balance: availableBal,
          bank_name: acc.bank_name,
          broker: null,
          market_value_cny: availableBal * acc.rate_to_cny,
          children: [],
          is_investment: false,
        };

        // Add fixed deposits as investment sub-items under this account
        for (const fd of accFds) {
          childSummary.children!.push({
            id: -fd.id,
            name: `定期存款 · ${fd.currency} ${fd.amount.toLocaleString()}`,
            asset_type: 'investment',
            type: 'fixed_deposit',
            currency: fd.currency,
            balance: fd.amount,
            bank_name: null,
            broker: null,
            market_value_cny: fd.amount * acc.rate_to_cny,
            children: [],
            is_investment: true,
          });
        }

        groupItem.market_value_cny += childSummary.market_value_cny + fdTotal * acc.rate_to_cny;
        groupItem.balance += bal;
        groupItem.children!.push(childSummary);
      }
      result.push(groupItem);
    }
  }

  // Separate linked vs unlinked investment accounts
  const linkedInv = invAccounts.filter((ia: any) => ia.funding_account_id != null);
  const unlinkedInv = invAccounts.filter((ia: any) => !ia.funding_account_id);

  // Attach linked investment accounts to their funding bank accounts
  for (const ia of linkedInv) {
    const mktCny = (ia.total_market_value || 0) * (ia.rate_to_cny || 1);
    const childSummary: AssetSummaryItem = {
      id: ia.id,
      name: ia.name,
      asset_type: 'investment',
      type: 'investment_account',
      currency: ia.currency,
      balance: ia.total_market_value || 0,
      bank_name: null,
      broker: ia.broker,
      market_value_cny: mktCny,
      children: [],
      is_investment: true,
    };

    // Find the parent bank account in result groups and attach
    let found = false;
    for (const item of result) {
      if (item.children) {
        for (const child of item.children) {
          if (child.id === ia.funding_account_id) {
            child.children = child.children || [];
            child.children.push(childSummary);
            child.market_value_cny += mktCny;
            child.balance += ia.total_market_value || 0;
            item.market_value_cny += mktCny;
            item.balance += ia.total_market_value || 0;
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }

    // If funding account not found in groups, treat as unlinked
    if (!found) {
      unlinkedInv.push(ia);
    }
  }

  // Create investment group for unlinked investment accounts
  if (unlinkedInv.length > 0) {
    const invGroup: AssetSummaryItem = {
      id: -9999,
      name: '投资账户',
      asset_type: 'investment',
      type: '',
      currency: 'CNY',
      balance: 0,
      bank_name: null,
      broker: null,
      market_value_cny: 0,
      children: [],
      is_investment: true,
    };
    for (const ia of unlinkedInv) {
      const mktCny = (ia.total_market_value || 0) * (ia.rate_to_cny || 1);
      const childSummary: AssetSummaryItem = {
        id: ia.id,
        name: ia.name,
        asset_type: 'investment',
        type: 'investment_account',
        currency: ia.currency,
        balance: ia.total_market_value || 0,
        bank_name: null,
        broker: ia.broker,
        market_value_cny: mktCny,
        children: [],
        is_investment: true,
      };
      invGroup.market_value_cny += mktCny;
      invGroup.balance += ia.total_market_value || 0;
      invGroup.children!.push(childSummary);
    }
    result.push(invGroup);
  }

  return result;
}
