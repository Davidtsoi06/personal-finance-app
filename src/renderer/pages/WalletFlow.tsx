import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Column } from '../components/ui/Table';
import { Amount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';
import { useToast } from '../components/ui/Toast';

interface SystemWallet {
  id: number; name: string; type: string; currency: string; balance: number;
}

interface LedgerRow {
  id: number; type: string; amount: number; currency: string;
  category_id: number; category_name: string;
  account_id: number | null; date: string; description: string;
}

interface Category {
  id: number; name: string; type: string;
}

const WALLET_LABELS: Record<string, string> = {
  wechat: '微信支付', alipay: '支付宝', cash: '现金',
};

export function WalletFlow() {
  const { showToast } = useToast();
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();

  const [wallet, setWallet] = useState<SystemWallet | null>(null);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  // v1.8.0：分页加载
  const [limit, setLimit] = useState(200);

  // Add ledger
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ledgerType, setLedgerType] = useState<'income' | 'expense'>('expense');
  const [categories, setCategories] = useState<Category[]>([]);

  // Edit/delete
  const [editing, setEditing] = useState<LedgerRow | null>(null);
  const [deleting, setDeleting] = useState<LedgerRow | null>(null);

  // Bill import
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);

  const walletLabel = WALLET_LABELS[type || ''] || type || '钱包';

  const load = useCallback(async () => {
    try {
      const wallets = await invoke<SystemWallet[]>('wallet:getSystemWallets');
      const found = wallets?.find(w => {
        if (type === 'wechat') return w.name === '微信';
        if (type === 'alipay') return w.name === '支付宝';
        if (type === 'cash') return w.name === '现金';
        return false;
      });
      if (found) {
        setWallet(found);
        const list = await invoke<LedgerRow[]>('ledger:list', { accountId: found.id, limit });
        setLedgers(list || []);
      }
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [type, limit]);

  useEffect(() => { load(); }, [load]);

  // ── Categories for form ──
  useEffect(() => {
    if (showForm || editing) {
      invoke<Category[]>('category:list', ledgerType).then(d => setCategories(d || []));
    }
  }, [showForm, editing, ledgerType]);

  // ── Add Ledger ──
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) return;
    setSaving(true);
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = {
      account_id: wallet.id,
      type: ledgerType,
    };
    fd.forEach((v, k) => { data[k] = v; });
    const amount = parseFloat(String(fd.get('amount') ?? '0')) || 0;
    data.amount = amount;
    data.category_id = parseInt(String(fd.get('category_id') ?? '0')) || 0;
    if (amount <= 0) { setSaving(false); return; }
    try {
      await invoke('ledger:create', data);
      setShowForm(false);
      load();
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  // ── Edit Ledger ──
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = {};
    fd.forEach((v, k) => { data[k] = v; });
    const amount = parseFloat(String(fd.get('amount') ?? '0')) || 0;
    data.amount = amount;
    if (amount <= 0) { setSaving(false); return; }
    try {
      await invoke('ledger:update', editing.id, data);
      setEditing(null);
      load();
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await invoke('ledger:delete', deleting.id);
      setDeleting(null);
      load();
    } catch (err) { console.error(err); }
  };

  // ── Bill Import ──
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !csvText.trim()) return;
    setImporting(true);
    setImportStatus('正在解析并导入...');
    try {
      const lines = csvText.split('\n').filter(l => l.trim());
      const records = lines.map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          date: cols[0] || '',
          description: cols[1] || '',
          amount: parseFloat(cols[2]) || 0,
          type: cols[3] === 'income' ? 'income' : 'expense',
        };
      }).filter(r => r.date && r.amount > 0);
      const result = await invoke<{ imported: number; errors: string[]; txIds: number[]; ledgerIds: number[] }>('wallet:importBills', wallet.id, records);
      setImportStatus(`✅ 成功导入 ${result.imported} 条记录`);
      setCsvText('');
      // v1.8.0：操作后撤销——一键回滚本次导入（删存取记录与记账，余额自动反冲）
      if (result.imported > 0) {
        showToast(`已导入 ${result.imported} 条账单并更新余额`, '撤销', async () => {
          for (const lid of [...result.ledgerIds].reverse()) {
            await invoke('ledger:delete', lid).catch(() => {});
          }
          for (const tid of [...result.txIds].reverse()) {
            await invoke('accountTransaction:delete', tid).catch(() => {});
          }
          load();
        });
      }
      load();
    } catch (err: any) {
      setImportStatus(`❌ 导入失败：${err.message}`);
    }
    setImporting(false);
  };

  const ledgerColumns: Column<LedgerRow>[] = [
    {
      key: 'date', title: '日期',
      render: (r) => r.date,
    },
    {
      key: 'type', title: '类型', align: 'center',
      render: (r) => (
        <Badge
          label={r.type === 'income' ? '📥 收入' : '📤 支出'}
          color={r.type === 'income' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'category', title: '分类',
      render: (r) => r.category_name || '—',
    },
    {
      key: 'description', title: '摘要',
      render: (r) => r.description || '—',
    },
    {
      key: 'amount', title: '金额', align: 'right',
      render: (r) => (
        <span style={{
          fontWeight: 600,
          color: r.type === 'income' ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          {r.type === 'income' ? '+' : '-'}
          <Amount value={r.amount} currency={r.currency} showSign={false} />
        </span>
      ),
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <Button variant="secondary" size="sm" onClick={() => { setEditing(r); setLedgerType(r.type as 'income' | 'expense'); }}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeleting(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  if (loading) return <div className="page-loading">加载中...</div>;
  if (!wallet) return <div className="page-loading">{walletLabel}账户不存在，请先在数据迁移中创建系统钱包</div>;

  const incomeTotal = ledgers.filter(l => l.type === 'income').reduce((s, l) => s + l.amount, 0);
  const expenseTotal = ledgers.filter(l => l.type === 'expense').reduce((s, l) => s + l.amount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <button onClick={() => navigate('/accounts')} className="page-back-link">← 返回资产管理</button>
        <h2 className="page-title">{walletLabel} · {wallet.name}</h2>
        <p className="page-subtitle">
          当前余额 <Amount value={wallet.balance} currency={wallet.currency} colored size="md" />
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="primary" onClick={() => { setLedgerType('income'); setShowForm(true); }}>
            📥 记账收入
          </Button>
          <Button variant="secondary" onClick={() => { setLedgerType('expense'); setShowForm(true); }}>
            📤 记账支出
          </Button>
          <Button variant="secondary" onClick={() => { setCsvText(''); setImportStatus(''); setShowImport(true); }}>
            📥 导入账单
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">当前余额</div>
          <div className="stat-card-value number">
            <Amount value={wallet.balance} currency={wallet.currency} colored />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">收入合计</div>
          <div className="stat-card-value number" style={{ color: 'var(--color-success)' }}>
            <Amount value={incomeTotal} currency={wallet.currency} colored={false} showSign={false} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">支出合计</div>
          <div className="stat-card-value number" style={{ color: 'var(--color-danger)' }}>
            <Amount value={expenseTotal} currency={wallet.currency} colored={false} showSign={false} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">流水笔数</div>
          <div className="stat-card-value number">{ledgers.length}</div>
        </div>
      </div>

      {/* Ledger list */}
      <Card title="📋 收支流水">
        <Table
          columns={ledgerColumns}
          data={ledgers}
          rowKey={(r) => r.id}
          emptyText="暂无收支记录"
        />
        {ledgers.length >= limit && (
          <div style={{ marginTop: 'var(--spacing-sm)', textAlign: 'center' }}>
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 200)}>
              加载更多（当前 {ledgers.length} 条）
            </Button>
          </div>
        )}
      </Card>

      {/* ── Add Ledger Modal ── */}
      <Modal
        open={showForm}
        title={ledgerType === 'income' ? '📥 记账收入' : '📤 记账支出'}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={handleAdd}>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <button type="button" onClick={() => setLedgerType('income')}
              style={{
                flex: 1, padding: 10, borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: ledgerType === 'income' ? 'var(--color-success)' : 'var(--color-border)',
                background: ledgerType === 'income' ? '#F6FFED' : 'var(--color-surface)',
                fontWeight: ledgerType === 'income' ? 600 : 400, cursor: 'pointer',
              }}>
              📥 收入
            </button>
            <button type="button" onClick={() => setLedgerType('expense')}
              style={{
                flex: 1, padding: 10, borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: ledgerType === 'expense' ? 'var(--color-danger)' : 'var(--color-border)',
                background: ledgerType === 'expense' ? '#FFF2F0' : 'var(--color-surface)',
                fontWeight: ledgerType === 'expense' ? 600 : 400, cursor: 'pointer',
              }}>
              📤 支出
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">金额 *</label>
            <input className="form-input" name="amount" type="number" step="0.01" required placeholder="0.00" autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">币种</label>
              <select className="form-select" name="currency" defaultValue="CNY">
                <option value="CNY">¥ 人民币</option>
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">日期</label>
              <input className="form-input" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">分类 *</label>
            <select className="form-select" name="category_id" required>
              <option value="">请选择</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">摘要</label>
            <input className="form-input" name="description" placeholder="消费说明" />
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowForm(false)} type="button">取消</Button>
            <Button variant={ledgerType === 'income' ? 'primary' : 'danger'} type="submit" disabled={saving}>
              {saving ? '保存中...' : '确认记账'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editing} title="✏️ 编辑流水" onClose={() => setEditing(null)}>
        {editing && (
          <form onSubmit={handleEdit}>
            <div className="form-group">
              <label className="form-label">金额 *</label>
              <input className="form-input" name="amount" type="number" step="0.01" defaultValue={editing.amount} required autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">类型</label>
                <select className="form-select" name="type" defaultValue={editing.type}>
                  <option value="income">📥 收入</option>
                  <option value="expense">📤 支出</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-select" name="currency" defaultValue={editing.currency}>
                  <option value="CNY">¥ 人民币</option>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">日期</label>
              <input className="form-input" name="date" type="date" defaultValue={editing.date} />
            </div>
            <div className="form-group">
              <label className="form-label">摘要</label>
              <input className="form-input" name="description" defaultValue={editing.description || ''} />
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditing(null)} type="button">取消</Button>
              <Button variant="primary" type="submit" disabled={saving}>保存修改</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Modal ── */}
      <Modal open={!!deleting} title="🗑 删除流水" onClose={() => setDeleting(null)}>
        <p>确认删除此流水记录吗？余额将自动回滚。</p>
        {deleting && (
          <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', margin: 'var(--spacing-md) 0', fontSize: 'var(--font-size-sm)' }}>
            {deleting.type === 'income' ? '📥 收入' : '📤 支出'} · {deleting.currency} {deleting.amount.toLocaleString()} · {deleting.date} · {deleting.description}
          </div>
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setDeleting(null)}>取消</Button>
          <Button variant="danger" onClick={handleDelete}>确认删除</Button>
        </div>
      </Modal>

      {/* ── Bill Import Modal ── */}
      <Modal open={showImport} title="📥 导入账单" onClose={() => setShowImport(false)}>
        <form onSubmit={handleImport}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            粘贴 CSV 账单数据，格式：日期, 摘要, 金额, 类型(income/expense)
          </p>
          <textarea
            className="form-input"
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder="2026-08-01, 午餐, 35.00, expense&#10;2026-08-01, 工资, 5000.00, income"
            rows={8}
            style={{ height: 'auto', fontFamily: 'var(--font-family-number)', fontSize: 'var(--font-size-xs)' }}
          />
          {importStatus && (
            <div style={{
              marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm) var(--spacing-md)',
              background: importStatus.startsWith('✅') ? '#F6FFED' : importStatus.startsWith('❌') ? '#FFF2F0' : '#E6F7FF',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
            }}>
              {importStatus}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowImport(false)} type="button">取消</Button>
            <Button variant="primary" type="submit" disabled={importing || !csvText.trim()}>
              {importing ? '导入中...' : '导入'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
