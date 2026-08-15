/**
 * RealizedPnlCard — 年度已实现盈亏卡片（重放法统计，v1.5.5 新增）。
 */
import { useState, useCallback, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Table, Column } from '../ui/Table';
import { Amount } from '../ui/Amount';
import { invoke } from '../../hooks/useIpc';

interface RealizedPnlEntry {
  assetId: number; code: string; name: string; currency: string;
  soldQuantity: number; costBasis: number; netProceeds: number;
  realizedPnl: number; sellCount: number;
}

interface RealizedPnlResult {
  year: number; total: number; byAsset: RealizedPnlEntry[];
  sellCount: number; buyCount: number; sellAmount: number; buyAmount: number;
}

export function RealizedPnlCard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<RealizedPnlResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (y: number) => {
    setLoading(true); setError('');
    try {
      setData(await invoke<RealizedPnlResult>('report:realizedPnl', y));
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(year); }, [load, year]);

  const columns: Column<RealizedPnlEntry>[] = [
    {
      key: 'name', title: '名称/代码',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.code}</div>
        </div>
      ),
    },
    { key: 'soldQuantity', title: '卖出数量', align: 'right', render: (r) => r.soldQuantity.toLocaleString() },
    { key: 'costBasis', title: '成本基数', align: 'right', render: (r) => <Amount value={r.costBasis} currency={r.currency} showSign={false} size="sm" /> },
    { key: 'netProceeds', title: '卖出净额', align: 'right', render: (r) => <Amount value={r.netProceeds} currency={r.currency} showSign={false} size="sm" /> },
    { key: 'realizedPnl', title: '已实现盈亏', align: 'right', render: (r) => <Amount value={r.realizedPnl} currency={r.currency} colored /> },
    { key: 'sellCount', title: '卖出笔数', align: 'center', render: (r) => r.sellCount },
  ];

  return (
    <div style={{ marginTop: 'var(--spacing-lg)' }}>
      <Card title="🏆 年度已实现盈亏">
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>年份：</label>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            style={{
              padding: '6px 12px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)',
              background: 'var(--color-bg-primary)', cursor: 'pointer',
            }}
          >
            {Array.from({ length: 6 }, (_, i) => currentYear - 5 + i).map((y) => (
              <option key={y} value={y}>{y} 年</option>
            ))}
          </select>
          {loading && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>加载中...</span>}
          {error && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>{error}</span>}
        </div>

        {data && (
          <>
            <div className="stat-cards" style={{ marginBottom: 'var(--spacing-md)' }}>
              <div className="stat-card">
                <div className="stat-card-label">已实现盈亏总额</div>
                <div className="stat-card-value number" style={{ color: data.total >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {(data.total >= 0 ? '+' : '') + data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">卖出（笔 / 金额）</div>
                <div className="stat-card-value" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {data.sellCount} 笔 / ¥{data.sellAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">买入（笔 / 金额）</div>
                <div className="stat-card-value" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {data.buyCount} 笔 / ¥{data.buyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            {data.byAsset.length > 0 ? (
              <Table columns={columns} data={data.byAsset} rowKey={(r) => r.assetId} />
            ) : (
              <div className="card-placeholder">{year} 年暂无卖出记录（已实现盈亏为 0）</div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
