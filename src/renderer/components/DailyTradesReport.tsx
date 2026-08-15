/**
 * DailyTradesReport — per-day trading report card.
 * Date picker (default today) + summary stats + trade detail table + Excel export.
 */
import { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { NetAmount } from './ui/Amount';
import { Table, Column } from './ui/Table';
import { Badge } from './ui/Badge';
import { invoke } from '../hooks/useIpc';
import { TRADE_TYPE_LABELS } from '@shared/constants/labels';

interface DailyTradeRow {
  id: number; date: string; type: string; quantity: number; price: number;
  fee: number; total_amount: number; currency: string; notes: string | null;
  created_at: string; name: string; code: string;
}

interface DailyTradesResult {
  date: string;
  rows: DailyTradeRow[];
  summary: {
    totalCount: number; buyCount: number; sellCount: number;
    buyAmount: number; sellAmount: number; realizedPnl: number;
  };
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function DailyTradesReport() {
  const [dailyDate, setDailyDate] = useState(todayStr());
  const [dailyTrades, setDailyTrades] = useState<DailyTradesResult | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyExporting, setDailyExporting] = useState(false);
  const [dailyExportMsg, setDailyExportMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDailyLoading(true);
    invoke<DailyTradesResult>('report:dailyTrades', dailyDate)
      .then((r) => { if (!cancelled) setDailyTrades(r || null); })
      .catch((err) => {
        console.error('Failed to load daily trades:', err);
        if (!cancelled) setDailyTrades(null);
      })
      .finally(() => { if (!cancelled) setDailyLoading(false); });
    return () => { cancelled = true; };
  }, [dailyDate]);

  const handleDailyExport = async () => {
    setDailyExporting(true);
    setDailyExportMsg(null);
    try {
      const r = await invoke<{ success: boolean; canceled?: boolean; rowCount?: number; error?: string }>(
        'export:dailyTrades', dailyDate
      );
      if (r.canceled) {
        setDailyExportMsg(null);
      } else if (r.success) {
        setDailyExportMsg(`✅ 导出成功！共 ${r.rowCount} 笔交易`);
      } else {
        setDailyExportMsg(`❌ ${r.error || '导出失败'}`);
      }
    } catch (err: any) {
      setDailyExportMsg(`❌ 导出失败：${err.message}`);
    }
    setDailyExporting(false);
  };

  const columns: Column<DailyTradeRow>[] = [
    { key: 'time', title: '时间', render: (r) => {
      const t = new Date(r.created_at);
      return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    }},
    { key: 'name', title: '名称', render: (r) => (
      <span>
        <span>{r.name}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: 6 }}>{r.code}</span>
      </span>
    )},
    { key: 'type', title: '方向', render: (r) => (
      <Badge label={TRADE_TYPE_LABELS[r.type] || r.type}
        color={r.type === 'buy' ? 'success' : r.type === 'sell' ? 'danger' : 'info'} />
    )},
    { key: 'quantity', title: '数量', align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'price', title: '价格', align: 'right', render: (r) => (r.price || 0).toFixed(2) },
    { key: 'fee', title: '手续费', align: 'right', render: (r) => (r.fee || 0).toFixed(2) },
    { key: 'total_amount', title: '金额', align: 'right', render: (r) => (
      <NetAmount value={r.total_amount} currency={r.currency} />
    )},
  ];

  const s = dailyTrades?.summary;
  const hasTrades = !!s && dailyTrades!.rows.length > 0;

  return (
    <Card title="🧾 每日交易报表">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {/* Date picker + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={dailyDate}
            max={todayStr()}
            onChange={(e) => { setDailyDate(e.target.value); setDailyExportMsg(null); }}
            style={{
              padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
              fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)', cursor: 'pointer',
            }}
          />
          <button
            onClick={() => { setDailyDate(todayStr()); setDailyExportMsg(null); }}
            style={{
              padding: '6px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
              fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)', cursor: 'pointer',
            }}
          >
            回到今天
          </button>
          <button
            onClick={handleDailyExport}
            disabled={dailyExporting || !hasTrades}
            style={{
              padding: '6px 20px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: dailyExporting || !hasTrades ? 'var(--color-text-muted)' : 'var(--color-primary)',
              color: '#fff', fontWeight: 600, fontSize: 'var(--font-size-sm)',
              cursor: dailyExporting || !hasTrades ? 'not-allowed' : 'pointer',
            }}
          >
            {dailyExporting ? '⏳ 导出中...' : '📥 导出当日 Excel'}
          </button>
          {dailyExportMsg && (
            <span style={{
              fontSize: 'var(--font-size-sm)',
              color: dailyExportMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)',
              padding: '4px 12px',
              background: dailyExportMsg.startsWith('✅') ? '#F6FFED' : '#FFF2F0',
              borderRadius: 'var(--radius-sm)',
            }}>
              {dailyExportMsg}
            </span>
          )}
        </div>

        {/* Summary stats */}
        {hasTrades && (
          <div className="stat-cards">
            <div className="stat-card">
              <div className="stat-card-label">总交易笔数</div>
              <div className="stat-card-value number">{s!.totalCount} 笔</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">买入</div>
              <div className="stat-card-value number" style={{ color: 'var(--color-success)' }}>
                {s!.buyCount} 笔 · ¥{s!.buyAmount.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">卖出</div>
              <div className="stat-card-value number" style={{ color: 'var(--color-danger)' }}>
                {s!.sellCount} 笔 · ¥{s!.sellAmount.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">已实现盈亏</div>
              <div className="stat-card-value number" style={{
                color: s!.realizedPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
              }}>
                {s!.realizedPnl >= 0 ? '+' : ''}¥{s!.realizedPnl.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Trade detail table */}
        {dailyLoading ? (
          <div className="card-placeholder">加载中...</div>
        ) : hasTrades ? (
          <Table columns={columns} data={dailyTrades!.rows} rowKey={(r) => r.id} />
        ) : (
          <div className="card-placeholder">当日无交易记录</div>
        )}
      </div>
    </Card>
  );
}
