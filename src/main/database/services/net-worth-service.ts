/**
 * Net worth history — daily snapshots of total assets.
 * 薄封装：口径与纯 DB 操作见 net-worth-core（v1.6.1）。
 */
import { getDatabase } from '../index';
import { getAllAssetsSummary } from './account-service';
import { recordNetWorthInDb, getNetWorthHistoryInDb, type NetWorthRow } from './net-worth-core';

export type { NetWorthRow };

/** Record today's net worth snapshot（口径与资产总览一致） */
export function recordNetWorth(): NetWorthRow {
  const db = getDatabase();
  return recordNetWorthInDb(db, getAllAssetsSummary());
}

/** Get net worth history for the last N days（按日期升序） */
export function getNetWorthHistory(days: number = 30): NetWorthRow[] {
  const db = getDatabase();
  return getNetWorthHistoryInDb(db, days);
}