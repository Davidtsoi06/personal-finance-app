import { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Card } from '../components/ui/Card';
import { NetAmount } from '../components/ui/Amount';
import { invoke } from '../hooks/useIpc';
import { NetWorthTrendChart } from '../components/charts/NetWorthTrendChart';
import { BIG_CATEGORY_LABEL, BIG_CATEGORY_ORDER } from '@shared/constants/labels';
import { BIG_CATEGORY_COLORS } from '@shared/constants/chart-colors';
import { BudgetCard } from '../components/cards/BudgetCard';
import './Dashboard.css';

interface Summary {
  totalCash: number;
  totalInvestments: number;
  totalAssets: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netWorth: number;
}

interface AssetSummary {
  name: string;
  type: string;
  currency: string;
  market_value: number;
  profit_loss: number;
  profit_loss_pct: number;
}

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [nwHistory, setNwHistory] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [accounts, assetList, nwData] = await Promise.all([
          invoke<any[]>('account:list'),
          invoke<any[]>('asset:list'),
          invoke<any[]>('netWorth:history', 30),
        ]);
        const now = new Date();
        const monthlySummary = await invoke<{ income: number; expense: number }>(
          'ledger:monthlySummary', now.getFullYear(), now.getMonth() + 1
        );
        const totalCash = (accounts || []).reduce((s: number, a: any) => s + (a.balance || 0), 0);
        const totalInvestments = (assetList || []).reduce((s: number, a: any) => s + (a.market_value || 0), 0);
        setSummary({
          totalCash, totalInvestments,
          totalAssets: totalCash + totalInvestments,
          monthlyIncome: monthlySummary?.income || 0,
          monthlyExpense: monthlySummary?.expense || 0,
          netWorth: totalCash + totalInvestments,
        });
        setAssets(assetList || []);
        setAccounts(accounts || []);
        setNwHistory(nwData || []);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  // ECharts pie chart — asset distribution by big category (incremental update)
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    // Init chart once, reuse on subsequent updates
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    if (assets.length === 0 && accounts.length === 0) {
      chart.setOption({ series: [{ data: [] }] });
      return;
    }

    const byCategory: Record<string, number> = {};

    // Aggregate account balances into big categories
    for (const a of accounts) {
      const label = BIG_CATEGORY_LABEL[a.type];
      if (!label) continue;
      byCategory[label] = (byCategory[label] || 0) + (a.balance || 0);
    }

    // Aggregate all investment assets into one "投资" slice
    const totalInvestment = assets.reduce((s, a) => s + (a.market_value || 0), 0);
    if (totalInvestment > 0) {
      byCategory['📈 投资'] = totalInvestment;
    }

    // Build data array in consistent display order
    const data = BIG_CATEGORY_ORDER
      .filter((name: string) => byCategory[name] != null && byCategory[name] > 0)
      .map((name: string) => ({ name, value: byCategory[name] }));

    const colors = data.map((d: { name: string; value: number }) => BIG_CATEGORY_COLORS[d.name] || '#5B9BD5');

    // Incremental update — reuse existing chart instance
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.name}: ¥ ${p.value.toLocaleString()} (${p.percent}%)`,
      },
      series: [{
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: {
          label: { show: true, fontWeight: 'bold' },
        },
        data,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
      }],
      color: colors,
    }, { notMerge: false });
  }, [assets, accounts]);

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


  if (loading) return <div className="page-loading">加载中...</div>;

  const s = summary;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">仪表盘</h2>
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
          <div className="stat-card-label">投资市值</div>
          <div className="stat-card-value number">{s && <NetAmount value={s.totalInvestments} currency="CNY" />}</div>
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
        <Card title="资产分布">
          {assets.length > 0 || accounts.length > 0 ? (
            <div ref={chartRef} style={{ height: '280px' }} />
          ) : (
            <div className="card-placeholder">暂无资产数据</div>
          )}
        </Card>

        <Card title="账户概览">
          <div className="overview-stats">
            <div className="overview-item">
              <span className="overview-label">💵 现金 + 银行存款</span>
              <NetAmount value={s?.totalCash || 0} currency="CNY" />
            </div>
            <div className="overview-item">
              <span className="overview-label">📈 投资市值</span>
              <NetAmount value={s?.totalInvestments || 0} currency="CNY" />
            </div>
            <div className="overview-item overview-item--total">
              <span className="overview-label">💎 净资产</span>
              <NetAmount value={s?.netWorth || 0} currency="CNY" />
            </div>
          </div>
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
