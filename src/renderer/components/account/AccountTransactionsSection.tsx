/**
 * AccountTransactionsSection — 账户存取记录区块（列表 + 编辑/删除弹窗，自 AccountDetail 拆分）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Table, Column } from '../ui/Table';
import { Amount } from '../ui/Amount';
import { Badge } from '../ui/Badge';
import { invoke } from '../../hooks/useIpc';
import { AccountTxFormModal } from './AccountTxFormModal';

export interface AccountTransaction {
  id: number; account_id: number; type: 'deposit' | 'withdraw';
  amount: number; currency: string; date: string; notes: string | null;
}

interface Props {
  accountId: number;
  accountCurrency: string;
  transactions: AccountTransaction[];
  onTransactionsChange: (txs: AccountTransaction[]) => void;
  /** 余额发生变化后刷新账户数据 */
  onChanged: () => void;
}

export function AccountTransactionsSection({ accountId, accountCurrency, transactions, onTransactionsChange, onChanged }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdraw'>('deposit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingTx, setEditingTx] = useState<AccountTransaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<AccountTransaction | null>(null);
  const [invAccounts, setInvAccounts] = useState<Array<{id: number; name: string; broker: string | null; currency: string}>>([]);

  const loadTxs = useCallback(() => {
    invoke<AccountTransaction[]>('accountTransaction:list', accountId)
      .then((txs) => onTransactionsChange(txs || []));
  }, [accountId]);

  useEffect(() => { loadTxs(); }, [loadTxs]);

  // Load investment accounts for transfer dropdown
  useEffect(() => {
    if (showForm) {
      invoke<Array<{id: number; name: string; broker: string | null; currency: string}>>('investmentAccount:list')
        .then(list => setInvAccounts(list || []))
        .catch(() => {});
    }
  }, [showForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = { account_id: accountId, type: txType };
    new FormData(form).forEach((v, k) => { data[k] = v; });
    const amount = parseFloat((data.amount ?? '') as string) || 0;
    data.amount = amount;
    if (amount <= 0 || isNaN(amount)) {
      setError('金额必须大于 0');
      setSaving(false);
      return;
    }
    // 归一化 investment_account_id："不转入"（空串/0）时不提交该字段，否则转数字（v1.6.1 修复取出报错）
    if (data.investment_account_id === '' || data.investment_account_id === '0' || data.investment_account_id == null) {
      delete data.investment_account_id;
    } else {
      data.investment_account_id = parseInt(String(data.investment_account_id), 10);
    }
    try {
      await invoke('accountTransaction:create', data);
      setShowForm(false);
      loadTxs();
      onChanged();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
    setSaving(false);
  };

  const handleEditTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    setSaving(true);
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    const amount = parseFloat((data.amount ?? '') as string) || 0;
    if (amount <= 0 || isNaN(amount)) { setSaving(false); return; }
    try {
      await invoke('accountTransaction:update', editingTx.id, { ...data, amount });
      setEditingTx(null);
      loadTxs();
      onChanged();
    } catch (err: any) { console.error(err); }
    setSaving(false);
  };

  const handleDeleteTx = async () => {
    if (!deletingTx) return;
    try {
      await invoke('accountTransaction:delete', deletingTx.id);
      setDeletingTx(null);
      loadTxs();
      onChanged();
    } catch (err: any) { console.error(err); }
  };

  const columns: Column<AccountTransaction>[] = [
    { key: 'date', title: '日期', render: (r) => r.date },
    {
      key: 'type', title: '类型', align: 'center',
      render: (r) => (
        <Badge
          label={r.type === 'deposit' ? '📥 存入' : '📤 取出'}
          color={r.type === 'deposit' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'amount', title: '金额', align: 'right',
      render: (r) => (
        <span style={{
          fontWeight: 600,
          color: r.type === 'deposit' ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          {r.type === 'deposit' ? '+' : '-'}
          <Amount value={r.amount} currency={r.currency} showSign={false} />
        </span>
      ),
    },
    {
      key: 'notes', title: '备注',
      render: (r) => r.notes || <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <Button variant="secondary" size="sm" onClick={() => setEditingTx(r)}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeletingTx(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card title="📋 存取记录">
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <Button variant="primary" size="sm" onClick={() => { setTxType('deposit'); setShowForm(true); }}>📥 存入</Button>{' '}
          <Button variant="secondary" size="sm" onClick={() => { setTxType('withdraw'); setShowForm(true); }}>📤 取出</Button>
        </div>
        <Table
          columns={columns}
          data={transactions}
          rowKey={(r) => r.id}
          emptyText="暂无存取记录，点击上方按钮添加"
        />
      </Card>

      <AccountTxFormModal
        open={showForm}
        txType={txType}
        onTypeChange={setTxType}
        accountCurrency={accountCurrency}
        invAccounts={invAccounts}
        saving={saving}
        error={error}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
      />

      {/* ── Edit Transaction Modal ── */}
      <Modal open={!!editingTx} title="✏️ 编辑存取记录" onClose={() => setEditingTx(null)}>
        {editingTx && (
          <form onSubmit={handleEditTx}>
            <div className="form-group">
              <label className="form-label">金额 *</label>
              <input className="form-input" name="amount" type="number" step="any" defaultValue={editingTx.amount} required autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">类型</label>
                <select className="form-select" name="type" defaultValue={editingTx.type}>
                  <option value="deposit">📥 存入</option>
                  <option value="withdraw">📤 取出</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-select" name="currency" defaultValue={editingTx.currency}>
                  <option value="CNY">¥ 人民币</option>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">日期</label>
              <input className="form-input" name="date" type="date" defaultValue={editingTx.date} />
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingTx.notes || ''} />
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingTx(null)} type="button">取消</Button>
              <Button variant="primary" type="submit" disabled={saving}>保存修改</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Transaction Modal ── */}
      <Modal open={!!deletingTx} title="🗑 删除存取记录" onClose={() => setDeletingTx(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除此存取记录吗？余额将自动回滚。</p>
          {deletingTx && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {deletingTx.type === 'deposit' ? '📥 存入' : '📤 取出'} · {deletingTx.currency} {deletingTx.amount.toLocaleString()} · {deletingTx.date}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setDeletingTx(null)}>取消</Button>
            <Button variant="danger" onClick={handleDeleteTx}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
