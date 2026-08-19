/**
 * RecentSellPnlCard — 投资收益明细（v1.10.0）。
 * 只显示卖出交易（买入不创造收益），按最近 3 天分组：今天 → 昨天 → 前天，
 * 每天展示卖出交易的成本价（当日(含)前买入加权平均）、成交价、成交数量、卖出金额、已实现盈亏与收益率。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Table, Column } from '../ui/Table';
import { NetAmount } from '../ui/Amount';
import { invoke } from '../../hooks/useIpc';

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

const DAY_LABELS = ['今天', '昨天', '前天'];

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

export function RecentSellPnlCard() {
  const [days, setDays] = useState<RecentSellDay[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    invoke<RecentSellDay[]>('report:recentSellPnl', 3)
      .then((d) => setDays(d || []))
      .catch((err) => { console.error('Failed to load recent sell pnl:', err); setDays([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card title="📋 投资收益明细（近 3 天卖出收益）">
      {loading && days === null ? (
        <div className="card-placeholder">加载中...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          {days && days.map((day, i) => (
            <div key={day.date}>
              {/* 天分组头 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-xs)' }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)' }}>
                  📅 {DAY_LABELS[i] || '更早'} · {day.date}
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
                <Table columns={columns} data={day.sells} rowKey={(r) => r.id} />
              ) : (
                <div className="card-placeholder">当日无卖出</div>
              )}
              {i < days.length - 1 && (
                <div style={{ height: 1, background: 'var(--color-border)', margin: 'var(--spacing-md) 0' }} />
              )}
            </div>
          ))}
          {days && days.every((d) => d.sellCount === 0) && (
            <div className="card-placeholder">近 3 天没有卖出交易</div>
          )}
        </div>
      )}
    </Card>
  );
}
