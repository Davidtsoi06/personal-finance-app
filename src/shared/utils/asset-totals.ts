/**
 * asset-totals — 总资产口径唯一来源（纯函数，主进程与渲染端共用）。
 *
 * 口径规则（v1.6.1）：
 *   1. 券商流动金（asset_type = broker_cash）为独立类别，不计入现金及存款；
 *   2. 投资市值 = 顶级投资类（investment/bank_wealth 等 is_investment 项）
 *      + 非投资组内嵌的投资子项（如银行组下关联的券商持仓）；
 *   3. 现金及存款 = 顶级非投资项金额 − 其内嵌的投资子项金额；
 *   4. 总资产 = 现金及存款 + 券商流动金 + 投资市值。
 */

/** 汇总所需的最小结构（AssetSummaryItem 的结构子集，避免 shared 依赖 main） */
export interface AssetTotalsItem {
  asset_type: string;
  is_investment: boolean;
  market_value_cny?: number | null;
  children?: AssetTotalsItem[];
}

export interface AssetTotals {
  /** 现金及存款（不含券商流动金） */
  totalCash: number;
  /** 投资市值（含银行组内嵌券商） */
  totalInvestments: number;
  /** 券商流动金（独立类别） */
  totalBrokerCash: number;
  /** 总资产 */
  totalAssets: number;
}

export function computeAssetTotals(items: AssetTotalsItem[]): AssetTotals {
  // 递归求一个子树中的投资市值（仅 is_investment 项）
  const sumInvestments = (item: AssetTotalsItem): number =>
    (item.is_investment ? item.market_value_cny || 0 : 0) +
    (item.children || []).reduce((s, c) => s + sumInvestments(c), 0);

  let totalCash = 0;
  let totalInvestments = 0;
  let totalBrokerCash = 0;

  for (const item of items) {
    // 券商流动金为独立类别（v1.5.8），不并入现金及存款
    if (item.asset_type === 'broker_cash') {
      totalBrokerCash += item.market_value_cny || 0;
      continue;
    }
    if (item.is_investment) {
      totalInvestments += item.market_value_cny || 0;
    } else {
      // 现金类 = 顶级金额 − 内嵌投资部分；内嵌投资归入投资市值，避免漏计
      const embedded = (item.children || []).reduce((s, c) => s + sumInvestments(c), 0);
      totalCash += (item.market_value_cny || 0) - embedded;
      totalInvestments += embedded;
    }
  }

  return {
    totalCash,
    totalInvestments,
    totalBrokerCash,
    totalAssets: totalCash + totalInvestments + totalBrokerCash,
  };
}