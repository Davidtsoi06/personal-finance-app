import { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Card } from '../components/ui/Card';
import { NetAmount } from '../components/ui/Amount';
import { Table, Column } from '../components/ui/Table';
import { invoke } from '../hooks/useIpc';
import { NetWorthTrendChart } from '../components/charts/NetWorthTrendChart';
import { Badge } from '../components/ui/Badge';
import { ASSET_TYPE_LABELS } from '@shared/constants/labels';
import { CHART_PALETTE, INCOME_EXPENSE_COLORS, CATEGORY_GRADIENT } from '@shared/constants/chart-colors';
import './Dashboard.css';

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

interface YearlyStats {
  year: number;
  monthly: { month: string; income: number; expense: number; balance: number }[];
  totalIncome: number;
  totalExpense: number;
  netIncome: number;
}

interface CategoryItem {
  name: string;
  total: number;
  percent: number;
}

interface AssetPerformance {
  name: string; code: string; type: string; market: string; currency: string;
  market_value: number; total_cost: number; profit_loss: number; profit_loss_pct: number;
  quantity: number; cost_price: number; current_price: number;
}

export function Reports() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [yearlyStats, setYearlyStats] = useState<YearlyStats | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [assets, setAssets] = useState<AssetPerformance[]>([]);
  const [nwHistory, setNwHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Chart refs
  const monthlyChartRef = useRef<HTMLDivElement>(null);
  const categoryChartRef = useRef<HTMLDivElement>(null);
  const assetChartRef = useRef<HTMLDivElement>(null);

  // ── Export state ──
  const [exportType, setExportType] = useState<'assets' | 'trades' | 'ledgers'>('assets');
  const [exportMode, setExportMode] = useState<'month' | 'year'>('month');
  const [exportYear, setExportYear] = useState(currentYear);
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [stats, catData, assetData, nwData] = await Promise.all([
          invoke<YearlyStats>('report:yearlyStats', selectedYear),
          invoke<CategoryItem[]>('report:categoryBreakdown', { type: 'expense', year: selectedYear }),
          invoke<AssetPerformance[]>('report:assetPerformance'),
          invoke<any[]>('netWorth:history', 180),
        ]);
        setYearlyStats(stats);
        setCategories(catData || []);
        setAssets(assetData || []);
        setNwHistory(nwData || []);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load report data:', err);
        setLoading(false);
      }
    }
    setLoading(true);
    loadData();
  }, [selectedYear]);

  // ── Monthly income/expense bar + line chart ──
  useEffect(() => {
    if (!monthlyChartRef.current || !yearlyStats?.monthly?.length) return;
    const chart = echarts.init(monthlyChartRef.current);
    const months = yearlyStats.monthly.map((m) => MONTH_LABELS[parseInt(m.month) - 1] || m.month + '月');
    const incomes = yearlyStats.monthly.map((m) => m.income);
    const expenses = yearlyStats.monthly.map((m) => m.expense);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `<b>${params[0].axisValue}</b><br/>`;
          params.forEach((p: any) => {
            html += `${p.marker} ${p.seriesName}: ¥${p.value.toLocaleString()}<br/>`;
          });
          return html;
        },
      },
      legend: { data: ['收入', '支出'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '40px', top: '10px', containLabel: true },
      xAxis: { type: 'category', data: months, axisLabel: { fontSize: 11 } },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + '万' },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: [
        {
          name: '收入', type: 'bar', data: incomes,
          itemStyle: { color: INCOME_EXPENSE_COLORS.income, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 20,
        },
        {
          name: '支出', type: 'bar', data: expenses,
          itemStyle: { color: INCOME_EXPENSE_COLORS.expense, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 20,
        },
      ],
    });
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => { chart.dispose(); window.removeEventListener('resize', handleResize); };
  }, [yearlyStats]);

  // ── Category breakdown horizontal bar chart ──
  useEffect(() => {
    if (!categoryChartRef.current || categories.length === 0) return;
    const chart = echarts.init(categoryChartRef.current);
    // Take top 10 categories
    const top10 = categories.slice(0, 10);
    const names = top10.map((c) => c.name);
    const values = top10.map((c) => c.total);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (p: any) => {
          const item = p[0];
          return `${item.name}: ¥${item.value.toLocaleString()} (${top10[item.dataIndex]?.percent}%)`;
        },
      },
      grid: { left: '3%', right: '8%', bottom: '0', top: '5px', containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + '万', fontSize: 10 },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      yAxis: {
        type: 'category', data: names.reverse(),
        axisLabel: { fontSize: 11 },
        inverse: true,
      },
      series: [{
        type: 'bar', data: values.reverse().map((v, i) => ({
          value: v,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: CATEGORY_GRADIENT[0] },
              { offset: 1, color: CATEGORY_GRADIENT[1] },
            ]),
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barMaxWidth: 24,
        label: {
          show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => top10[top10.length - 1 - p.dataIndex]?.percent + '%',
        },
      }],
    });
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => { chart.dispose(); window.removeEventListener('resize', handleResize); };
  }, [categories]);


  // ── Asset performance pie chart ──
  useEffect(() => {
    if (!assetChartRef.current || assets.length === 0) return;
    const chart = echarts.init(assetChartRef.current);
    const byType: Record<string, number> = {};
    assets.forEach((a) => {
      const label = ASSET_TYPE_LABELS[a.type] || a.type;
      byType[label] = (byType[label] || 0) + a.market_value;
    });

    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.name}: ¥${p.value.toLocaleString()} (${p.percent}%)`,
      },
      legend: { orient: 'vertical', right: 5, top: 'center', textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold' } },
        data: Object.entries(byType).map(([name, value]) => ({ name, value })),
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      }],
      color: CHART_PALETTE,
    });
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => { chart.dispose(); window.removeEventListener('resize', handleResize); };
  }, [assets]);

  // ── Asset performance table columns ──
  const assetColumns: Column<AssetPerformance>[] = [
    { key: 'name', title: '名称', render: (r) => (
      <span>
        <span>{r.name}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: 6 }}>{r.code}</span>
      </span>
    )},
    { key: 'type', title: '类型', render: (r) => ASSET_TYPE_LABELS[r.type] || r.type },
    { key: 'market_value', title: '市值', align: 'right', render: (r) => (
      <NetAmount value={r.market_value} currency={r.currency} />
    )},
    { key: 'total_cost', title: '成本', align: 'right', render: (r) => (
      <NetAmount value={r.total_cost} currency={r.currency} />
    )},
    { key: 'profit_loss', title: '盈亏', align: 'right', render: (r) => (
      <span style={{ color: r.profit_loss >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 500 }}>
        {r.profit_loss >= 0 ? '+' : ''}{r.profit_loss.toLocaleString()}
      </span>
    )},
    { key: 'profit_loss_pct', title: '收益率', align: 'right', render: (r) => (
      <span style={{ color: r.profit_loss_pct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
        {r.profit_loss_pct >= 0 ? '+' : ''}{r.profit_loss_pct.toFixed(2)}%
      </span>
    )},
  ];

  // ── Export handler ──
  const handleExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const params: any = {
        type: exportType,
        year: exportYear,
      };
      if (exportMode === 'month') {
        params.month = exportMonth;
      }
      const r = await invoke<{ success: boolean; canceled?: boolean; filePath?: string; rowCount?: number; error?: string }>('export:toExcel', params);
      if (r.canceled) {
        setExportMsg(null);
      } else if (r.success) {
        setExportMsg(`✅ 导出成功！共导出 ${r.rowCount} 条记录`);
      } else {
        setExportMsg(`❌ ${r.error || '导出失败'}`);
      }
    } catch (err: any) {
      setExportMsg(`❌ 导出失败：${err.message}`);
    }
    setExporting(false);
  };

  // ── Export type labels ──
  const exportTypeLabels: Record<string, string> = {
    assets: '资产汇总',
    trades: '投资交易记录',
    ledgers: '收支记账',
  };

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">报表分析</h2>
        <p className="page-subtitle">收支趋势、资产构成、净值曲线</p>
      </div>

      {/* Year selector + summary stat cards */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          style={{
            padding: '6px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
            fontSize: 'var(--font-size-md)', background: 'var(--color-bg-primary)', cursor: 'pointer',
          }}
        >
          {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((y) => (
            <option key={y} value={y}>{y} 年</option>
          ))}
        </select>
        <div className="stat-cards" style={{ flex: 1, minWidth: 0 }}>
          <div className="stat-card">
            <div className="stat-card-label">年度收入</div>
            <div className="stat-card-value number" style={{ color: 'var(--color-success)' }}>
              ¥{(yearlyStats?.totalIncome || 0).toLocaleString()}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">年度支出</div>
            <div className="stat-card-value number" style={{ color: 'var(--color-danger)' }}>
              ¥{(yearlyStats?.totalExpense || 0).toLocaleString()}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">净结余</div>
            <div className="stat-card-value number" style={{ color: (yearlyStats?.netIncome || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
              ¥{(yearlyStats?.netIncome || 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Row 1: Monthly trend + Category breakdown */}
      <div className="dashboard-grid">
        <Card title="📊 月度收支趋势">
          {yearlyStats?.monthly?.length ? (
            <div ref={monthlyChartRef} style={{ height: '300px' }} />
          ) : (
            <div className="card-placeholder">暂无记账数据</div>
          )}
        </Card>

        <Card title="🏷️ 分类消费排行">
          {categories.length > 0 ? (
            <div ref={categoryChartRef} style={{ height: '300px' }} />
          ) : (
            <div className="card-placeholder">暂无支出数据</div>
          )}
        </Card>
      </div>

      {/* Row 2: Net worth curve + Asset composition */}
      <div className="dashboard-grid" style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📈 净资产走势">
          {nwHistory.length > 0 ? (
            <NetWorthTrendChart data={nwHistory} height={300} shortDates legendBottom={40} />
          ) : (
            <div className="card-placeholder">暂无净值历史数据</div>
          )}
        </Card>

        <Card title="💰 资产构成">
          {assets.length > 0 ? (
            <div ref={assetChartRef} style={{ height: '300px' }} />
          ) : (
            <div className="card-placeholder">暂无投资资产</div>
          )}
        </Card>
      </div>

      {/* Row 3: Investment performance detail table */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📋 投资收益明细">
          {assets.length > 0 ? (
            <Table columns={assetColumns} data={assets} rowKey={(r) => r.code} />
          ) : (
            <div className="card-placeholder">暂无投资持仓</div>
          )}
        </Card>
      </div>

      {/* Row 4: Excel Export */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📥 导出报表">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            {/* Export type selector */}
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
              {(['assets', 'trades', 'ledgers'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setExportType(t); setExportMsg(null); }}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                    border: exportType === t ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: exportType === t ? 'rgba(91,155,213,0.1)' : 'var(--color-bg-primary)',
                    color: exportType === t ? 'var(--color-primary)' : 'var(--color-text-primary)',
                    fontWeight: exportType === t ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  {t === 'assets' ? '💼 资产汇总' : t === 'trades' ? '📈 投资交易记录' : '📝 收支记账'}
                </button>
              ))}
            </div>

            {/* Time mode + date selectors */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
              {/* Month/Year toggle */}
              <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                <label style={{
                  padding: '6px 16px', borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
                  border: exportMode === 'month' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: exportMode === 'month' ? 'rgba(91,155,213,0.1)' : 'var(--color-bg-primary)',
                  cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                }}>
                  <input type="radio" name="exportMode" value="month" checked={exportMode === 'month'}
                    onChange={() => setExportMode('month')} style={{ marginRight: 4 }} />
                  单月导出
                </label>
                <label style={{
                  padding: '6px 16px', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                  border: exportMode === 'year' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: exportMode === 'year' ? 'rgba(91,155,213,0.1)' : 'var(--color-bg-primary)',
                  cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                }}>
                  <input type="radio" name="exportMode" value="year" checked={exportMode === 'year'}
                    onChange={() => setExportMode('year')} style={{ marginRight: 4 }} />
                  整年导出
                </label>
              </div>

              {/* Year selector */}
              <select
                value={exportYear}
                onChange={(e) => setExportYear(parseInt(e.target.value))}
                style={{
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                  fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)', cursor: 'pointer',
                }}
              >
                {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((y) => (
                  <option key={y} value={y}>{y} 年</option>
                ))}
              </select>

              {/* Month selector (only in month mode) */}
              {exportMode === 'month' && (
                <select
                  value={exportMonth}
                  onChange={(e) => setExportMonth(parseInt(e.target.value))}
                  style={{
                    padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                    fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)', cursor: 'pointer',
                  }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m} 月</option>
                  ))}
                </select>
              )}
            </div>

            {/* Export button + status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  padding: '10px 28px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: exporting ? 'var(--color-text-muted)' : 'var(--color-primary)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 'var(--font-size-sm)',
                  cursor: exporting ? 'not-allowed' : 'pointer',
                }}
              >
                {exporting ? '⏳ 导出中...' : `📥 导出 ${exportTypeLabels[exportType]} Excel`}
              </button>
              {exportMsg && (
                <span style={{
                  fontSize: 'var(--font-size-sm)',
                  color: exportMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)',
                  padding: '4px 12px',
                  background: exportMsg.startsWith('✅') ? '#F6FFED' : '#FFF2F0',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  {exportMsg}
                </span>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
