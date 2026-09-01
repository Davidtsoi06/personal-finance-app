/**
 * statement-pairing — 银行日结单行与定存/流水的智能配对（v1.9.0，纯 DB，可集成测试）。
 * 匹配规则：金额相等 + 日期 ±3 天（转出配对）/ 本金 ≤ 回款额 + 起始日 ≤ 回款日（回款配对）。
 */
import type Database from 'better-sqlite3';

export interface BankRowLike {
  date: string;
  amount: number;
  type: 'deposit' | 'withdraw';
  description: string;
  currency: string;
}

/** 行指纹（防重复导入）：日期|方向|金额|币种|摘要 */
export function txFingerprint(rec: BankRowLike): string {
  return [rec.date, rec.type, rec.amount, rec.currency, (rec.description || '').trim()].join('|');
}

export function findTxByHashInDb(db: Database.Database, accountId: number, hash: string): any | undefined {
  return db.prepare('SELECT * FROM account_transactions WHERE account_id = ? AND statement_hash = ? LIMIT 1').get(accountId, hash);
}

/**
 * v1.10.16：查找「券商交易直达银行」生成的存取记录（investment_account_id 非空 + 同日同金额同方向）。
 * 银行日结单里的同一笔到账（股票买卖）应由此行表示，导入时跳过避免重复计入。
 */
export function findBrokerDirectTxInDb(db: Database.Database, accountId: number, date: string, amount: number, type: string): any | undefined {
  return db.prepare(`
    SELECT * FROM account_transactions
    WHERE account_id = ? AND investment_account_id IS NOT NULL
      AND date = ? AND amount = ? AND type = ?
    LIMIT 1
  `).get(accountId, date, amount, type);
}

/** ISO 日期是否在 base 的 ±days 天内 */
function withinDays(a: string, b: string, days = 3): boolean {
  const ta = new Date(a + 'T00:00:00').getTime();
  const tb = new Date(b + 'T00:00:00').getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= days * 86400000;
}

/**
 * fd_out 行配对：同账户未结算、金额相等、起始日 ±3 天的定期。
 * 多笔命中时手动来源优先（更可能是用户已建好的那笔），再按起始日升序。
 */
export function findFdForOutRowInDb(db: Database.Database, accountId: number, amount: number, date: string): any | undefined {
  const fds = db.prepare(
    "SELECT * FROM fixed_deposits WHERE account_id = ? AND status = 'active' AND amount = ?"
  ).all(accountId, amount) as any[];
  const close = fds.filter((f) => withinDays(f.start_date, date, 3));
  if (close.length === 0) return undefined;
  close.sort((a, b) =>
    (b.source === 'manual' ? 1 : 0) - (a.source === 'manual' ? 1 : 0) || a.start_date.localeCompare(b.start_date)
  );
  return close[0];
}

/** fd_in 行配对：同账户未结算、本金 ≤ 回款额、起始日 ≤ 回款日的定期，取起始日最近的一笔 */
export function findFdForInRowInDb(db: Database.Database, accountId: number, creditAmount: number, date: string): any | undefined {
  return db.prepare(`
    SELECT * FROM fixed_deposits
    WHERE account_id = ? AND status = 'active' AND amount <= ? AND start_date <= ?
    ORDER BY start_date DESC, id DESC LIMIT 1
  `).get(accountId, creditAmount, date);
}

/**
 * 手动创建定期时的反向配对：同账户、取出、金额相等、日期 ±3 天、尚未被任何定期关联的流水。
 */
export function findUnlinkedTxForFdCreateInDb(db: Database.Database, accountId: number, amount: number, date: string): any | undefined {
  const txs = db.prepare(`
    SELECT * FROM account_transactions
    WHERE account_id = ? AND type = 'withdraw' AND amount = ?
      AND linked_fd_id IS NULL AND (transfer_type IS NULL OR transfer_type = 'fd_out')
  `).all(accountId, amount) as any[];
  return txs.find((t) => withinDays(t.date, date, 3));
}
