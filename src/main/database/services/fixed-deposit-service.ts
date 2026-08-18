/**
 * Fixed deposit service — 薄封装：口径与纯 DB 操作见 fixed-deposit-core（v1.6.1）。
 * v1.6.1：所有资产间联动均询问用户后才执行，并生成存取记录（创建扣款/编辑差额/删除退回/到期回款）。
 * v1.9.0：定期全自动体系——日结单驱动创建/结算、定存流水、删除联动。
 */
import { getDatabase } from '../index';
import {
  listByAccountInDb, getFixedDepositInDb, createFixedDepositInDb,
  updateFixedDepositInDb, deleteFixedDepositInDb, settleFixedDepositInDb,
  createFixedDepositFromStatementInDb, settleFixedDepositFromStatementInDb,
  listFlowsInDb, interestEarnedInDb,
  type FixedDepositRow,
} from './fixed-deposit-core';
import { findUnlinkedTxForFdCreateInDb } from './statement-pairing';

export type { FixedDepositRow };

export function listByAccount(accountId: number): FixedDepositRow[] {
  return listByAccountInDb(getDatabase(), accountId);
}

export function getFixedDeposit(id: number): FixedDepositRow | undefined {
  return getFixedDepositInDb(getDatabase(), id);
}

export function listFlows(fdId: number) {
  return listFlowsInDb(getDatabase(), fdId);
}

export function interestEarned(fdId: number): number {
  return interestEarnedInDb(getDatabase(), fdId);
}

export function createFixedDeposit(data: {
  account_id: number;
  amount: number;
  currency?: string;
  interest_rate?: number;
  start_date: string;
  maturity_date?: string;
  notes?: string;
  deductMode?: 'deduct' | 'record_only';
  deductAccountId?: number | null;
  source?: 'manual' | 'statement';
  linkedTxId?: number | null;
}): FixedDepositRow {
  return createFixedDepositInDb(getDatabase(), data);
}

export function createFixedDepositFromStatement(data: {
  account_id: number;
  amount: number;
  currency?: string;
  start_date: string;
  linked_tx_id: number | null;
  notes?: string;
}): FixedDepositRow {
  return createFixedDepositFromStatementInDb(getDatabase(), data);
}

export function updateFixedDeposit(
  id: number,
  data: {
    amount?: number;
    currency?: string;
    interest_rate?: number;
    start_date?: string;
    maturity_date?: string;
    notes?: string;
  },
  balanceMode: 'sync' | 'record_only' = 'sync'
): FixedDepositRow | undefined {
  return updateFixedDepositInDb(getDatabase(), id, data, balanceMode);
}

export function deleteFixedDeposit(id: number, restoreBalance: boolean = true): boolean {
  return deleteFixedDepositInDb(getDatabase(), id, restoreBalance);
}

/** v1.9.0：删除联动——both：流水与定期一起删；fd_only：仅删定期、流水脱钩保留 */
export function deleteFixedDepositWithMode(id: number, mode: 'both' | 'fd_only'): boolean {
  return deleteFixedDepositInDb(getDatabase(), id, false, mode === 'both' ? 'delete_tx' : 'unlink');
}

export function settleFixedDeposit(
  id: number,
  data: { amount: number; toAccountId: number; currency?: string; date?: string }
): FixedDepositRow | undefined {
  return settleFixedDepositInDb(getDatabase(), id, data);
}

export function settleFixedDepositFromStatement(
  fdId: number,
  data: { creditAmount: number; date: string; linked_tx_id?: number | null }
): { principal: number; interest: number } | undefined {
  return settleFixedDepositFromStatementInDb(getDatabase(), fdId, data);
}

/** v1.9.0：手动创建定期前的反向配对检测 */
export function findMatchingTx(accountId: number, amount: number, date: string): any | undefined {
  return findUnlinkedTxForFdCreateInDb(getDatabase(), accountId, amount, date);
}
