/**
 * HoldingsTableCard — 持仓表格 + 编辑/删除持仓弹窗（自 HoldingsDetail 拆分）。
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Table, Column } from '../ui/Table';
import { Amount, PctAmount } from '../ui/Amount';
import { invoke } from '../../hooks/useIpc';
import { MARKET_LABELS, ASSET_TYPE_LABELS } from '@shared/constants/labels';

export interface Holding {
  id: number; name: string; code: string; type: string; market: string;
  currency: string; quantity: number; cost_price: number; current_price: number;
  market_value: number; total_cost: number; profit_loss: number; profit_loss_pct: number;
  investment_account_id?: number | null;
  notes?: string | null;
}

interface Props {
  holdings: Holding[];
  onRowClick: (row: Holding) => void;
  onPriceEdit: (h: Holding) => void;
  onChanged: () => void;
}

export function HoldingsTableCard({ holdings, onRowClick, onPriceEdit, onChanged }: Props) {
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [deleteHolding, setDeleteHolding] = useState<Holding | null>(null);
  const [invAccounts, setInvAccounts] = useState<Array<{id: number; name: string; broker: string | null}>>([]);

  useEffect(() => {
    invoke<Array<{id: number; name: string; broker: string | null}>>('investmentAccount:list')
      .then(list => setInvAccounts(list || []))
      .catch(() => {});
  }, []);

  const handleEditHolding = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingHolding) return;
    const fd = new FormData(e.currentTarget);
    const quantity = parseFloat(fd.get('quantity') as string);
    const costPrice = parseFloat(fd.get('cost_price') as string);
    const data: Record<string, any> = {
      name: fd.get('name'),
      code: fd.get('code'),
      type: fd.get('type'),
      market: fd.get('market'),
      currency: fd.get('currency'),
      notes: fd.get('notes'),
      investment_account_id: fd.get('investment_account_id') || null,
      quantity,
      cost_price: costPrice,
    };
    data.total_cost = quantity * costPrice;
    try {
      await invoke('asset:update', editingHolding.id, data);
      setEditingHolding(null);
      onChanged();
    } catch (err: any) {
      console.error('编辑持仓失败:', err);
    }
  };

  const handleDeleteHolding = async () => {
    if (!deleteHolding) return;
    try {
      await invoke('asset:delete', deleteHolding.id);
      setDeleteHolding(null);
      onChanged();
    } catch (err: any) {
      console.error('删除持仓失败:', err);
    }
  };

  const holdingColumns: Column<Holding>[] = [
    {
      key: 'name', title: '名称/代码',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {r.code} · {MARKET_LABELS[r.market] || r.market}
          </div>
        </div>
      ),
    },
    { key: 'type', title: '类型', render: (r) => ASSET_TYPE_LABELS[r.type] || r.type },
    { key: 'currency', title: '货币', align: 'center', render: (r) => <span style={{ fontWeight: 500 }}>{r.currency}</span> },
    { key: 'quantity', title: '持仓数量', align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'cost_price', title: '成本价', align: 'right', render: (r) => <Amount value={r.cost_price} currency={r.currency} showSign={false} size="sm" /> },
    {
      key: 'current_price', title: '最新价', align: 'right',
      render: (r) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Amount value={r.current_price} currency={r.currency} showSign={false} size="sm" />
          <Button variant="secondary" size="sm" onClick={() => onPriceEdit(r)}>✏️</Button>
        </div>
      ),
    },
    { key: 'market_value', title: '市值', align: 'right', render: (r) => <Amount value={r.market_value} currency={r.currency} showSign={false} /> },
    {
      key: 'profit_loss', title: '盈亏', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <Amount value={r.profit_loss} currency={r.currency} colored />
          <PctAmount value={r.profit_loss_pct} />
        </div>
      ),
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
          <Button variant="secondary" size="sm" onClick={() => setEditingHolding(r)}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeleteHolding(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card title="💼 当前持仓">
        <Table
          columns={holdingColumns}
          data={holdings}
          rowKey={(r) => r.id}
          onRowClick={onRowClick}
          emptyText="暂无持仓，点击「记录交易」或「导入日结单」"
        />
      </Card>

      {/* ── Edit Holding Modal ── */}
      <Modal
        open={editingHolding !== null}
        title={'✏️ 编辑持仓 · ' + (editingHolding?.name || '')}
        onClose={() => setEditingHolding(null)}
      >
        {editingHolding && (
          <form onSubmit={handleEditHolding}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">名称</label>
                <input className="form-input" name="name" defaultValue={editingHolding.name} required />
              </div>
              <div className="form-group">
                <label className="form-label">代码</label>
                <input className="form-input" name="code" defaultValue={editingHolding.code} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">类型</label>
                <select className="form-input" name="type" defaultValue={editingHolding.type}>
                  {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">市场</label>
                <select className="form-input" name="market" defaultValue={editingHolding.market}>
                  {Object.entries(MARKET_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">货币</label>
                <select className="form-input" name="currency" defaultValue={editingHolding.currency}>
                  <option value="CNY">CNY 人民币</option>
                  <option value="HKD">HKD 港币</option>
                  <option value="USD">USD 美元</option>
                  <option value="EUR">EUR 欧元</option>
                  <option value="JPY">JPY 日元</option>
                  <option value="GBP">GBP 英镑</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">持仓数量</label>
                <input className="form-input" name="quantity" type="number" step="any" defaultValue={editingHolding.quantity} required />
              </div>
              <div className="form-group">
                <label className="form-label">成本价</label>
                <input className="form-input" name="cost_price" type="number" step="any" defaultValue={editingHolding.cost_price} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingHolding.notes || ''} />
            </div>
            <div className="form-group">
              <label className="form-label">投资账户</label>
              <select className="form-select" name="investment_account_id" defaultValue={editingHolding.investment_account_id || ''}>
                <option value="">不关联</option>
                {invAccounts.map(ia => (
                  <option key={ia.id} value={ia.id}>📈 {ia.name}{ia.broker ? ' (' + ia.broker + ')' : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingHolding(null)} type="button">取消</Button>
              <Button variant="primary" type="submit">保存</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Holding Modal ── */}
      <Modal
        open={deleteHolding !== null}
        title="🗑 删除持仓"
        onClose={() => setDeleteHolding(null)}
      >
        {deleteHolding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <p>确认删除持仓「{deleteHolding.name}」({deleteHolding.code}) 吗？</p>
            <div style={{
              padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
            }}>
              <div>持仓数量：<b>{deleteHolding.quantity.toLocaleString()}</b></div>
              <div>当前市值：<b>{deleteHolding.currency} {deleteHolding.market_value.toLocaleString()}</b></div>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              此操作不可撤销，关联交易记录和价格历史将一并删除。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
              <Button variant="secondary" onClick={() => setDeleteHolding(null)}>取消</Button>
              <Button variant="danger" onClick={handleDeleteHolding}>确认删除</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
