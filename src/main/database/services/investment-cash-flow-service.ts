/**
 * investment-cash-flow-service — 券商现金流水服务（公开 API 包装层）。
 * 纯 DB 操作在 cash-flow-core.ts（可测试）；本文件负责独立事务与查询。
 */
import { getDatabase } from '../index';
import {
  insertCashFlowInDb, recomputeCashBalanceInDb, CashFlowInput, CashFlowRow,
} from './cash-flow-core';

/** 记录一条流水并在独立事务内重算余额 */
export function recordCashFlow(data: CashFlowInput): number {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const id = insertCashFlowInDb(db, data);
    recomputeCashBalanceInDb(db, data.investmentAccountId);
    return id;
  });
  return tx();
}

/** 流水列表（含关联持仓名称/代码） */
export function listCashFlows(investmentAccountId: number, limit = 200) {
  const db = getDatabase();
  return db.prepare(
    "SELECT f.*, a.name as asset_name, a.code as asset_code" +
    " FROM investment_cash_flows f" +
    " LEFT JOIN assets a ON f.asset_id = a.id" +
    " WHERE f.investment_account_id = ?" +
    " ORDER BY f.date DESC, f.id DESC LIMIT ?"
  ).all(investmentAccountId, limit) as (CashFlowRow & { asset_name: string | null; asset_code: string | null })[];
}

/** 当前现金余额（读缓存列；写路径已保证与流水一致） */
export function getCashBalance(investmentAccountId: number): number {
  const db = getDatabase();
  const row = db.prepare('SELECT cash_balance FROM investment_accounts WHERE id = ?').get(investmentAccountId) as
    { cash_balance: number } | undefined;
  return row?.cash_balance || 0;
}

/**
 * 余额校正：目标余额与当前余额的差额生成 adjust 流水（历史差异对齐入口）。
 * 返回校正后的余额。
 */
export function adjustCashBalance(investmentAccountId: number, targetBalance: number, notes?: string): number {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const current = getCashBalance(investmentAccountId);
    const delta = Math.round((targetBalance - current) * 100) / 100;
    if (delta === 0) return current;
    insertCashFlowInDb(db, {
      investmentAccountId, type: 'adjust', amount: delta,
      notes: notes || '余额校正（手动对齐）',
    });
    return recomputeCashBalanceInDb(db, investmentAccountId);
  });
  return tx();
}
