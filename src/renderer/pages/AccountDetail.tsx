import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Column } from '../components/ui/Table';
import { Amount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';
import { ACCOUNT_TYPE_LABELS } from '@shared/constants/labels';

interface Account {
  id: number; name: string; type: string; currency: string;
  balance: number; bank_name: string | null; card_number: string | null;
}

interface AccountTransaction {
  id: number; account_id: number; type: 'deposit' | 'withdraw';
  amount: number; currency: string; date: string; notes: string | null;
}

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdraw'>('deposit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const accountId = parseInt(id || '0');

  const load = useCallback(async () => {
    try {
      const [acc, txs] = await Promise.all([
        invoke<Account>('account:get', accountId),
        invoke<AccountTransaction[]>('accountTransaction:list', accountId),
      ]);
      setAccount(acc);
      setTransactions(txs || []);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

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

    try {
      await invoke('accountTransaction:create', data);
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
    setSaving(false);
  };

  const columns: Column<AccountTransaction>[] = [
    {
      key: 'date', title: '日期',
      render: (r) => r.date,
    },
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
  ];

  if (loading) return <div className="page-loading">加载中...</div>;
  if (!account) return <div className="page-loading">账户不存在</div>;

  return (
    <div className="page">
      <div className="page-header">
        <button
          onClick={() => navigate('/accounts')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-500)',
            padding: 0, marginBottom: 'var(--spacing-xs)',
          }}
        >
          ← 返回账户列表
        </button>
        <h2 className="page-title">{account.name}</h2>
        <p className="page-subtitle">
          {ACCOUNT_TYPE_LABELS[account.type] || account.type}
          {account.bank_name && ` · ${account.bank_name}`}
          {account.card_number && ` · ${account.card_number}`}
          {' · '}当前余额 <Amount value={account.balance} currency={account.currency} colored size="md" />
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="primary" onClick={() => { setTxType('deposit'); setShowForm(true); }}>
            📥 存入
          </Button>
          <Button variant="secondary" onClick={() => { setTxType('withdraw'); setShowForm(true); }}>
            📤 取出
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">当前余额</div>
          <div className="stat-card-value number">
            <Amount value={account.balance} currency={account.currency} colored />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">交易次数</div>
          <div className="stat-card-value number">{transactions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">最近交易</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-sm)' }}>
            {transactions.length > 0 ? transactions[0].date : '暂无'}
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <Card title="📋 存取记录">
        <Table
          columns={columns}
          data={transactions}
          rowKey={(r) => r.id}
          emptyText="暂无存取记录，点击上方按钮添加"
        />
      </Card>

      {/* Deposit/Withdraw Modal */}
      <Modal
        open={showForm}
        title={txType === 'deposit' ? '📥 存入资金' : '📤 取出资金'}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <button
              type="button"
              onClick={() => setTxType('deposit')}
              style={{
                flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-border)',
                background: txType === 'deposit' ? '#F6FFED' : 'var(--color-surface)',
                color: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-text-muted)',
                fontWeight: txType === 'deposit' ? 600 : 400,
                cursor: 'pointer', fontSize: 'var(--font-size-md)',
              }}
            >
              📥 存入
            </button>
            <button
              type="button"
              onClick={() => setTxType('withdraw')}
              style={{
                flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-border)',
                background: txType === 'withdraw' ? '#FFF2F0' : 'var(--color-surface)',
                color: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                fontWeight: txType === 'withdraw' ? 600 : 400,
                cursor: 'pointer', fontSize: 'var(--font-size-md)',
              }}
            >
              📤 取出
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">金额 *</label>
            <input
              className="form-input" name="amount" type="number" step="any"
              required placeholder="0.00" autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">币种</label>
              <select className="form-select" name="currency" defaultValue={account.currency}>
                <option value="CNY">¥ 人民币</option>
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">日期</label>
              <input
                className="form-input" name="date" type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">备注</label>
            <input className="form-input" name="notes" placeholder="如：工资入账 / 取现" />
          </div>

          {error && (
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: '#FFF2F0', borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-md)',
            }}>
              {error}
            </div>
          )}

          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowForm(false)} type="button">取消</Button>
            <Button variant={txType === 'deposit' ? 'primary' : 'danger'} type="submit" disabled={saving}>
              {saving ? '处理中...' : txType === 'deposit' ? '确认存入' : '确认取出'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
