/**
 * Budget service — monthly budget CRUD and status queries.
 */
import { getDatabase } from '../index';

export interface BudgetRow {
  id: number;
  name: string;
  amount: number;
  currency: string;
  month: string;        // '2026-08'
  notify_at: number;    // 0.0 - 1.0
  created_at: string;
  updated_at: string;
}

export interface BudgetStatus {
  budget: BudgetRow | null;
  totalSpent: number;
  remaining: number;
  percent: number;       // 0-100+
  daysInMonth: number;
  daysRemaining: number;
  dailyAvailable: number;
  isOverBudget: boolean;
  isOverWarning: boolean;
}

// ── CRUD ──

export function listBudgets(month?: string): BudgetRow[] {
  const db = getDatabase();
  if (month) {
    return db.prepare('SELECT * FROM budgets WHERE month = ? ORDER BY id').all(month) as BudgetRow[];
  }
  return db.prepare('SELECT * FROM budgets ORDER BY month DESC, id').all() as BudgetRow[];
}

export function getBudget(id: number): BudgetRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as BudgetRow | undefined;
}

export function createBudget(data: { name: string; amount: number; month: string; currency?: string; notify_at?: number }): BudgetRow {
  const db = getDatabase();
  const result = db.prepare(
    'INSERT INTO budgets (name, amount, currency, month, notify_at) VALUES (?, ?, ?, ?, ?)'
  ).run(data.name, data.amount, data.currency || 'CNY', data.month, data.notify_at ?? 0.8);
  return getBudget(result.lastInsertRowid as number)!;
}

export function updateBudget(id: number, data: { name?: string; amount?: number; notify_at?: number }): BudgetRow | undefined {
  const db = getDatabase();
  const existing = getBudget(id);
  if (!existing) return undefined;

  const name = data.name ?? existing.name;
  const amount = data.amount ?? existing.amount;
  const notifyAt = data.notify_at ?? existing.notify_at;

  db.prepare(
    'UPDATE budgets SET name = ?, amount = ?, notify_at = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name, amount, notifyAt, id);
  return getBudget(id);
}

export function deleteBudget(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
}

// ── Status ──

export function getBudgetStatus(month: string): BudgetStatus {
  const db = getDatabase();
  const budget = db.prepare(
    'SELECT * FROM budgets WHERE month = ? ORDER BY id LIMIT 1'
  ).get(month) as BudgetRow | undefined;

  // Total expenses for this month
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledgers
     WHERE type = 'expense' AND strftime('%Y-%m', date) = ?`
  ).get(month) as { total: number };

  const totalSpent = row.total;
  const amount = budget?.amount || 0;

  // Days calculation
  const [y, m] = month.split('-').map(Number);
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === y && (now.getMonth() + 1) === m;
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysRemaining = isCurrentMonth ? daysInMonth - now.getDate() + 1 : 0;

  const remaining = amount - totalSpent;
  const percent = amount > 0 ? (totalSpent / amount) * 100 : 0;
  const dailyAvailable = daysRemaining > 0 ? remaining / daysRemaining : 0;
  const notifyAt = (budget?.notify_at ?? 0.8) * 100;

  return {
    budget: budget || null,
    totalSpent,
    remaining,
    percent: Math.round(percent * 10) / 10,
    daysInMonth,
    daysRemaining: Math.max(0, daysRemaining),
    dailyAvailable: Math.max(0, Math.round(dailyAvailable * 100) / 100),
    isOverBudget: amount > 0 && totalSpent > amount,
    isOverWarning: amount > 0 && percent >= notifyAt,
  };
}
