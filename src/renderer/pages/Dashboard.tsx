import { useState, useEffect, useRef, useCallback } from 'react';
import * as echarts from 'echarts';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { NetAmount, Amount } from '../components/ui/Amount';
import { Table } from '../components/ui/Table';
import { invoke } from '../hooks/useIpc';
import { computeAssetTotals } from '../../shared/utils/asset-totals';
import { useCurrencyRefresh } from '../hooks/useCurrencyRefresh';
import { usePriceRefresh } from '../hooks/usePriceRefresh';
import { NetWorthTrendChart } from '../components/charts/NetWorthTrendChart';
import { BudgetCard } from '../components/cards/BudgetCard';
import './Dashboard.css';

interface Summary {
  totalCash: number;
  totalInvestments: number;
  /** 券商流动金（v1.5.8 独立类别） */
  brokerCash: number;
  /** 债权（v1.7.3） */
  totalCredit: number;
  /** 债务（v1.7.3） */
  totalDebt: number;
  totalAssets: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netWorth: number;
}

interface AssetSummaryItem {
  id: number;
  name: string;
  asset_type: string;
  type: string;
  currency: string;
  balance: number;
  bank_name: string | null;
  broker: string | null;
  market_value_cny: number;
  children: AssetSummaryItem[];
  is_investment: boolean;
  /** 银行子项：定存合计；券商子项：现金余额（v1.5.6 概览重构） */
  cash_balance?: number;
  /** 银行子项：定存+理财数量；券商子项：持仓数 */
  asset_count?: number;
  total_profit_loss?: number;
}

interface AssetRow {
  id: number;
  name: string;
  code: string;
  type: string;
  market: string;
  currency: string;
  quantity: number;
  cost_price: number;
  current_price: number;
  market_value: number;
  total_cost: number;
  profit_loss: number;
  profit_loss_pct: number;
  account_id: number | null;
  investment_account_id?: number | null;
  notes: string | null;
  /** 定期存款虚拟行附带的字段（asset:listAll） */
  account_name?: string;
  maturity_date?: string;
  rate_to_cny?: number;
}

const ASSET_ICONS: Record<string, string> = {
  bank: '🏦',
  cash: '💵',
  e_wallet: '💬',
  insurance: '🛡️',
  investment: '📈',
  broker_cash: '💸',
  bank_wealth: '📊',
  custom: '✏️',
};

const CATEGORY_COLORS: Record<string, string> = {
  bank: '#5B9BD5',
  cash: '#67C23A',
  e_wallet: '#409EFF',
  insurance: '#E6A23C',
  investment: '#F56C6C',
  broker_cash: '#13C2C2',
  bank_wealth: '#7C4DFF',
  custom: '#909399',
};

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [assetSummary, setAssetSummary] = useState<AssetSummaryItem[]>([]);
  const [nwHistory, setNwHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillCategory, setDrillCategory] = useState<AssetSummaryItem | null>(null);
  const [expandedOverview, setExpandedOverview] = useState<number[]>([]);
  const toggleExpand = (id: number) => {
    setExpandedOverview((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Asset query filters
  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [marketFilter, setMarketFilter] = useState('');
  const [sortBy, setSortBy] = useState('market_value_desc');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [summaryData, nwData, assetsData] = await Promise.all([
        invoke<AssetSummaryItem[]>('account:allAssetsSummary'),
        invoke<any[]>('netWorth:history', 30),
        invoke<AssetRow[]>('asset:listAll').catch(() => []),
      ]);
      const now = new Date();
      const monthlySummary = await invoke<{ income: number; expense: number }>(
        'ledger:monthlySummary', now.getFullYear(), now.getMonth() + 1
      );

      // 总资产口径唯一来源（v1.6.1）：银行组内嵌券商计入投资市值，避免漏计
      const totals = computeAssetTotals(summaryData || []);

      setSummary({
        totalCash: totals.totalCash,
        totalInvestments: totals.totalInvestments,
        brokerCash: totals.totalBrokerCash,
        totalCredit: totals.totalCredit,
        totalDebt: totals.totalDebt,
        totalAssets: totals.totalAssets,
        monthlyIncome: monthlySummary?.income || 0,
        monthlyExpense: monthlySummary?.expense || 0,
        // 总资产统一口径（v1.6.1）：含券商流动金，与顶部「总资产」卡完全一致
        netWorth: totals.totalAssets,
      });
      setAssetSummary(summaryData || []);
      setNwHistory(nwData || []);
      setAllAssets(assetsData || []);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  // 汇率更新后自动刷新（v1.6.1：避免总览/资产管理页数据分叉）
  useCurrencyRefresh(loadDashboard);
  usePriceRefresh(loadDashboard); // v1.10.0：股价更新后总资产自动同步

  // ── Pie chart with drill-down ──
  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    if (assetSummary.length === 0) {
      chart.setOption({ series: [{ data: [] }] });
      return;
    }

    let pieData: { name: string; value: number; itemStyle?: any }[] = [];
    let title = '资产分布';

    if (drillCategory) {
      // Level 2: show items within the selected category
      title = `${ASSET_ICONS[drillCategory.asset_type] || ''} ${drillCategory.name}`;
      const children = drillCategory.children || [];
      if (children.length === 0) {
        pieData = [{ name: drillCategory.name, value: drillCategory.market_value_cny }];
      } else {
        pieData = children.map(c => ({
          name: c.name,
          value: c.market_value_cny || c.balance || 0,
        }));
      }
    } else {
      // Level 1: top-level categories
      pieData = assetSummary.map(item => ({
        name: `${ASSET_ICONS[item.asset_type] || ''} ${item.name}`,
        value: item.market_value_cny || 0,
        itemStyle: { color: CATEGORY_COLORS[item.asset_type] || '#909399' },
      }));
    }

    // Clear old click handler and set new one
    chart.off('click');
    chart.on('click', (params: any) => {
      if (!drillCategory) {
        // From level 1 → level 2: find the clicked category
        const clicked = assetSummary.find(
          item => `${ASSET_ICONS[item.asset_type] || ''} ${item.name}` === params.name
        );
        if (clicked && (clicked.children?.length || 0) > 0) {
          setDrillCategory(clicked);
        }
      }
    });

    chart.setOption({
      title: {
        text: drillCategory ? title : '',
        left: 'center',
        top: 8,
        textStyle: { fontSize: 14, fontWeight: 600 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.name}: ¥ ${p.value.toLocaleString()} (${p.percent}%)`,
      },
      series: [{
        type: 'pie',
        radius: drillCategory ? ['40%', '70%'] : ['45%', '75%'],
        center: drillCategory ? ['50%', '55%'] : ['50%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: {
          label: { show: true, fontWeight: 'bold' },
        },
        data: pieData,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
      }],
    }, { notMerge: false });

    // Handle click on center area to go back
    if (drillCategory) {
      chart.getZr().off('click');
      chart.getZr().on('click', (params: any) => {
        // Only go back if click is on the center area (inner circle)
        if (!params.target) {
          setDrillCategory(null);
        }
      });
    }
  }, [assetSummary, drillCategory]);

  // Resize listener
  useEffect(() => {
    const handleResize = () => chartInstanceRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // ── Filter & sort assets ──
  const TYPE_LABELS: Record<string, string> = { stock: '股票', fund: '基金', etf: 'ETF', gold: '黄金', crypto: '加密货币', fixed_deposit: '定期存款' };
  const MARKET_LABELS: Record<string, string> = { a_stock: 'A股', hk_stock: '港股', us_stock: '美股', other: '其他' };

  const filteredAssets = allAssets
    .filter(a => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (marketFilter && a.market !== marketFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return a.name.toLowerCase().includes(q) || (a.code || '').toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'market_value_asc': return a.market_value - b.market_value;
        case 'profit_loss_desc': return b.profit_loss - a.profit_loss;
        case 'profit_loss_asc': return a.profit_loss - b.profit_loss;
        case 'profit_loss_pct_desc': return b.profit_loss_pct - a.profit_loss_pct;
        case 'profit_loss_pct_asc': return a.profit_loss_pct - b.profit_loss_pct;
        case 'market_value_desc':
        default: return b.market_value - a.market_value;
      }
    });

  // 统计口径（v1.6.0）：持仓市值按 CNY 换算合计；定存单独统计（不混入总市值）
  const holdingAssets = filteredAssets.filter(a => a.type !== 'fixed_deposit');
  const depositAssets = filteredAssets.filter(a => a.type === 'fixed_deposit');
  const totalMktValue = holdingAssets.reduce((s, a) => s + a.market_value * (a.rate_to_cny || 1), 0);
  const totalDepositValue = depositAssets.reduce((s, a) => s + a.market_value * (a.rate_to_cny || 1), 0);
  const profitCount = holdingAssets.filter(a => a.profit_loss > 0).length;
  const lossCount = holdingAssets.filter(a => a.profit_loss < 0).length;
  const bestAsset = filteredAssets.reduce((best, a) => (!best || a.profit_loss_pct > best.profit_loss_pct) ? a : best, null as AssetRow | null);
  const worstAsset = filteredAssets.reduce((worst, a) => (!worst || a.profit_loss_pct < worst.profit_loss_pct) ? a : worst, null as AssetRow | null);

  if (loading) return <div className="page-loading">加载中...</div>;

  const s = summary;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">资产结构</h2>
        <p className="page-subtitle">资产总览</p>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">总资产</div>
          <div className="stat-card-value number">{s && <NetAmount value={s.totalAssets} currency="CNY" />}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">现金及存款</div>
          <div className="stat-card-value number">{s && <NetAmount value={s.totalCash} currency="CNY" />}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">券商流动金</div>
          <div className="stat-card-value number">{s && <NetAmount value={s.brokerCash} currency="CNY" />}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">投资市值</div>
          <div className="stat-card-value number">{s && <NetAmount value={s.totalInvestments} currency="CNY" />}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">债权</div>
          <div className="stat-card-value number" style={{ color: s && s.totalCredit > 0 ? 'var(--color-success)' : undefined }}>
            {s && <NetAmount value={s.totalCredit} currency="CNY" />}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">债务</div>
          <div className="stat-card-value number" style={{ color: s && s.totalDebt > 0 ? 'var(--color-danger)' : undefined }}>
            {s && <NetAmount value={s.totalDebt} currency="CNY" />}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">本月收入 / 支出</div>
          <div className="stat-card-value number" style={{ fontSize: 'var(--font-size-lg)', display: 'flex', gap: '12px' }}>
            {s && (
              <>
                <span style={{ color: 'var(--color-success)' }}>¥ {s.monthlyIncome.toLocaleString()}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>/</span>
                <span style={{ color: 'var(--color-danger)' }}>¥ {s.monthlyExpense.toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <Card title={drillCategory ? `📊 ${drillCategory.name} · 明细` : '📊 资产分布'}>
          {assetSummary.length > 0 ? (
            <div>
              {drillCategory && (
                <div style={{ marginBottom: '8px' }}>
                  <Button variant="secondary" size="sm" onClick={() => setDrillCategory(null)}>
                    ← 返回总览
                  </Button>
                </div>
              )}
              <div ref={chartRef} style={{ height: '280px' }} />
              {!drillCategory && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '8px' }}>
                  点击扇区查看明细
                </div>
              )}
            </div>
          ) : (
            <div className="card-placeholder">暂无资产数据</div>
          )}
        </Card>

        <Card title="💎 资产概览">
          {assetSummary.length > 0 ? (
            <div className="overview-stats">
              {assetSummary.map(item => {
                const expandable = (item.children?.length || 0) > 0;
                const expanded = expandable && expandedOverview.includes(item.id);
                return (
                  <div key={item.id}>
                    <div
                      className="overview-item"
                      style={{ cursor: expandable ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (expandable) {
                          setDrillCategory(item);
                          toggleExpand(item.id);
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                            background: CATEGORY_COLORS[item.asset_type] || '#909399',
                          }}
                        />
                        <span className="overview-label">
                          {ASSET_ICONS[item.asset_type] || ''} {item.name}
                        </span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          {expandable ? item.children.length + ' 个子项' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <NetAmount value={item.market_value_cny} currency="CNY" />
                        {expandable && (
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                            {expanded ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </div>
                    {expanded && (item.children || []).map(child => (
                      <div key={child.id} className="overview-subitem">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)' }}>
                            {child.is_investment ? '📈' : '💳'}
                          </span>
                          <span className="overview-label">
                            {child.name}
                            {child.broker ? '（' + child.broker + '）' : ''}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <NetAmount value={child.market_value_cny} currency="CNY" />
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                            {child.asset_type === 'broker_cash'
                              ? '流动金 ' + (child.balance ?? 0).toLocaleString() + ' ' + child.currency
                              : child.asset_type === 'bank_wealth'
                                ? '盈亏 ' + ((child.total_profit_loss ?? 0) >= 0 ? '+' : '') + (child.total_profit_loss ?? 0).toLocaleString() + ' CNY'
                                : child.is_investment
                                  ? (child.cash_balance ?? 0) + ' 现金 · ' + (child.asset_count ?? 0) + ' 只持仓'
                                  : '定存 ' + (child.asset_count ?? 0) + ' 笔'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="overview-item overview-item--total">
                <span className="overview-label">💎 总资产</span>
                <NetAmount value={s?.netWorth || 0} currency="CNY" />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--spacing-md)' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                还没有任何资产记录——从添加一个银行卡或投资账户开始吧。
              </p>
              <Button variant="primary" onClick={() => { window.location.hash = '#/accounts'; }}>
                ＋ 添加第一个资产
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* ── Asset Query & Analysis ── */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="🔍 资产查询与分析">
          {/* Filter toolbar */}
          <div className="filter-toolbar">
            <input
              className="form-input"
              placeholder="搜索名称或代码..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: 1, minWidth: '160px' }}
            />
            <select className="form-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="form-select" value={marketFilter} onChange={e => setMarketFilter(e.target.value)}>
              <option value="">全部市场</option>
              {Object.entries(MARKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="form-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="market_value_desc">市值 ↓</option>
              <option value="market_value_asc">市值 ↑</option>
              <option value="profit_loss_desc">盈亏 ↓</option>
              <option value="profit_loss_asc">盈亏 ↑</option>
              <option value="profit_loss_pct_desc">收益率 ↓</option>
              <option value="profit_loss_pct_asc">收益率 ↑</option>
            </select>
          </div>

          {/* Quick stats */}
          {filteredAssets.length > 0 && (
            <div className="query-stats">
              <span>📊 总计 <strong>{filteredAssets.length}</strong> 个资产</span>
              <span>💰 持仓市值(CNY) <strong>¥ {totalMktValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
<span>🏦 定期存款(CNY) <strong>¥ {totalDepositValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
              <span style={{ color: 'var(--color-success)' }}>📈 盈利 <strong>{profitCount}</strong> 个</span>
              <span style={{ color: 'var(--color-danger)' }}>📉 亏损 <strong>{lossCount}</strong> 个</span>
              {bestAsset && (
                <span style={{ color: 'var(--color-success)' }}>🏆 最佳 <strong>{bestAsset.name}</strong> (+{bestAsset.profit_loss_pct?.toFixed(2)}%)</span>
              )}
              {worstAsset && (
                <span style={{ color: 'var(--color-danger)' }}>💔 最差 <strong>{worstAsset.name}</strong> ({worstAsset.profit_loss_pct?.toFixed(2)}%)</span>
              )}
            </div>
          )}

          {/* Results table */}
          {filteredAssets.length > 0 ? (
            <Table
              columns={[
                { key: 'name', title: '名称', render: (row: AssetRow) => (
                  <div>
                    <div style={{ fontWeight: 500 }}>{row.name}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{row.code || '-'}</div>
                  </div>
                )},
                { key: 'type', title: '类型', render: (row: AssetRow) => TYPE_LABELS[row.type] || row.type },
                { key: 'market', title: '市场', render: (row: AssetRow) => MARKET_LABELS[row.market] || row.market || '-' },
                { key: 'currency', title: '货币', render: (row: AssetRow) => row.currency },
                { key: 'quantity', title: '持仓量', render: (row: AssetRow) => row.quantity?.toLocaleString() || '-' },
                { key: 'cost_price', title: '成本价', render: (row: AssetRow) => <Amount value={row.cost_price} currency={row.currency} showSign={false} /> },
                { key: 'current_price', title: '最新价', render: (row: AssetRow) => <Amount value={row.current_price} currency={row.currency} showSign={false} /> },
                { key: 'market_value', title: '市值', render: (row: AssetRow) => <Amount value={row.market_value} currency={row.currency} showSign={false} /> },
                { key: 'profit_loss', title: '盈亏', render: (row: AssetRow) => <Amount value={row.profit_loss} currency={row.currency} colored /> },
                { key: 'profit_loss_pct', title: '收益率', render: (row: AssetRow) => (
                  <span style={{ color: row.profit_loss_pct >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
                    {row.profit_loss_pct >= 0 ? '+' : ''}{row.profit_loss_pct?.toFixed(2)}%
                  </span>
                )},
              ]}
              data={filteredAssets}
            />
          ) : (
            <div className="card-placeholder">{allAssets.length === 0 ? '暂无资产数据' : '没有匹配的资产'}</div>
          )}
        </Card>
      </div>

      {/* Net Worth Trend Chart */}
      {nwHistory.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-lg)' }}>
          <Card title="📈 总资产走势">
            <NetWorthTrendChart data={nwHistory} height={320} />
          </Card>
        </div>
      )}

      {/* Budget Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <BudgetCard />
      </div>
    </div>
  );
}
