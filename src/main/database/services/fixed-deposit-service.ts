/**
 * Fixed deposit service — 薄封装：口径与纯 DB 操作见 fixed-deposit-core（v1.6.1）。
 * v1.6.1：所有资产间联动均询问用户后才执行，并生成存取记录（创建扣款/编辑差额/删除退回/到期回款）。
 */
import { getDatabase } from '../index';
import {
  listByAccountInDb, getFixedDepositInDb, createFixedDepositInDb,
  updateFixedDepositInDb, deleteFixedDepositInDb, settleFixedDepositInDb,
  type FixedDepositRow,
} from './fixed-deposit-core';

export type { FixedDepositRow };

export function listByAccount(accountId: number): FixedDepositRow[] {
  return listByAccountInDb(getDatabase(), accountId);
}

export function getFixedDeposit(id: number): FixedDepositRow | undefined {
  return getFixedDepositInDb(getDatabase(), id);
}

export function createFixedDeposit(data: {
  account_id: number;
  amount: number;
  currency?: string;
  interest_rate?: number;
  start_date: string;
  maturity_date: string;
  notes?: string;
  deductMode?: 'deduct' | 'record_only';
  deductAccountId?: number | null;
}): FixedDepositRow {
  return createFixedDepositInDb(getDatabase(), data);
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

export function settleFixedDeposit(
  id: number,
  data: { amount: number; toAccountId: number; currency?: string; date?: string }
): FixedDepositRow | undefined {
  return settleFixedDepositInDb(getDatabase(), id, data);
}