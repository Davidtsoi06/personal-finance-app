/**
 * Database migrations — all CREATE TABLE statements.
 * Each migration has a version number for future incremental updates.
 */

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      -- ============================================
      -- Migration v1: Core tables
      -- ============================================

      CREATE TABLE IF NOT EXISTS currencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        rate_to_base REAL NOT NULL DEFAULT 1.0,
        is_base INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        rate REAL NOT NULL,
        date TEXT NOT NULL DEFAULT (date('now'))
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('cash','bank_card','credit_card','online_pay')),
        currency TEXT NOT NULL DEFAULT 'CNY',
        balance REAL NOT NULL DEFAULT 0,
        bank_name TEXT,
        card_number TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('income','expense')),
        parent_id INTEGER REFERENCES categories(id),
        icon TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('stock','fund','etf','gold','crypto','fixed_deposit')),
        market TEXT NOT NULL DEFAULT 'other' CHECK(market IN ('a_stock','hk_stock','us_stock','other')),
        currency TEXT NOT NULL DEFAULT 'CNY',
        quantity REAL NOT NULL DEFAULT 0,
        cost_price REAL NOT NULL DEFAULT 0,
        current_price REAL NOT NULL DEFAULT 0,
        market_value REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        profit_loss REAL NOT NULL DEFAULT 0,
        profit_loss_pct REAL NOT NULL DEFAULT 0,
        account_id INTEGER REFERENCES accounts(id),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS asset_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL REFERENCES assets(id),
        price REAL NOT NULL,
        date TEXT NOT NULL DEFAULT (date('now'))
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL REFERENCES assets(id),
        type TEXT NOT NULL CHECK(type IN ('buy','sell','dividend','split')),
        quantity REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        fee REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        date TEXT NOT NULL DEFAULT (date('now')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ledgers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('income','expense')),
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        category_id INTEGER REFERENCES categories(id),
        subcategory_id INTEGER REFERENCES categories(id),
        account_id INTEGER REFERENCES accounts(id),
        date TEXT NOT NULL DEFAULT (date('now')),
        description TEXT NOT NULL DEFAULT '',
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS borrow_lending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('borrow','lend')),
        counter_party TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        interest_rate REAL NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL DEFAULT (date('now')),
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','repaid','overdue')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS gift_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('give','receive')),
        person TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        event TEXT,
        date TEXT NOT NULL DEFAULT (date('now')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    sql: `
      -- ============================================
      -- Migration v2: Investment accounts & net worth
      -- ============================================

      CREATE TABLE IF NOT EXISTS investment_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        broker TEXT,
        currency TEXT NOT NULL DEFAULT 'CNY',
        account_number TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Add investment_account_id to assets
      ALTER TABLE assets ADD COLUMN investment_account_id INTEGER REFERENCES investment_accounts(id);

      CREATE TABLE IF NOT EXISTS net_worth_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        total_cash REAL NOT NULL DEFAULT 0,
        total_investments REAL NOT NULL DEFAULT 0,
        net_worth REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 3,
    sql: `
      -- ============================================
      -- Migration v3: Account transactions
      -- ============================================

      CREATE TABLE IF NOT EXISTS account_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        type TEXT NOT NULL CHECK(type IN ('deposit','withdraw')),
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        date TEXT NOT NULL DEFAULT (date('now')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 4,
    sql: `
      -- ============================================
      -- Migration v4: Custom statement formats
      -- ============================================

      CREATE TABLE IF NOT EXISTS custom_statement_formats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        keywords TEXT NOT NULL,
        column_mapping TEXT NOT NULL,
        has_header INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 5,
    sql: `
      -- ============================================
      -- Migration v5: Smart features & cleanup
      -- ============================================

      -- App settings (KV store for AI config, etc.)
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Monthly budgets
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        month TEXT NOT NULL,
        notify_at REAL NOT NULL DEFAULT 0.8,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Alert configuration (price change / budget)
      CREATE TABLE IF NOT EXISTS alert_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('price_drop','price_surge','budget_warning')),
        enabled INTEGER NOT NULL DEFAULT 1,
        threshold REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Drop dead tables (no UI, no service, zero usage)
      DROP TABLE IF EXISTS borrow_lending;
      DROP TABLE IF EXISTS gift_records;

      -- Seed default alert config
      INSERT OR IGNORE INTO alert_config (id, type, enabled, threshold) VALUES (1, 'price_drop', 1, 5.0);
      INSERT OR IGNORE INTO alert_config (id, type, enabled, threshold) VALUES (2, 'price_surge', 0, 10.0);
    `,
  },
  {
    version: 6,
    sql: `
      -- ============================================
      -- Migration v6: Social obligations (人情债)
      -- ============================================

      CREATE TABLE IF NOT EXISTS social_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('owe', 'owed')),
        person TEXT NOT NULL,
        item TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 7,
    sql: `
      -- ============================================
      -- Migration v7: Account hierarchy + multi-currency
      -- ============================================

      -- Add parent account support for bank → sub-account tree
      ALTER TABLE accounts ADD COLUMN parent_account_id INTEGER REFERENCES accounts(id);

      -- Multi-currency balance table
      CREATE TABLE IF NOT EXISTS account_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        currency TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, currency)
      );

      -- Migrate existing balances to account_balances
      INSERT OR IGNORE INTO account_balances (account_id, currency, balance)
      SELECT id, currency, balance FROM accounts WHERE balance != 0;
    `,
  },
  {
    version: 8,
    sql: `
      -- ============================================
      -- Migration v8: Asset type classification
      -- ============================================

      -- Add asset_type column for high-level asset classification
      -- Values: bank, cash, insurance, investment, custom
      -- Kept separate from "type" (payment method: bank_card, credit_card, online_pay)
      ALTER TABLE accounts ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'bank';

      -- Infer asset_type from existing type column
      UPDATE accounts SET asset_type = 'bank' WHERE type IN ('bank_card', 'credit_card');
      UPDATE accounts SET asset_type = 'cash' WHERE type = 'cash';
      UPDATE accounts SET asset_type = 'custom' WHERE type = 'online_pay';
    `,
  },
  {
    version: 9,
    sql: `
      -- ============================================
      -- Migration v9: Custom bank statement formats
      -- ============================================

      CREATE TABLE IF NOT EXISTS custom_bank_formats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        keywords TEXT NOT NULL,
        column_mapping TEXT NOT NULL,
        has_header INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 10,
    sql: `
      -- ============================================
      -- Migration v10: Investment account ↔ bank account linkage
      -- ============================================

      ALTER TABLE investment_accounts ADD COLUMN funding_account_id INTEGER REFERENCES accounts(id);
    `,
  },
  {
    version: 11,
    sql: `
      -- ============================================
      -- Migration v11: Broker cash balance + fixed deposits + account tx linking
      -- ============================================

      ALTER TABLE investment_accounts ADD COLUMN cash_balance REAL NOT NULL DEFAULT 0;

      ALTER TABLE account_transactions ADD COLUMN investment_account_id INTEGER REFERENCES investment_accounts(id);

      CREATE TABLE IF NOT EXISTS fixed_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        interest_rate REAL NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL,
        maturity_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
