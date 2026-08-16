import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import {
  createFixedDepositInDb, updateFixedDepositInDb, deleteFixedDepositInDb,
  settleFixedDepositInDb, getFixedDepositInDb,
} from '../../src/main/database/services/fixed-deposit-core';

/** 纯 DB 环境：跑全部迁移（跳过 v13 的 electron 依赖 migrate） */
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

function seedAccount(db: Database.Database, name: string, balance = 100000): number {
  const r = db.prepare(
    "INSERT INTO accounts (name, type, asset_type, currency, balance) VALUES (?, 'bank_card', 'bank', 'CNY', ?)"
  ).run(name, balance);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)').run(id, 'CNY', balance);
  return id;
}

function accountBalance(db: Database.Database, accountId: number): number {
  const b = db.prepare('SELECT balance FROM account_balances WHERE account_id = ? AND currency = ?').get(accountId, 'CNY') as any;
  return b ? b.balance : 0;
}

function txsFor(db: Database.Database, accountId: number): any[] {
  return db.prepare('SELECT * FROM account_transactions WHERE account_id = ? ORDER BY id').all(accountId);
}

describe('定期存款联动询问式（v1.6.1）', () => {
  it('创建扣款型：扣余额 + 写存取记录（withdraw）', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    expect(fd.deduct_mode).toBe('deduct');
    expect(fd.status).toBe('active');
    expect(accountBalance(db, acc)).toBeCloseTo(90000, 2);
    const txs = txsFor(db, acc);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('withdraw');
    expect(txs[0].amount).toBeCloseTo(10000, 2);
    expect(txs[0].notes).toContain(`定期存款 · #${fd.id}`);
    db.close();
  });

  it('创建纯记录型：不动余额、不写记录', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'record_only',
    });
    expect(fd.deduct_mode).toBe('record_only');
    expect(accountBalance(db, acc)).toBeCloseTo(100000, 2);
    expect(txsFor(db, acc)).toHaveLength(0);
    db.close();
  });

  it('编辑同步（sync）：金额差额调整 + 写记录', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 50000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    // 金额 50000 → 40000：退回 10000
    updateFixedDepositInDb(db, fd.id, { amount: 40000 }, 'sync');
    expect(accountBalance(db, acc)).toBeCloseTo(60000, 2);
    const txs = txsFor(db, acc);
    expect(txs).toHaveLength(2);
    expect(txs[1].type).toBe('deposit');
    expect(txs[1].amount).toBeCloseTo(10000, 2);
    // 金额 40000 → 60000：扣减 20000
    updateFixedDepositInDb(db, fd.id, { amount: 60000 }, 'sync');
    expect(accountBalance(db, acc)).toBeCloseTo(40000, 2);
    expect(txsFor(db, acc)[2].type).toBe('withdraw');
    db.close();
  });

  it('编辑拒绝同步（record_only）：余额不动、脱钩为纯记录型', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 50000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    updateFixedDepositInDb(db, fd.id, { amount: 30000 }, 'record_only');
    expect(accountBalance(db, acc)).toBeCloseTo(50000, 2); // 余额原封不动
    const row = getFixedDepositInDb(db, fd.id)!;
    expect(row.amount).toBe(30000);
    expect(row.deduct_mode).toBe('record_only');
    expect(row.deduct_account_id).toBeNull();
    expect(txsFor(db, acc)).toHaveLength(1); // 仅创建时那条
    db.close();
  });

  it('删除：restore=true 退回并写记录；restore=false 余额不动', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd1 = createFixedDepositInDb(db, {
      account_id: acc, amount: 20000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    const fd2 = createFixedDepositInDb(db, {
      account_id: acc, amount: 30000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    expect(accountBalance(db, acc)).toBeCloseTo(50000, 2);
    deleteFixedDepositInDb(db, fd1.id, true);
    expect(accountBalance(db, acc)).toBeCloseTo(70000, 2);
    expect(txsFor(db, acc).some((t) => t.notes.includes('删除退回'))).toBe(true);
    deleteFixedDepositInDb(db, fd2.id, false);
    expect(accountBalance(db, acc)).toBeCloseTo(70000, 2); // 不退回
    expect(getFixedDepositInDb(db, fd2.id)).toBeUndefined();
    db.close();
  });

  it('到期结算：回款入账 + 写记录 + 标记 settled（幂等）', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2026-08-16',
      deductMode: 'deduct', deductAccountId: acc,
    });
    const settled = settleFixedDepositInDb(db, fd.id, { amount: 10150, toAccountId: acc, currency: 'CNY' });
    expect(settled!.status).toBe('settled');
    expect(accountBalance(db, acc)).toBeCloseTo(100150, 2);
    const settleTxs = txsFor(db, acc).filter((t) => t.notes.includes('到期回款'));
    expect(settleTxs).toHaveLength(1);
    expect(settleTxs[0].type).toBe('deposit');
    expect(settleTxs[0].amount).toBeCloseTo(10150, 2);
    // 幂等：再次结算不重复入账
    settleFixedDepositInDb(db, fd.id, { amount: 10150, toAccountId: acc, currency: 'CNY' });
    expect(accountBalance(db, acc)).toBeCloseTo(100150, 2);
    db.close();
  });
});