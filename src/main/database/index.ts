/**
 * Database initialization and connection management.
 */
import path = require('path');
import { app } from 'electron';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

let db: Database.Database | null = null;

/** Get the database file path in the user's app data directory */
function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'finance.db');
}

/** Initialize the database: create tables and run migrations */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run all migrations
  runMigrations(db);

  // Seed default data if tables are empty
  seedDefaults(db);

  return db;
}

/** Apply pending migrations */
function runMigrations(database: Database.Database): void {
  // Create migrations tracking table
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .prepare('SELECT version FROM _migrations')
      .all()
      .map((row: any) => row.version)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      // Wrap each migration in a transaction for atomicity
      database.exec('BEGIN');
      try {
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO _migrations (version) VALUES (?)')
          .run(migration.version);
        database.exec('COMMIT');
      } catch (err) {
        database.exec('ROLLBACK');
        throw err;
      }
    }
  }
}

/** Insert default currencies and categories if empty */
function seedDefaults(database: Database.Database): void {
  // Seed default currencies
  const currencyCount = database.prepare('SELECT COUNT(*) as count FROM currencies').get() as any;
  if (currencyCount.count === 0) {
    const insert = database.prepare(
      'INSERT INTO currencies (code, name, symbol, rate_to_base, is_base) VALUES (?, ?, ?, ?, ?)'
    );
    const currencies = [
      ['CNY', '人民币', '¥', 1.0, 1],
      ['HKD', '港币', 'HK$', 0.92, 0],
      ['USD', '美元', '$', 7.25, 0],
      ['EUR', '欧元', '€', 7.85, 0],
      ['JPY', '日元', '¥', 0.048, 0],
      ['GBP', '英镑', '£', 9.2, 0],
    ];
    for (const c of currencies) {
      insert.run(...c);
    }
  }

  // Seed default categories
  const categoryCount = database.prepare('SELECT COUNT(*) as count FROM categories').get() as any;
  if (categoryCount.count === 0) {
    const insert = database.prepare(
      'INSERT INTO categories (name, type, parent_id, icon, sort_order, is_default) VALUES (?, ?, ?, ?, ?, 1)'
    );

    const expenseCategories = [
      ['餐饮', 'expense', null, '🍽️', 1],
      ['交通', 'expense', null, '🚗', 2],
      ['购物', 'expense', null, '🛒', 3],
      ['娱乐', 'expense', null, '🎮', 4],
      ['居住', 'expense', null, '🏠', 5],
      ['医疗', 'expense', null, '🏥', 6],
      ['教育', 'expense', null, '📚', 7],
      ['人情', 'expense', null, '🎁', 8],
      ['投资', 'expense', null, '📈', 9],
      ['其他支出', 'expense', null, '💸', 10],
    ];

    const incomeCategories = [
      ['工资', 'income', null, '💼', 1],
      ['奖金', 'income', null, '🏆', 2],
      ['投资收入', 'income', null, '💰', 3],
      ['兼职', 'income', null, '🔧', 4],
      ['礼金收入', 'income', null, '🧧', 5],
      ['其他收入', 'income', null, '📥', 6],
    ];

    for (const c of expenseCategories) {
      insert.run(...c);
    }
    for (const c of incomeCategories) {
      insert.run(...c);
    }
  }
}

/** Get the database instance (must call initDatabase first) */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/** Close the database connection */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
