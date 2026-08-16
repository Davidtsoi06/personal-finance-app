import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import { payPremium, getTotalCashValue } from '../../src/main/database/services/insurance-service';
import { importWalletBills } from '../../src/main/database/services/account-transaction-service';
import { deleteAsset, getAsset } from '../../src/main/database/services/asset-service';
import { createTransaction, getTransaction } from '../../src/main/database/services/transaction-service';
import { updateAccount, getAccount, getAllAssetsSummary } from '../../src/main/database/services/account-service';
import { getMonthlySummary } from '../../src/main/database/services/ledger-service';
import { getBudgetStatus } from '../../src/main/database/services/budget-service';
import { updateRate, convertAmount } from '../../src/main/database/services/currency-service';

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(d);
      d.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
  setDatabaseForTest(d);
  return d;
}

function seedAccount(balance = 100000, currency = 'CNY'): number {
  const r = db.prepare(
    "INSERT INTO accounts (name, type, asset_type, currency, balance) VALUES ('测试卡', 'bank_card', 'bank', ?, ?)"
  ).run(currency, balance);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)').run(id, currency, balance);
  return id;
}

function seedCurrency(code: string, rate: number): void {
  db.prepare('INSERT INTO currencies (code, name, symbol, rate_to_base, is_base) VALUES (?, ?, ?, ?, 0)').run(code, code, code, rate);
}

function bucket(accountId: number, currency: string): number {
  const r = db.prepare('SELECT balance FROM account_balances WHERE account_id = ? AND currency = ?').get(accountId, currency) as any;
  return r ? r.balance : 0;
}

describe('批 1 数据正确性回归（v1.7.1）', () => {
  beforeEach(() => { db = freshDb(); });

  it('P0 保费缴纳不再双重扣减余额', () => {
    const acc = seedAccount(100000);
    const pid = Number(db.prepare("INSERT INTO insurance_policies (name, annual_premium, premium_currency, cash_value, cash_value_currency, is_active) VALUES ('寿险', 12000, 'CNY', 0, 'CNY', 1)").run().lastInsertRowid);
    payPremium({ policy_id: pid, amount: 1000, currency: 'CNY', account_id: acc });
    const row = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc) as any;
    expect(row.balance).toBeCloseTo(99000, 2);
    expect(bucket(acc, 'CNY')).toBeCloseTo(99000, 2);
  });

  it('P1 钱包账单导入同步账户余额（原币种）', () => {
    const acc = seedAccount(1000);
    const r = importWalletBills(acc, [
      { date: '2026-08-16', type: 'income', amount: 100, currency: 'CNY', description: '红包' },
      { date: '2026-08-16', type: 'expense', amount: 30, currency: 'CNY', description: '餐饮' },
    ]);
    expect(r.imported).toBe(2);
    expect(bucket(acc, 'CNY')).toBeCloseTo(1070, 2);
    const row = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc) as any;
    expect(row.balance).toBeCloseTo(1070, 2);
  });

  it('P1 删除持仓级联清理现金流水（外键不再失败）', () => {
    const inv = Number(db.prepare("INSERT INTO investment_accounts (name, broker, currency, cash_balance) VALUES ('富途', '富途', 'HKD', 0)").run().lastInsertRowid);
    const asset = Number(db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id) VALUES ('腾讯', '00700', 'stock', 'hk_stock', 'HKD', 100, 300, 300, 30000, 30000, 0, 0, ?)").run(inv).lastInsertRowid);
    const tx = Number(db.prepare("INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date) VALUES (?, 'buy', 100, 300, 5, 30005, 'HKD', '2026-08-10')").run(asset).lastInsertRowid);
    db.prepare("INSERT INTO investment_cash_flows (investment_account_id, type, amount, asset_id, transaction_id, currency, date) VALUES (?, 'buy', -30005, ?, ?, 'HKD', '2026-08-10')").run(inv, asset, tx);
    expect(deleteAsset(asset)).toBe(true);
    expect(getAsset(asset)).toBeUndefined();
    const flows = db.prepare('SELECT COUNT(*) as c FROM investment_cash_flows WHERE asset_id = ?').get(asset) as any;
    expect(flows.c).toBe(0);
  });

  it('P0 卖出交易 total_amount = 数量×价格 − 手续费', () => {
    const inv = Number(db.prepare("INSERT INTO investment_accounts (name, broker, currency, cash_balance) VALUES ('富途', '富途', 'HKD', 0)").run().lastInsertRowid);
    const asset = Number(db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id) VALUES ('腾讯', '00700', 'stock', 'hk_stock', 'HKD', 100, 300, 300, 30000, 30000, 0, 0, ?)").run(inv).lastInsertRowid);
    const id = Number(createTransaction({ asset_id: asset, type: 'sell', quantity: 100, price: 10, fee: 5, currency: 'HKD' }).id);
    const tx = getTransaction(id)!;
    expect(tx.total_amount).toBeCloseTo(995, 2);
  });

  it('P1 编辑账户余额/币种同步 account_balances', () => {
    seedCurrency('USD', 7.25);
    const acc = seedAccount(50000);
    updateAccount(acc, { balance: 60000 });
    expect(bucket(acc, 'CNY')).toBeCloseTo(60000, 2);
    expect((db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc) as any).balance).toBeCloseTo(60000, 2);
    // 币种变化：CNY 桶移除、USD 桶建立、balance 按汇率折算
    updateAccount(acc, { currency: 'USD', balance: 1000 });
    expect(bucket(acc, 'CNY')).toBeCloseTo(0, 2);
    expect(bucket(acc, 'USD')).toBeCloseTo(1000, 2);
    expect((db.prepare('SELECT balance FROM accounts WHERE id = ?').get(acc) as any).balance).toBeCloseTo(7250, 2);
  });

  it('P2 汇率 0/负值被拒绝、换汇除零报错', () => {
    db.prepare("INSERT INTO currencies (code, name, symbol, rate_to_base, is_base) VALUES ('CNY', '人民币', '¥', 1, 1)").run();
    seedCurrency('USD', 7.25);
    expect(() => updateRate('USD', 0)).toThrow();
    expect(() => updateRate('USD', -1)).toThrow();
    expect(() => updateRate('USD', NaN)).toThrow();
    db.prepare("UPDATE currencies SET rate_to_base = 0 WHERE code = 'USD'").run();
    expect(() => convertAmount(100, 'USD', 'CNY')).toThrow();
  });

  it('P2 月度收支按币种折算 CNY', () => {
    seedCurrency('USD', 7.25);
    const acc = seedAccount(100000);
    db.prepare("INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES ('income', 100, 'CNY', ?, '2026-08-10', '工资')").run(acc);
    db.prepare("INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES ('income', 10, 'USD', ?, '2026-08-11', '美元收入')").run(acc);
    const s = getMonthlySummary(2026, 8);
    expect(s.income).toBeCloseTo(172.5, 2);
    expect(s.expense).toBeCloseTo(0, 2);
  });

  it('P2 预算支出按币种折算 CNY', () => {
    seedCurrency('USD', 7.25);
    db.prepare("INSERT INTO budgets (name, amount, currency, month) VALUES ('总预算', 1000, 'CNY', '2026-08')").run();
    const acc = seedAccount(100000);
    db.prepare("INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES ('expense', 100, 'CNY', ?, '2026-08-10', '餐饮')").run(acc);
    db.prepare("INSERT INTO ledgers (type, amount, currency, account_id, date, description) VALUES ('expense', 10, 'USD', ?, '2026-08-11', '美元支出')").run(acc);
    const status = getBudgetStatus('2026-08');
    expect(status.totalSpent).toBeCloseTo(172.5, 2);
  });

  it('v1.7.3 债务债权计入资产总览：债权正值、债务负值（按币种折算）', () => {
    seedCurrency('USD', 7.25);
    db.prepare("INSERT INTO social_obligations (type, person, item, status, amount, currency) VALUES ('owed', '李四', '借款给他', 'pending', 500, 'USD')").run();
    db.prepare("INSERT INTO social_obligations (type, person, item, status, amount, currency) VALUES ('owe', '王五', '借他的钱', 'pending', 2000, 'CNY')").run();
    db.prepare("INSERT INTO social_obligations (type, person, item, status, amount, currency) VALUES ('owed', '赵六', '已还清', 'done', 999, 'CNY')").run();
    const summary = getAllAssetsSummary();
    const credit = summary.find((i) => i.asset_type === 'credit');
    const debt = summary.find((i) => i.asset_type === 'debt');
    expect(credit!.name).toBe('债权');
    expect(debt!.name).toBe('债务');
    expect(credit).toBeTruthy();
    expect(credit!.market_value_cny).toBeCloseTo(3625, 2); // 500 USD × 7.25，done 不计
    expect(debt).toBeTruthy();
    expect(debt!.market_value_cny).toBeCloseTo(-2000, 2);
  });

  it('P2 保单现金价值按币种折算 CNY', () => {
    seedCurrency('USD', 7.25);
    db.prepare("INSERT INTO insurance_policies (name, annual_premium, premium_currency, cash_value, cash_value_currency, is_active) VALUES ('美元保单', 100, 'USD', 100, 'USD', 1)").run();
    expect(getTotalCashValue()).toBeCloseTo(725, 2);
  });
});