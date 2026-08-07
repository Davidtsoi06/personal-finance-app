import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { AddAccountForm } from '../components/forms/AddAccountForm';
import { invoke } from '../hooks/useIpc';
import { ACCOUNT_TYPE_LABELS } from '@shared/constants/labels';

interface Account {
  id: number; name: string; type: string; currency: string;
  balance: number; bank_name: string | null; is_active: number;
}

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    invoke<Account[]>('account:list').then((d) => { setAccounts(d || []); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

  const columns: Column<Account>[] = [
    { key: 'name', title: '账户名称', render: (r) => (
      <div>
        <div style={{ fontWeight: 500 }}>{r.name}</div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {r.bank_name || ACCOUNT_TYPE_LABELS[r.type] || r.type}
        </div>
      </div>
    )},
    { key: 'type', title: '类型', render: (r) => ACCOUNT_TYPE_LABELS[r.type] || r.type },
    { key: 'currency', title: '币种', align: 'center' },
    { key: 'balance', title: '余额', align: 'right', render: (r) => (
      <Amount value={r.balance} currency={r.currency} colored />
    )},
  ];

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">账户管理</h2>
        <p className="page-subtitle">管理你的银行卡、现金和在线支付账户 — 点击账户查看存取记录</p>
        <Button variant="primary" onClick={() => setShowAdd(true)}>+ 添加账户</Button>
      </div>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">账户总数</div>
          <div className="stat-card-value number">{accounts.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">总余额</div>
          <div className="stat-card-value number"><Amount value={totalBalance} currency="CNY" colored /></div>
        </div>
      </div>
      <Card>
        <Table
          columns={columns}
          data={accounts}
          rowKey={(r) => r.id}
          emptyText="暂无账户"
          onRowClick={(row) => navigate(`/accounts/${row.id}`)}
        />
      </Card>

      <Modal open={showAdd} title="添加账户" onClose={() => setShowAdd(false)}>
        <AddAccountForm onClose={() => setShowAdd(false)} onSaved={load} />
      </Modal>
    </div>
  );
}
