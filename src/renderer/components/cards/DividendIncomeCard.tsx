/**
 * DividendIncomeCard — 股息收入卡片（v1.10.21）。
 * 按年汇总，按「代码 + 币种」跨账户合并（与年度已实现盈亏同口径）：税前 / 预扣税 / 实收 / 笔数。
 */
import { useState, useCallback, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Table, Column } from '../ui/Table';
import { invoke } from '../../hooks/useIpc';

interface DividendAccountRow {
  assetId: number; accountId: number | null; accountName: string;
  gross: number; tax: number; net: number; count: number;
}

interface DividendEntry {
  key: string; code: string; name: string; currency: string;
  gross: number; tax: number; net: number; count: number;
  accountCount: number; accounts: DividendAccountRow[];
}

interface DividendResult {
  gross: number; tax: number; net: number; count: number; byAsset: DividendEntry[];
}

const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DividendIncomeCard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<DividendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);

  const load = useCallback(async (y: number) => {
    setLoading(true); setError('');
    try {
      setData(await invoke<DividendResult>('report:dividendIncome', y));
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(year); }, [load, year]);

  const columns: Column<DividendEntry>[] = [
    {
      key: 'name', title: '名称/代码',
      render: (r) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.accountCount > 1 && (
              <button
                onClick={() => setExpanded((list) => list.includes(r.key) ? list.filter((k) => k !== r.key) : [...list, r.key])}
                title={expanded.includes(r.key) ? '收起各账户明细' : '展开各账户明细'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-primary-500)', fontSize: 'var(--font-size-xs)', padding: 0 }}
              >
                {expanded.includes(r.key) ? '▾' : '▸'}
              </button>
            )}
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            {r.accountCount > 1 && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>（{r.accountCount} 个账户合并）</span>
            )}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.code}</div>
        </div>
      ),
    },
    { key: 'gross', title: '税前', align: 'right', render: (r) => <span>{money(r.gross)} {r.currency}</span> },
    { key: 'tax', title: '预扣税', align: 'right', render: (r) => <span style={{ color: r.tax > 0 ? 'var(--color-warning, #E6A23C)' : 'var(--color-text-muted)' }}>{money(r.tax)}</span> },
    { key: 'net', title: '实收', align: 'right', render: (r) => <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{money(r.net)}</span> },
    { key: 'count', title: '笔数', align: 'center' },
  ];

  const rows: DividendEntry[] = (data?.byAsset || []).flatMap((r) => expanded.includes(r.key)
    ? [r, ...r.accounts.map((a) => ({
        ...a, key: r.key + '#' + a.assetId, code: '', name: '　↳ ' + a.accountName,
        currency: r.currency, accountCount: 0, accounts: [],
      } as DividendEntry))]
    : [r]);

  return (
    <div style={{ marginTop: 'var(--spacing-lg)' }}>
      <Card title="💰 股息收入（分红）">
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>年份：</label>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)', cursor: 'pointer' }}
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
                <div className="stat-card-label">股息实收总额</div>
                <div className="stat-card-value number" style={{ color: 'var(--color-success)' }}>
                  {data.net > 0 ? '+' + money(data.net) : '—'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">税前总额</div>
                <div className="stat-card-value number">{money(data.gross)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">预扣税</div>
                <div className="stat-card-value number">{money(data.tax)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">笔数 / 标的数</div>
                <div className="stat-card-value number">{data.count} / {data.byAsset.length}</div>
              </div>
            </div>
            {data.byAsset.length > 0 ? (
              <Table scrollable columns={columns} data={rows} rowKey={(r) => r.key} />
            ) : (
              <div className="card-placeholder">
                {year} 年暂无股息记录——在券商账户页「现金流水」点「💰 登记分红」即可记录（日结单导入也会自动识别股息行）
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
