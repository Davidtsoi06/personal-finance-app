import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';
import {
  createFixedDepositInDb, createFixedDepositFromStatementInDb,
  settleFixedDepositInDb, settleFixedDepositFromStatementInDb,
  deleteFixedDepositInDb, getFixedDepositInDb, listFlowsInDb,
} from '../../src/main/database/services/fixed-deposit-core';
import {
  txFingerprint, findTxByHashInDb, findFdForOutRowInDb,
  findFdForInRowInDb, findUnlinkedTxForFdCreateInDb,
} from '../../src/main/database/services/statement-pairing';
import { deleteAccountTransactionWithMode } from '../../src/main/database/services/account-transaction-service';

/** 纯 DB 环境（与 fixed-deposit.test.ts 同构） */
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
  setDatabaseForTest(db);
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

/** 模拟日结单导入写一条银行流水（带指纹） */
function seedBankTx(db: Database.Database, accountId: number, type: 'deposit' | 'withdraw', amount: number, date: string, description: string, extra?: { transferType?: string; linkedFdId?: number }): number {
  const hash = txFingerprint({ date, amount, type, description, currency: 'CNY' });
  const r = db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes, transfer_type, linked_fd_id, statement_hash)
    VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?)
  `).run(accountId, type, amount, date, description, extra?.transferType ?? null, extra?.linkedFdId ?? null, hash);
  return Number(r.lastInsertRowid);
}

describe('定期全自动体系（v1.9.0）', () => {
  it('迁移 v20：新列与新表存在，旧手动扣款流水被回填打标', () => {
    // 模拟旧库：先建手动扣款型定期（v20 迁移已在建库时应用，此处验证打标发生在手动创建时）
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    expect(fd.source).toBe('manual');
    expect(fd.linked_tx_id).not.toBeNull();
    const tx = db.prepare('SELECT * FROM account_transactions WHERE id = ?').get(fd.linked_tx_id) as any;
    expect(tx.transfer_type).toBe('fd_out');
    expect(tx.linked_fd_id).toBe(fd.id);
    const flows = listFlowsInDb(db, fd.id);
    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('principal_in');
    expect(flows[0].amount).toBeCloseTo(10000, 2);
    db.close();
  });

  it('日结单转出 → 自动创建定期（不重复扣银行，总资产不变）', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    // 导入行本身扣款（模拟 bank:importParsed 的写入）
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款 3个月');
    db.prepare("UPDATE accounts SET balance = balance - 10000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 10000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');

    const fd = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY', start_date: '2026-08-05', linked_tx_id: txId,
    });
    expect(fd.source).toBe('statement');
    expect(fd.maturity_date).toBe('');
    expect(fd.deduct_mode).toBe('record_only');
    expect(accountBalance(db, acc)).toBeCloseTo(90000, 2); // 只有流水扣了一次
    const tx = db.prepare('SELECT * FROM account_transactions WHERE id = ?').get(txId) as any;
    expect(tx.linked_fd_id).toBe(fd.id);
    expect(tx.transfer_type).toBe('fd_out');
    db.close();
  });

  it('日结单回款 → 自动结算：本金/利息流水拆分 + 投资收入落账 + 到期日补全', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款 3个月');
    db.prepare("UPDATE accounts SET balance = balance - 10000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 10000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');
    const fd = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY', start_date: '2026-08-05', linked_tx_id: txId,
    });

    // 回款行入账（模拟导入）
    const inTxId = seedBankTx(db, acc, 'deposit', 10150, '2026-11-05', '定期存款到期 本息入账');
    db.prepare("UPDATE accounts SET balance = balance + 10150 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance + 10150 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');

    const settled = settleFixedDepositFromStatementInDb(db, fd.id, { creditAmount: 10150, date: '2026-11-05', linked_tx_id: inTxId });
    expect(settled).toEqual({ principal: 10000, interest: 150 });
    const row = getFixedDepositInDb(db, fd.id)!;
    expect(row.status).toBe('settled');
    expect(row.maturity_date).toBe('2026-11-05');
    expect(row.settle_tx_id).toBe(inTxId);
    const flows = listFlowsInDb(db, fd.id);
    expect(flows.map((f) => f.type).sort()).toEqual(['principal_in', 'settle_interest', 'settle_principal']);
    // 利息 150 落账 ledgers「投资收入」，不联动余额
    const ledger = db.prepare("SELECT l.*, c.name as category FROM ledgers l JOIN categories c ON l.category_id = c.id WHERE l.description LIKE '%定期存款%'").get() as any;
    expect(ledger.type).toBe('income');
    expect(ledger.amount).toBeCloseTo(150, 2);
    expect(ledger.category).toBe('投资收入');
    expect(accountBalance(db, acc)).toBeCloseTo(100150, 2);
    // 幂等：再次结算返回 undefined
    expect(settleFixedDepositFromStatementInDb(db, fd.id, { creditAmount: 10150, date: '2026-11-05' })).toBeUndefined();
    db.close();
  });

  it('手动结算同样拆分利息并落账投资收入', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2026-11-01',
      deductMode: 'deduct', deductAccountId: acc,
    });
    settleFixedDepositInDb(db, fd.id, { amount: 10200, toAccountId: acc, currency: 'CNY' });
    const flows = listFlowsInDb(db, fd.id);
    const interestFlow = flows.find((f) => f.type === 'settle_interest');
    expect(interestFlow!.amount).toBeCloseTo(200, 2);
    const ledger = db.prepare("SELECT * FROM ledgers WHERE description LIKE '%到期利息%'").get() as any;
    expect(ledger.amount).toBeCloseTo(200, 2);
    db.close();
  });

  it('配对：fd_out 金额+日期±3天命中手动定期；fd_in 本金≤回款额且起始日≤回款日', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const fd = createFixedDepositInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY',
      start_date: '2026-08-01', maturity_date: '2027-08-01',
      deductMode: 'record_only',
    });
    expect(findFdForOutRowInDb(db, acc, 10000, '2026-08-04')?.id).toBe(fd.id); // +3 天
    expect(findFdForOutRowInDb(db, acc, 10000, '2026-08-05')).toBeUndefined(); // 超窗口
    expect(findFdForOutRowInDb(db, acc, 10000, '2026-07-28')).toBeUndefined(); // -4 天
    expect(findFdForInRowInDb(db, acc, 10150, '2026-12-01')?.id).toBe(fd.id);
    expect(findFdForInRowInDb(db, acc, 9999, '2026-12-01')).toBeUndefined(); // 回款 < 本金
    db.close();
  });

  it('反向配对：金额+日期±3天的未关联取出流水被找到；指纹防重复生效', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款');
    const found = findUnlinkedTxForFdCreateInDb(db, acc, 10000, '2026-08-05');
    expect(found.id).toBe(txId);
    // 已关联后不再命中
    db.prepare('UPDATE account_transactions SET linked_fd_id = 1 WHERE id = ?').run(txId);
    expect(findUnlinkedTxForFdCreateInDb(db, acc, 10000, '2026-08-05')).toBeUndefined();
    // 指纹查重
    const hash = txFingerprint({ date: '2026-08-05', amount: 10000, type: 'withdraw', description: '转定期存款', currency: 'CNY' });
    expect(findTxByHashInDb(db, acc, hash)?.id).toBe(txId);
    db.close();
  });

  it('删除联动 delete_tx：流水与定期一起删，资金退回', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款 3个月');
    db.prepare("UPDATE accounts SET balance = balance - 10000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 10000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');
    const fd = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY', start_date: '2026-08-05', linked_tx_id: txId,
    });
    expect(deleteFixedDepositInDb(db, fd.id, false, 'delete_tx')).toBe(true);
    expect(getFixedDepositInDb(db, fd.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as c FROM account_transactions WHERE id = ?').get(txId).c).toBe(0);
    expect(accountBalance(db, acc)).toBeCloseTo(100000, 2); // 资金退回
    db.close();
  });

  it('删除联动 unlink：仅删定期，流水脱钩保留为普通记录', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款 3个月');
    db.prepare("UPDATE accounts SET balance = balance - 10000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 10000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');
    const fd = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY', start_date: '2026-08-05', linked_tx_id: txId,
    });
    expect(deleteFixedDepositInDb(db, fd.id, false, 'unlink')).toBe(true);
    const tx = db.prepare('SELECT * FROM account_transactions WHERE id = ?').get(txId) as any;
    expect(tx.transfer_type).toBeNull();
    expect(tx.linked_fd_id).toBeNull();
    expect(accountBalance(db, acc)).toBeCloseTo(90000, 2); // 余额不动（流水保留）
    db.close();
  });

  it('存取记录联动删除：tx_only 定期保留转纯记录；both 一起删', () => {
    const db = freshDb();
    const acc = seedAccount(db, '卡A');
    const txId = seedBankTx(db, acc, 'withdraw', 10000, '2026-08-05', '转定期存款 3个月');
    db.prepare("UPDATE accounts SET balance = balance - 10000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 10000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');
    const fd = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 10000, currency: 'CNY', start_date: '2026-08-05', linked_tx_id: txId,
    });

    // tx_only：删流水（余额回滚），定期脱钩保留
    expect(deleteAccountTransactionWithMode(txId, 'tx_only')).toBe(true);
    const kept = getFixedDepositInDb(db, fd.id)!;
    expect(kept.linked_tx_id).toBeNull();
    expect(kept.deduct_mode).toBe('record_only');
    expect(accountBalance(db, acc)).toBeCloseTo(100000, 2);

    // both：再建一笔，流水+定期一起删
    const tx2 = seedBankTx(db, acc, 'withdraw', 5000, '2026-09-01', '转定期存款 6个月');
    db.prepare("UPDATE accounts SET balance = balance - 5000 WHERE id = ?").run(acc);
    db.prepare('UPDATE account_balances SET balance = balance - 5000 WHERE account_id = ? AND currency = ?').run(acc, 'CNY');
    const fd2 = createFixedDepositFromStatementInDb(db, {
      account_id: acc, amount: 5000, currency: 'CNY', start_date: '2026-09-01', linked_tx_id: tx2,
    });
    expect(deleteAccountTransactionWithMode(tx2, 'both')).toBe(true);
    expect(getFixedDepositInDb(db, fd2.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as c FROM account_transactions WHERE id = ?').get(tx2).c).toBe(0);
    expect(accountBalance(db, acc)).toBeCloseTo(100000, 2);
    db.close();
  });
});
