/**
 * Insurance policy service — CRUD for insurance_policies table.
 * Manages policies, premium payments, and due-date reminders.
 */
import { getDatabase } from '../index';

export interface InsurancePolicyRow {
  id: number;
  name: string;
  company: string | null;
  policy_number: string | null;
  type: 'life' | 'health' | 'annuity' | 'critical' | 'accident' | 'other';
  annual_premium: number;
  premium_currency: string;
  cash_value: number;
  cash_value_currency: string;
  insured_person: string | null;
  start_date: string | null;
  premium_due_month: number | null;
  premium_due_day: number | null;
  account_id: number | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PremiumPaymentRow {
  id: number;
  policy_id: number;
  amount: number;
  currency: string;
  paid_date: string;
  account_id: number | null;
  notes: string | null;
  created_at: string;
}

// ── Policy CRUD ──

export function listPolicies(includeInactive = false): InsurancePolicyRow[] {
  const db = getDatabase();
  const filter = includeInactive ? '' : 'WHERE is_active = 1';
  return db.prepare(`SELECT * FROM insurance_policies ${filter} ORDER BY created_at DESC`).all() as InsurancePolicyRow[];
}

export function getPolicy(id: number): InsurancePolicyRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM insurance_policies WHERE id = ?').get(id) as InsurancePolicyRow | undefined;
}

export function createPolicy(data: {
  name: string;
  company?: string;
  policy_number?: string;
  type?: string;
  annual_premium?: number;
  premium_currency?: string;
  cash_value?: number;
  cash_value_currency?: string;
  insured_person?: string;
  start_date?: string;
  premium_due_month?: number;
  premium_due_day?: number;
  account_id?: number | null;
  notes?: string;
}): InsurancePolicyRow {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO insurance_policies (name, company, policy_number, type, annual_premium, premium_currency,
      cash_value, cash_value_currency, insured_person, start_date, premium_due_month, premium_due_day,
      account_id, notes)
    VALUES (@name, @company, @policy_number, @type, @annual_premium, @premium_currency,
      @cash_value, @cash_value_currency, @insured_person, @start_date, @premium_due_month, @premium_due_day,
      @account_id, @notes)
  `);
  const result = stmt.run({
    name: data.name,
    company: data.company || null,
    policy_number: data.policy_number || null,
    type: data.type || 'other',
    annual_premium: data.annual_premium || 0,
    premium_currency: data.premium_currency || 'CNY',
    cash_value: data.cash_value || 0,
    cash_value_currency: data.cash_value_currency || 'CNY',
    insured_person: data.insured_person || null,
    start_date: data.start_date || null,
    premium_due_month: data.premium_due_month || null,
    premium_due_day: data.premium_due_day || null,
    account_id: data.account_id || null,
    notes: data.notes || null,
  });
  return getPolicy(result.lastInsertRowid as number) as InsurancePolicyRow;
}

export function updatePolicy(id: number, data: Partial<InsurancePolicyRow>): InsurancePolicyRow | undefined {
  const db = getDatabase();
  const existing = getPolicy(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...data, id, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE insurance_policies SET name=?, company=?, policy_number=?, type=?, annual_premium=?,
      premium_currency=?, cash_value=?, cash_value_currency=?, insured_person=?, start_date=?,
      premium_due_month=?, premium_due_day=?, account_id=?, notes=?, is_active=?, updated_at=?
    WHERE id=?
  `).run(
    merged.name, merged.company, merged.policy_number, merged.type, merged.annual_premium,
    merged.premium_currency, merged.cash_value, merged.cash_value_currency, merged.insured_person,
    merged.start_date, merged.premium_due_month, merged.premium_due_day,
    merged.account_id, merged.notes, merged.is_active, merged.updated_at, id
  );
  return getPolicy(id);
}

export function deletePolicy(id: number): boolean {
  const db = getDatabase();
  // Delete premium payments first
  db.prepare('DELETE FROM premium_payments WHERE policy_id = ?').run(id);
  const result = db.prepare('DELETE FROM insurance_policies WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Premium Payments ──

/** Pay a premium: records payment, updates cash_value, creates bank withdrawal + ledger entry. */
export function payPremium(data: {
  policy_id: number;
  amount: number;
  currency?: string;
  paid_date?: string;
  account_id?: number;
  notes?: string;
}): PremiumPaymentRow {
  const db = getDatabase();
  const currency = data.currency || 'CNY';
  const paidDate = data.paid_date || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    // 1. Insert payment record
    const stmt = db.prepare(`
      INSERT INTO premium_payments (policy_id, amount, currency, paid_date, account_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(data.policy_id, data.amount, currency, paidDate, data.account_id || null, data.notes || null);

    // 2. Update policy cash_value
    db.prepare(
      "UPDATE insurance_policies SET cash_value = cash_value + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(data.amount, data.policy_id);

    // Advance next premium due date by one year
    const policy = getPolicy(data.policy_id);
    if (policy && policy.premium_due_month && policy.premium_due_day) {
      // Next due date is same month/day next year
      // Keep same month/day — no change needed unless we track year
    }

    // 3. If a bank account is specified, create withdrawal record
    if (data.account_id) {
      const { updateAccountBalance } = require('./account-service');
      updateAccountBalance(data.account_id, currency, -data.amount);
      db.prepare("UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(data.amount, data.account_id);

      db.prepare(`
        INSERT INTO account_transactions (account_id, type, amount, currency, date, notes)
        VALUES (?, 'withdraw', ?, ?, ?, ?)
      `).run(data.account_id, data.amount, currency, paidDate, `保费缴纳 · ${policy?.name || '未知保单'}`);

      // 4. Record ledger entry (expense)
      const policyName = policy?.name || '未知保单';
      db.prepare(`
        INSERT INTO ledgers (type, amount, currency, account_id, date, description, category_id)
        VALUES ('expense', ?, ?, ?, ?, ?, (SELECT id FROM categories WHERE name = '保险' AND type = 'expense' LIMIT 1))
      `).run(data.amount, currency, data.account_id, paidDate, `保费-${policyName}`);
    }

    return result.lastInsertRowid as number;
  });

  const newId = tx();
  return db.prepare('SELECT * FROM premium_payments WHERE id = ?').get(newId) as PremiumPaymentRow;
}

/** Get payment history for a policy. */
export function listPayments(policyId: number): PremiumPaymentRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM premium_payments WHERE policy_id = ? ORDER BY paid_date DESC'
  ).all(policyId) as PremiumPaymentRow[];
}

/** Get total cash value across all active policies. */
export function getTotalCashValue(): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COALESCE(SUM(cash_value), 0) as total FROM insurance_policies WHERE is_active = 1'
  ).get() as any;
  return row.total;
}

/** Get policies with premium due on given month/day. */
export function getDuePolicies(month: number, day: number): InsurancePolicyRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM insurance_policies WHERE is_active = 1 AND premium_due_month = ? AND premium_due_day = ?'
  ).all(month, day) as InsurancePolicyRow[];
}
