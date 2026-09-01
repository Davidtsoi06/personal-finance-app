/**
 * CashFlowCard — 券商现金流水卡片（列表 + 余额校正，v1.5.6 新增）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Table, Column } from '../ui/Table';
import { Amount } from '../ui/Amount';
import { Badge } from '../ui/Badge';
import { invoke } from '../../hooks/useIpc';

interface CashFlowRow {
  id: number;
  investment_account_id: number;
  type: string;
  amount: number;
  asset_id: number | null;
  transaction_id: number | null;
  currency: string;
  date: string;
  notes: string | null;
  balance_after: number | null;
  created_at: string;
  asset_name?: string | null;
  asset_code?: string | null;
}

const FLOW_META: Record<string, { label: string; color: 'success' | 'danger' | 'warning' | 'default' | 'info' }> = {
  deposit: { label: '存入', color: 'success' },
  withdraw: { label: '取出', color: 'danger' },
  buy: { label: '买入', color: 'danger' },
  sell: { label: '卖出', color: 'success' },
  dividend: { label: '分红', color: 'success' },
  adjust: { label: '校正', color: 'warning' },
};

interface Props {
  accountId: number;
  onChanged: () => void;
  /** v1.10.13：外部数据变更后递增，强制重新加载（交易保存后现金余额立即刷新） */
  refreshKey?: number;
}

export function CashFlowCard({ accountId, onChanged, refreshKey }: Props) {
  const [flows, setFlows] = useState<CashFlowRow[]>([]);
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState('CNY');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustInput, setAdjustInput] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  const load = useCallback(async () => {
    try {
      const [acc, f] = await Promise.all([
        invoke<any>('investmentAccount:get', accountId).catch(() => null),
        invoke<CashFlowRow[]>('investmentAccount:cashFlows', accountId).catch(() => []),
      ]);
      setBalance(acc?.cash_balance ?? 0);
      setCurrency(acc?.currency || 'CNY');
      setFlows(f || []);
    } catch { /* ignore */ }
  }, [accountId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAdjust = async () => {
    const target = parseFloat(adjustInput);
    if (!Number.isFinite(target)) { setAdjustError('请输入有效金额'); return; }
    setAdjustSaving(true); setAdjustError('');
    try {
      await invoke('investmentAccount:adjustCash', accountId, target, adjustNotes.trim() || undefined);
      setShowAdjust(false); setAdjustInput(''); setAdjustNotes('');
      load(); onChanged();
    } catch (err: any) { setAdjustError(err.message || '校正失败'); }
    setAdjustSaving(false);
  };

  const columns: Column<CashFlowRow>[] = [
    { key: 'date', title: '日期', render: (r) => r.date },
    {
      key: 'type', title: '类型', align: 'center',
      render: (r) => {
        const meta = FLOW_META[r.type] || { label: r.type, color: 'default' as const };
        return <Badge label={meta.label} color={meta.color} />;
      },
    },
    {
      key: 'asset', title: '关联股票',
      render: (r) => (r.asset_name ? (
        <div>
          <div style={{ fontWeight: 500 }}>{r.asset_name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.asset_code}</div>
        </div>
      ) : (
        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      )),
    },
    {
      key: 'amount', title: '金额', align: 'right',
      render: (r) => <Amount value={r.amount} currency={r.currency} colored />,
    },
    {
      key: 'balance_after', title: '变动后余额', align: 'right',
      render: (r) => (r.balance_after !== null ? (
        <span style={{ color: r.balance_after < 0 ? 'var(--color-danger)' : 'inherit' }}>
          {r.currency} {r.balance_after.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ) : '—'),
    },
    { key: 'notes', title: '备注', render: (r) => r.notes || '—' },
  ];

  return (
    <>
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="💰 现金流水">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              当前现金余额：
              <span style={{
                fontSize: 'var(--font-size-lg)', fontWeight: 700,
                color: balance < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)',
              }}>
                {currency} {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {balance < 0 && <Badge label="余额为负：现金与交易记录可能不一致" color="danger" />}
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setAdjustInput(String(balance)); setAdjustNotes(''); setAdjustError(''); setShowAdjust(true); }}>
              ⚖️ 余额校正
            </Button>
          </div>
          <Table
            columns={columns}
            data={flows}
            rowKey={(r) => r.id}
            emptyText="暂无现金流水（存入/取出/买卖后自动记录）"
          />
        </Card>
      </div>

      {/* ── 余额校正 Modal ── */}
      <Modal open={showAdjust} title="⚖️ 余额校正" onClose={() => setShowAdjust(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
            输入券商账户的真实现金余额，差额将以「校正」流水入账。
            用于对齐历史数据（迁移前的现金与交易记录差异）。
          </p>
          <div className="form-group">
            <label className="form-label">真实现金余额（{currency}）</label>
            <input
              className="form-input" type="number" step="0.01"
              value={adjustInput}
              onChange={(e) => setAdjustInput(e.target.value)}
              placeholder="0.00" autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">备注（可选）</label>
            <input className="form-input" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} placeholder="如：对账单核对" />
          </div>
          {adjustError && (
            <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {adjustError}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowAdjust(false)}>取消</Button>
            <Button variant="primary" onClick={handleAdjust} disabled={adjustSaving}>
              {adjustSaving ? '校正中...' : '确认校正'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
