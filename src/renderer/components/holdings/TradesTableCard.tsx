/**
 * TradesTableCard — 交易记录表格 + 编辑/删除交易弹窗（自 HoldingsDetail 拆分）。
 */
import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Table, Column } from '../ui/Table';
import { Amount } from '../ui/Amount';
import { Badge } from '../ui/Badge';
import { invoke } from '../../hooks/useIpc';

export interface TradeRecord {
  id: number; asset_id: number; type: string; quantity: number; price: number;
  fee: number; total_amount: number; currency: string; date: string; notes: string | null;
  asset_name: string; asset_code: string;
}

interface Props {
  trades: TradeRecord[];
  onChanged: () => void;
}

export function TradesTableCard({ trades, onChanged }: Props) {
  const [editingTrade, setEditingTrade] = useState<TradeRecord | null>(null);
  const [deletingTrade, setDeletingTrade] = useState<TradeRecord | null>(null);

  const handleEditTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrade) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const quantity = parseFloat(fd.get('quantity') as string);
    const price = parseFloat(fd.get('price') as string);
    const fee = parseFloat(fd.get('fee') as string) || 0;
    try {
      await invoke('transaction:update', editingTrade.id, {
        type: fd.get('type'), quantity, price, fee,
        currency: fd.get('currency'), date: fd.get('date'), notes: fd.get('notes'),
      });
      setEditingTrade(null);
      onChanged();
    } catch (err: any) { console.error(err); }
  };

  const handleDeleteTrade = async () => {
    if (!deletingTrade) return;
    try {
      await invoke('transaction:delete', deletingTrade.id);
      setDeletingTrade(null);
      onChanged();
    } catch (err: any) { console.error(err); }
  };

  const tradeColumns: Column<TradeRecord>[] = [
    { key: 'date', title: '日期', render: (r) => r.date },
    {
      key: 'type', title: '方向', align: 'center',
      render: (r) => (
        <Badge
          label={r.type === 'buy' ? '🟢 买入' : '🔴 卖出'}
          color={r.type === 'buy' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'asset', title: '股票',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.asset_name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.asset_code}</div>
        </div>
      ),
    },
    { key: 'quantity', title: '数量', align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'price', title: '价格', align: 'right', render: (r) => <Amount value={r.price} currency={r.currency} showSign={false} size="sm" /> },
    {
      key: 'total_amount', title: '金额', align: 'right',
      render: (r) => (
        <span style={{ color: r.type === 'buy' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 500 }}>
          {r.type === 'buy' ? '-' : '+'}
          <Amount value={r.total_amount} currency={r.currency} showSign={false} />
        </span>
      ),
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <Button variant="secondary" size="sm" onClick={() => setEditingTrade(r)}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeletingTrade(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📜 交易记录">
          <Table columns={tradeColumns} data={trades} rowKey={(r) => r.id} emptyText="暂无交易记录" />
        </Card>
      </div>

      {/* ── Edit Trade Modal ── */}
      <Modal open={!!editingTrade} title="✏️ 编辑交易记录" onClose={() => setEditingTrade(null)}>
        {editingTrade && (
          <form onSubmit={handleEditTrade}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">方向</label>
                <select className="form-select" name="type" defaultValue={editingTrade.type}>
                  <option value="buy">🟢 买入</option>
                  <option value="sell">🔴 卖出</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-select" name="currency" defaultValue={editingTrade.currency}>
                  <option value="CNY">¥ 人民币</option>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">数量 *</label>
                <input className="form-input" name="quantity" type="number" step="any" defaultValue={editingTrade.quantity} required />
              </div>
              <div className="form-group">
                <label className="form-label">价格 *</label>
                <input className="form-input" name="price" type="number" step="any" defaultValue={editingTrade.price} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">手续费</label>
                <input className="form-input" name="fee" type="number" step="any" defaultValue={editingTrade.fee} />
              </div>
              <div className="form-group">
                <label className="form-label">日期</label>
                <input className="form-input" name="date" type="date" defaultValue={editingTrade.date} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingTrade.notes || ''} />
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingTrade(null)} type="button">取消</Button>
              <Button variant="primary" type="submit">保存修改</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Trade Modal ── */}
      <Modal open={!!deletingTrade} title="🗑 删除交易记录" onClose={() => setDeletingTrade(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除此交易记录吗？持仓数据将自动回滚。</p>
          {deletingTrade && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {deletingTrade.type === 'buy' ? '🟢 买入' : '🔴 卖出'} · {deletingTrade.asset_name} · {deletingTrade.quantity}股@{deletingTrade.price} · {deletingTrade.date}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setDeletingTrade(null)}>取消</Button>
            <Button variant="danger" onClick={handleDeleteTrade}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
