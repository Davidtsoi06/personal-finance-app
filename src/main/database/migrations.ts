/**
 * Database migrations — all CREATE TABLE statements.
 * Each migration has a version number for future incremental updates.
 * Optional migrate(db) function runs after the SQL for JS-based data migration.
 */
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  sql: string;
  /** Optional JavaScript migration logic (runs after SQL, inside transaction). */
  migrate?: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
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
  {
    version: 12,
    sql: `
      -- ============================================
      -- Migration v12: Asset hierarchy restructure
      -- ============================================

      -- 1. Insurance policies table (replaces asset_type='insurance' accounts)
      CREATE TABLE IF NOT EXISTS insurance_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        company TEXT,
        policy_number TEXT,
        type TEXT CHECK(type IN ('life','health','annuity','critical','accident','other')),
        annual_premium REAL DEFAULT 0,
        premium_currency TEXT DEFAULT 'CNY',
        cash_value REAL DEFAULT 0,
        cash_value_currency TEXT DEFAULT 'CNY',
        insured_person TEXT,
        start_date TEXT,
        premium_due_month INTEGER,
        premium_due_day INTEGER,
        account_id INTEGER REFERENCES accounts(id),
        notes TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 2. Premium payment records
      CREATE TABLE IF NOT EXISTS premium_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        policy_id INTEGER NOT NULL REFERENCES insurance_policies(id),
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'CNY',
        paid_date TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    migrate: (db) => {
      // 0) Add display_alias column if not exists (safe retry)
      const hasCol = db.prepare(
        "SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'display_alias'"
      ).get();
      if (!hasCol) {
        db.exec('ALTER TABLE accounts ADD COLUMN display_alias TEXT');
      }

      // a) Migrate insurance accounts → insurance_policies
      const insuranceAccounts = db.prepare(
        "SELECT * FROM accounts WHERE asset_type = 'insurance' AND is_active = 1"
      ).all() as any[];

      for (const acc of insuranceAccounts) {
        db.prepare(`
          INSERT INTO insurance_policies (name, cash_value, cash_value_currency, start_date, notes, company)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(acc.name, acc.balance || 0, acc.currency, acc.created_at, '从旧版保险账户自动迁移', acc.bank_name || null);
      }

      // b) Delete insurance accounts — clean ALL child tables before deleting parent
      if (insuranceAccounts.length > 0) {
        const insIds = insuranceAccounts.map((a: any) => a.id);
        for (const id of insIds) {
          db.prepare('DELETE FROM ledgers WHERE account_id = ?').run(id);
          db.prepare('DELETE FROM account_transactions WHERE account_id = ?').run(id);
          db.prepare('DELETE FROM fixed_deposits WHERE account_id = ?').run(id);
          db.prepare('DELETE FROM account_balances WHERE account_id = ?').run(id);
          // Nullify asset links (keep the assets, just remove account linkage)
          db.prepare('UPDATE assets SET account_id = NULL WHERE account_id = ?').run(id);
          // Nullify funding_account links on investment accounts
          db.prepare('UPDATE investment_accounts SET funding_account_id = NULL WHERE funding_account_id = ?').run(id);
        }
        db.prepare('DELETE FROM accounts WHERE asset_type = ?').run('insurance');
      }

      // c) Delete credit card accounts (feature removed)
      const ccIds = db.prepare("SELECT id FROM accounts WHERE type = 'credit_card'").all() as any[];
      if (ccIds.length > 0) {
        for (const row of ccIds) {
          db.prepare('DELETE FROM ledgers WHERE account_id = ?').run(row.id);
          db.prepare('DELETE FROM account_transactions WHERE account_id = ?').run(row.id);
          db.prepare('DELETE FROM fixed_deposits WHERE account_id = ?').run(row.id);
          db.prepare('DELETE FROM account_balances WHERE account_id = ?').run(row.id);
          db.prepare('UPDATE assets SET account_id = NULL WHERE account_id = ?').run(row.id);
          db.prepare('UPDATE investment_accounts SET funding_account_id = NULL WHERE funding_account_id = ?').run(row.id);
        }
        db.prepare("DELETE FROM accounts WHERE type = 'credit_card'").run();
      }

      // d) Promote child accounts to roots — copy bank_name from parent if missing
      const children = db.prepare(`
        SELECT a.id, a.bank_name as a_bank, p.bank_name as p_bank, p.name as p_name
        FROM accounts a
        LEFT JOIN accounts p ON a.parent_account_id = p.id
        WHERE a.parent_account_id IS NOT NULL
      `).all() as any[];

      for (const child of children) {
        const bankName = child.a_bank || child.p_bank || child.p_name || null;
        db.prepare(
          'UPDATE accounts SET parent_account_id = NULL, bank_name = COALESCE(?, bank_name) WHERE id = ?'
        ).run(bankName, child.id);
      }

      // e) Soft-delete empty parent containers (balance=0, no children left, asset_type='bank')
      // Use UPDATE is_active=0 instead of DELETE to avoid FOREIGN KEY constraint failures
      db.prepare(`
        UPDATE accounts SET is_active = 0 WHERE id IN (
          SELECT a.id FROM accounts a
          WHERE a.asset_type = 'bank'
            AND a.balance = 0
            AND a.id NOT IN (SELECT DISTINCT parent_account_id FROM accounts WHERE parent_account_id IS NOT NULL)
        )
      `).run();

      // f) Auto-create system wallets: 微信, 支付宝, 现金
      for (const [name, type, assetType] of [
        ['微信', 'online_pay', 'e_wallet'],
        ['支付宝', 'online_pay', 'e_wallet'],
        ['现金', 'cash', 'cash'],
      ]) {
        const exists = db.prepare(
          "SELECT id FROM accounts WHERE name = ? AND asset_type = ?"
        ).get(name, assetType);
        if (!exists) {
          db.prepare(`
            INSERT INTO accounts (name, type, asset_type, currency, balance, is_active, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, 'CNY', 0, 1, 0, datetime('now'), datetime('now'))
          `).run(name, type, assetType);
        }
      }

      // g) Flag: users with empty card_number need to fill in
      const emptyCards = db.prepare(
        "SELECT COUNT(*) as cnt FROM accounts WHERE type = 'bank_card' AND (card_number IS NULL OR card_number = '') AND is_active = 1"
      ).get() as any;
      if (emptyCards.cnt > 0) {
        db.prepare(
          "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('migration.v12.pending_card_numbers', ?, datetime('now'))"
        ).run(String(emptyCards.cnt));
      }
    },
  },
  {
    version: 13,
    sql: `
      -- ============================================
      -- Migration v13: 安全加固（JS 迁移完成实际数据转换）
      -- 1) accounts.card_number 截断为仅后 4 位
      -- 2) app_settings['ai.apiKey'] 明文 → AES-256-GCM 密文
      -- ============================================
      SELECT 1;
    `,
    migrate: (db) => {
      // a) 卡号仅保留后 4 位（去除空格/连字符后截断）
      db.exec(`
        UPDATE accounts
        SET card_number = substr(replace(replace(card_number, ' ', ''), '-', ''), -4)
        WHERE card_number IS NOT NULL
          AND length(replace(replace(card_number, ' ', ''), '-', '')) > 4
      `);

      // b) AI Key 明文升级为密文（已有 v1: 前缀的跳过）
      const { encryptText } = require('../services/crypto-util');
      const row = db.prepare(
        "SELECT value FROM app_settings WHERE key = 'ai.apiKey'"
      ).get() as { value: string } | undefined;
      if (row && row.value && !row.value.startsWith('v1:')) {
        db.prepare(
          "UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = 'ai.apiKey'"
        ).run(encryptText(row.value));
      }
    },
  },
  {
    version: 14,
    sql: [
      "-- ============================================",
      "-- Migration v14: 券商现金流水（现金余额改为流水派生）",
      "-- amount 带符号：deposit/sell/dividend 为正，withdraw/buy 为负，adjust 为差额",
      "-- ============================================",
      "CREATE TABLE IF NOT EXISTS investment_cash_flows (",
      "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "  investment_account_id INTEGER NOT NULL REFERENCES investment_accounts(id),",
      "  type TEXT NOT NULL CHECK(type IN ('deposit','withdraw','buy','sell','dividend','adjust')),",
      "  amount REAL NOT NULL DEFAULT 0,",
      "  asset_id INTEGER REFERENCES assets(id),",
      "  transaction_id INTEGER REFERENCES transactions(id),",
      "  currency TEXT NOT NULL DEFAULT 'CNY',",
      "  date TEXT NOT NULL DEFAULT (date('now')),",
      "  notes TEXT,",
      "  balance_after REAL,",
      "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_cash_flows_account ON investment_cash_flows(investment_account_id, date);",
    ].join("\n"),
    migrate: (db) => {
      // 期初快照：为每个有现金余额的券商账户插入一条 adjust 流水（保留现有数值，历史从今天起记录）
      const rows = db.prepare(
        'SELECT id, cash_balance, currency FROM investment_accounts WHERE cash_balance != 0'
      ).all() as any[];
      const insert = db.prepare([
        "INSERT INTO investment_cash_flows",
        "(investment_account_id, type, amount, currency, date, notes, balance_after)",
        "VALUES (?, 'adjust', ?, ?, date('now'), ?, ?)",
      ].join(" "));
      for (const r of rows) {
        insert.run(r.id, r.cash_balance, r.currency || 'CNY', '迁移前余额快照（现金流水功能上线）', r.cash_balance);
      }
    },
  },
  {
    version: 15,
    sql: [
      '-- ============================================',
      '-- Migration v15: 孤儿持仓检测（删除券商遗留的无归属持仓计数，供投资页提示修复）',
      '-- ============================================',
      'SELECT 1;',
    ].join('\n'),
    migrate: (db) => {
      const count = db.prepare(
        'SELECT COUNT(*) as c FROM assets WHERE investment_account_id IS NULL AND account_id IS NULL'
      ).get() as { c: number };
      db.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('orphan_assets.count', ?, datetime('now'))"
      ).run(String(count.c));
    },
  },
  {
    version: 16,
    sql: [
      "-- ============================================",
      "-- Migration v16: 定期存款资金交互改为询问式",
      "-- deduct_mode: deduct（从账户扣款）/ record_only（单纯记录，不动余额）",
      "-- deduct_account_id: 实际资金变动的账户（可为空）",
      "-- ============================================",
      "ALTER TABLE fixed_deposits ADD COLUMN deduct_mode TEXT NOT NULL DEFAULT 'deduct' CHECK(deduct_mode IN ('deduct','record_only'));",
      "ALTER TABLE fixed_deposits ADD COLUMN deduct_account_id INTEGER;",
    ].join("\n"),
    migrate: (db) => {
      // 存量定存都是「自动扣款」创建：deduct_account_id 回填为归属账户
      db.prepare(
        "UPDATE fixed_deposits SET deduct_account_id = account_id WHERE deduct_mode = 'deduct' AND deduct_account_id IS NULL"
      ).run();
    },
  },
];
