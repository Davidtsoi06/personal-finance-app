/**
 * RecentSellPnlCard — 投资收益明细（v1.10.0）。
 * 只显示卖出交易（买入不创造收益），按最近 3 天分组：今天 → 昨天 → 前天，
 * 每天展示卖出交易的成本价（当日(含)前买入加权平均）、成交价、成交数量、卖出金额、已实现盈亏与收益率。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Table, Column } from '../ui/Table';
import { NetAmount } from '../ui/Amount';
import { invoke } from '../../hooks/useIpc';
import { formatDate } from '../../../shared/utils/date-format';

export interface RecentSellRow {
  id: number; name: string; code: string; currency: string;
  quantity: number; price: number; total_amount: number;
  cost_price: number | null; realized_pnl: number | null; rate_pct: number | null;
}

export interface RecentSellDay {
  date: string;
  sells: RecentSellRow[];
  sellCount: number;
  realizedPnl: number;
  sellAmount: number;
}

function dayLabel(i: number): string {
  if (i === 0) return '今天';
  if (i === 1) return '昨天';
  return i + ' 天前';
}

function fmtPnl(v: number | null): { text: string; color: string } {
  if (v === null || v === undefined) return { text: '—', color: 'var(--color-text-muted)' };
  return {
    text: (v >= 0 ? '+' : '') + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    color: v >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
  };
}

const columns: Column<RecentSellRow>[] = [
  { key: 'name', title: '名称', render: (r) => (
    <span>
      <span>{r.name}</span>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: 6 }}>{r.code}</span>
    </span>
  )},
  { key: 'cost_price', title: '成本价', align: 'right', render: (r) => (
    r.cost_price != null ? <span>{r.cost_price.toFixed(3)}</span> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  )},
  { key: 'price', title: '成交价', align: 'right', render: (r) => <span>{r.price.toFixed(3)}</span> },
  { key: 'quantity', title: '成交数量', align: 'right', render: (r) => <span>{r.quantity.toLocaleString()}</span> },
  { key: 'total_amount', title: '卖出金额', align: 'right', render: (r) => <NetAmount value={r.total_amount} currency={r.currency} /> },
  { key: 'realized_pnl', title: '已实现盈亏', align: 'right', render: (r) => {
    const p = fmtPnl(r.realized_pnl);
    return <span style={{ color: p.color, fontWeight: 600 }}>{p.text}</span>;
  }},
  { key: 'rate_pct', title: '收益率', align: 'right', render: (r) => {
    if (r.rate_pct === null || r.rate_pct === undefined) {
      return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
    }
    return (
      <span style={{ color: r.rate_pct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
        {r.rate_pct >= 0 ? '+' : ''}{r.rate_pct.toFixed(2)}%
      </span>
    );
  }},
];

// v1.10.19：天数窗口选择（3/7/30 天）
const DAY_OPTIONS = [3, 7, 30];

export function RecentSellPnlCard() {
  const [days, setDays] = useState<RecentSellDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState(3);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    invoke<RecentSellDay[]>('report:recentSellPnl', range)
      .then((d) => setDays(d || []))
      .catch((err: any) => {
        // v1.10.19：加载失败不再静默当成无数据——展示错误与重试
        console.error('Failed to load recent sell pnl:', err);
        setLoadError(err?.message || '加载失败，请重试');
        setDays([]);
      })
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 'var(--spacing-sm)' }}>
        <h3 className="card-title" style={{ margin: 0 }}>📋 投资收益明细（近 {range} 天卖出收益）</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            className="form-select"
            style={{ width: 96, padding: '3px 6px', fontSize: 'var(--font-size-xs)' }}
            value={range}
            onChange={(e) => setRange(parseInt(e.target.value, 10))}
          >
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>{'近 ' + d + ' 天'}</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>🔄 刷新</Button>
        </div>
      </div>
      {loadError ? (
        <div style={{ padding: 'var(--spacing-md)', textAlign: 'center' }}>
          <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-sm)' }}>⚠️ 加载失败：{loadError}</div>
          <Button variant="secondary" size="sm" onClick={load}>🔄 重试</Button>
        </div>
      ) : loading && days === null ? (
        <div className="card-placeholder">加载中...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          {days && days.map((day, i) => (
            <div key={day.date}>
              {/* 天分组头 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-xs)' }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)' }}>
                  📅 {dayLabel(i)} · {formatDate(day.date)}
                </span>
                {day.sellCount > 0 ? (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {day.sellCount} 笔卖出 · 卖出金额{' '}
                    {day.sellAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' · '}已实现盈亏{' '}
                    <b style={{ color: day.realizedPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {day.realizedPnl >= 0 ? '+' : ''}{day.realizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </b>
                  </span>
                ) : null}
              </div>
              {day.sellCount > 0 ? (
                <Table scrollable columns={columns} data={day.sells} rowKey={(r) => r.id} />
              ) : (
                <div className="card-placeholder">当日无卖出</div>
              )}
              {i < days.length - 1 && (
                <div style={{ height: 1, background: 'var(--color-border)', margin: 'var(--spacing-md) 0' }} />
              )}
            </div>
          ))}
          {days && days.every((d) => d.sellCount === 0) && !loadError && (
            <div className="card-placeholder">{'近 ' + range + ' 天没有卖出交易'}</div>
          )}
        </div>
      )}
    </Card>
  );
}
