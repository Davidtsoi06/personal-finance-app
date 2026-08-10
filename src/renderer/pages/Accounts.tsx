import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { invoke } from '../hooks/useIpc';
import { ACCOUNT_TYPE_LABELS } from '@shared/constants/labels';
import './Accounts.css';

interface AccountBalance {
  id: number; account_id: number; currency: string; balance: number;
}

interface Account {
  id: number; name: string; type: string; currency: string; balance: number;
  bank_name: string | null; card_number: string | null;
  asset_type: string;
  parent_account_id: number | null; sort_order: number;
  children: Account[]; balances: AccountBalance[];
}

interface InvAccount {
  id: number; name: string; broker: string | null; currency: string;
  account_number: string | null; funding_account_id?: number | null; notes: string | null;
  assetCount?: number; totalMarketValue?: number; totalProfitLoss?: number;
}

const ASSET_TYPE_OPTIONS = [
  { value: 'bank', label: '银行', icon: '🏦', desc: '银行卡、信用卡等' },
  { value: 'cash', label: '现金', icon: '💵', desc: '现金、钱包' },
  { value: 'insurance', label: '保险', icon: '🛡️', desc: '保单、保险产品' },
  { value: 'investment', label: '投资', icon: '📈', desc: '券商/基金账户' },
  { value: 'custom', label: '自定义', icon: '✏️', desc: '其他资产类型' },
];

const ASSET_TYPE_LABELS: Record<string, string> = {
  bank: '银行账户', cash: '现金', insurance: '保险',
  investment: '投资账户', custom: '自定义资产',
};

const ASSET_ICONS: Record<string, string> = {
  bank: '🏦', cash: '💵', insurance: '🛡️', investment: '📈', custom: '✏️',
};

interface SubAccount {
  key: number; name: string; card_number: string; currency: string; balance: number;
}
let subAccountKey = 0;

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investments, setInvestments] = useState<InvAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Two-step add state ──
  const [showAdd, setShowAdd] = useState(false);
  const [addStep, setAddStep] = useState<1 | 2>(1);
  const [selectedAssetType, setSelectedAssetType] = useState('');
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);

  // ── Edit / Delete for regular accounts ──
  const [editingAcc, setEditingAcc] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // ── Edit / Delete for investment accounts ──
  const [editingInv, setEditingInv] = useState<InvAccount | null>(null);
  const [deleteInvTarget, setDeleteInvTarget] = useState<InvAccount | null>(null);
  const [deleteInvError, setDeleteInvError] = useState('');
  const [deleteInvHoldingCount, setDeleteInvHoldingCount] = useState(0);

  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [accts, invs] = await Promise.all([
        invoke<Account[]>('account:listTree'),
        invoke<InvAccount[]>('investmentAccount:allSummary'),
      ]);
      setAccounts(accts || []);
      setInvestments(invs || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Open add modal ──
  const openAdd = () => {
    setAddStep(1);
    setSelectedAssetType('');
    setSubAccounts([]);
    setShowAdd(true);
  };

  // ── Step 1: select asset type → go to step 2 ──
  const goToStep2 = (assetType: string) => {
    setSelectedAssetType(assetType);
    if (assetType === 'bank') {
      setSubAccounts([{ key: ++subAccountKey, name: '', card_number: '', currency: 'CNY', balance: 0 }]);
    } else {
      setSubAccounts([]);
    }
    setAddStep(2);
  };

  // ── Sub-account helpers ──
  const addSubAccount = () => {
    setSubAccounts(prev => [...prev, { key: ++subAccountKey, name: '', card_number: '', currency: 'CNY', balance: 0 }]);
  };
  const removeSubAccount = (key: number) => {
    setSubAccounts(prev => prev.filter(s => s.key !== key));
  };
  const updateSubAccount = (key: number, field: string, value: string | number) => {
    setSubAccounts(prev => prev.map(s => s.key === key ? { ...s, [field]: value } : s));
  };

  // ── Add submit ──
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);

    try {
      if (selectedAssetType === 'investment') {
        // Create investment account
        const iaData: Record<string, unknown> = {
          name: fd.get('name'),
          broker: fd.get('broker') || null,
          currency: fd.get('currency') || 'CNY',
          account_number: fd.get('account_number') || null,
          funding_account_id: fd.get('funding_account_id') || null,
        };
        await invoke('investmentAccount:create', iaData);
      } else if (selectedAssetType === 'bank' && subAccounts.length > 0) {
        // Bulk create parent + children
        const children = subAccounts.map(sa => ({
          name: sa.name,
          type: (fd.get('type') as string) || 'bank_card',
          currency: sa.currency,
          balance: sa.balance,
          card_number: sa.card_number || undefined,
        }));
        await invoke('account:createWithChildren', {
          name: fd.get('name'),
          type: (fd.get('type') as string) || 'bank_card',
          asset_type: selectedAssetType,
          currency: fd.get('currency') || 'CNY',
          bank_name: fd.get('bank_name') || null,
          children,
        });
      } else {
        // Single account create
        const data: Record<string, unknown> = {};
        fd.forEach((v, k) => { data[k] = v; });
        if (data.parent_account_id === '') data.parent_account_id = null;
        data.asset_type = selectedAssetType;
        if (data.balance !== undefined) data.balance = parseFloat(data.balance as string) || 0;
        await invoke('account:create', data);
      }
      setShowAdd(false);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  // ── Edit regular account ──
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    if (data.parent_account_id === '') data.parent_account_id = null;
    if (data.balance !== undefined) data.balance = parseFloat(data.balance as string) || 0;
    try { await invoke('account:update', editingAcc!.id, data); setEditingAcc(null); load(); }
    catch (err) { console.error(err); }
  };

  // ── Delete regular account ──
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await invoke<{ success: boolean; error?: string }>('account:delete', deleteTarget.id);
      if (result.success) { setDeleteTarget(null); load(); }
      else { setDeleteError(result.error || '删除失败'); }
    } catch (err: any) { setDeleteError(err.message || '删除失败'); }
  };

  // ── Edit investment account ──
  const handleEditInv = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v || null; });
    try { await invoke('investmentAccount:update', editingInv!.id, data); setEditingInv(null); load(); }
    catch (err) { console.error(err); }
  };

  // ── Delete investment account ──
  const openDeleteInv = async (inv: InvAccount) => {
    // Check for holdings count
    try {
      const holdings = await invoke<any[]>('investmentAccount:holdings', inv.id);
      setDeleteInvHoldingCount(holdings?.length || 0);
    } catch { setDeleteInvHoldingCount(0); }
    setDeleteInvTarget(inv);
    setDeleteInvError('');
  };

  const handleDeleteInv = async () => {
    if (!deleteInvTarget) return;
    try {
      const result = await invoke<{ success: boolean; error?: string }>('investmentAccount:delete', deleteInvTarget.id);
      if (result.success) { setDeleteInvTarget(null); load(); }
      else { setDeleteInvError(result.error || '删除失败'); }
    } catch (err: any) { setDeleteInvError(err.message || '删除失败'); }
  };

  // ── Flatten tree for stats ──
  const allFlat: Account[] = [];
  const flatten = (list: Account[]) => {
    for (const a of list) { allFlat.push(a); if (a.children) flatten(a.children); }
  };
  flatten(accounts);

  const totalAcctBalance = allFlat.reduce((s, a) => s + (a.balance || 0), 0);
  const totalInvValue = investments.reduce((s, ia) => s + (ia.totalMarketValue || 0), 0);

  /** Get flat list of bank-type accounts for funding account dropdown. */
  function getBankOptions(): { id: number; name: string; currency: string }[] {
    const result: { id: number; name: string; currency: string }[] = [];
    function walk(list: Account[]) {
      for (const a of list) {
        if (a.asset_type === 'bank') {
          result.push({ id: a.id, name: a.name, currency: a.currency });
        }
        if (a.children) walk(a.children);
      }
    }
    walk(accounts);
    return result;
  }

  const parentOptions = allFlat
    .filter(a => a.type === 'bank_card' && !a.parent_account_id)
    .map(a => ({ id: a.id, name: a.name }));

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">资产管理</h2>
        <p className="page-subtitle">
          统一管理所有资产 · 共 {allFlat.length + investments.length} 个账户 · 总资产{' '}
          <Amount value={totalAcctBalance + totalInvValue} currency="CNY" colored />
        </p>
        <Button variant="primary" onClick={openAdd}>+ 添加资产</Button>
      </div>

      {/* Stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">账户总数</div>
          <div className="stat-card-value number">{allFlat.length + investments.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">现金/银行余额</div>
          <div className="stat-card-value number">
            <Amount value={totalAcctBalance} currency="CNY" colored />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">投资市值</div>
          <div className="stat-card-value number">
            <Amount value={totalInvValue} currency="CNY" colored />
          </div>
        </div>
      </div>

      {/* Tree View: accounts + investments */}
      {accounts.length === 0 && investments.length === 0 ? (
        <Card><div className="card-placeholder">暂无资产，点击「添加资产」开始</div></Card>
      ) : (
        <div className="account-tree">
          {accounts.length > 0 && renderTree(accounts, 0)}
          {investments.length > 0 && renderInvestmentGroup()}
        </div>
      )}

      {/* ── Two-Step Add Modal ── */}
      <Modal
        open={showAdd}
        title={addStep === 1 ? '选择资产类型' : `添加${ASSET_TYPE_LABELS[selectedAssetType] || ''}`}
        onClose={() => setShowAdd(false)}
      >
        {addStep === 1 ? (
          <div className="asset-type-grid">
            {ASSET_TYPE_OPTIONS.map(opt => (
              <div
                key={opt.value}
                className="asset-type-card"
                onClick={() => goToStep2(opt.value)}
              >
                <div className="asset-type-card-icon">{opt.icon}</div>
                <div className="asset-type-card-label">{opt.label}</div>
                <div className="asset-type-card-desc">{opt.desc}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
              <Button variant="secondary" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <AddFormByType
            assetType={selectedAssetType}
            subAccounts={subAccounts}
            onAddSubAccount={addSubAccount}
            onRemoveSubAccount={removeSubAccount}
            onUpdateSubAccount={updateSubAccount}
            onSubmit={handleAdd}
            onBack={() => setAddStep(1)}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </Modal>

      {/* ── Edit Regular Account Modal ── */}
      <Modal open={!!editingAcc} title="编辑账户" onClose={() => setEditingAcc(null)}>
        {editingAcc && (
          <EditAccountForm
            onSubmit={handleEdit}
            onCancel={() => setEditingAcc(null)}
            parentOptions={parentOptions.filter(p => p.id !== editingAcc.id)}
            initial={{
              name: editingAcc.name,
              type: editingAcc.type,
              asset_type: editingAcc.asset_type || '',
              currency: editingAcc.currency,
              balance: String(editingAcc.balance),
              bank_name: editingAcc.bank_name || '',
              card_number: editingAcc.card_number || '',
              parent_account_id: editingAcc.parent_account_id ? String(editingAcc.parent_account_id) : '',
            }}
          />
        )}
      </Modal>

      {/* ── Delete Regular Account Modal ── */}
      <Modal open={!!deleteTarget} title="删除账户" onClose={() => { setDeleteTarget(null); setDeleteError(''); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除账户「{deleteTarget?.name}」吗？此操作不可撤销。</p>
          {deleteError && <div className="form-error">{deleteError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteError(''); }}>取消</Button>
            <Button variant="danger" onClick={handleDelete}>确认删除</Button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Investment Account Modal ── */}
      <Modal open={!!editingInv} title="编辑投资账户" onClose={() => setEditingInv(null)}>
        {editingInv && (
          <EditInvestmentForm
            onSubmit={handleEditInv}
            onCancel={() => setEditingInv(null)}
            bankOptions={getBankOptions()}
            initial={{
              name: editingInv.name,
              broker: editingInv.broker || '',
              currency: editingInv.currency,
              account_number: editingInv.account_number || '',
              funding_account_id: editingInv.funding_account_id != null ? String(editingInv.funding_account_id) : '',
              notes: editingInv.notes || '',
            }}
          />
        )}
      </Modal>

      {/* ── Delete Investment Account Modal ── */}
      <Modal open={!!deleteInvTarget} title="删除投资账户" onClose={() => { setDeleteInvTarget(null); setDeleteInvError(''); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除投资账户「{deleteInvTarget?.name}」吗？</p>
          {deleteInvHoldingCount > 0 && (
            <p style={{ color: 'var(--color-warning)', fontSize: '0.9rem' }}>
              ⚠️ 该账户下有 {deleteInvHoldingCount} 个持仓，删除后持仓的投资账户关联将被清除（持仓本身保留）。
            </p>
          )}
          {deleteInvError && <div className="form-error">{deleteInvError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => { setDeleteInvTarget(null); setDeleteInvError(''); }}>取消</Button>
            <Button variant="danger" onClick={handleDeleteInv}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </div>
  );

  // ── Recursive tree render for regular accounts ──
  function renderTree(list: Account[], depth: number): React.ReactNode {
    return list.map((acc) => (
      <div key={`acct-${acc.id}`} className="account-tree-node">
        <div
          className="account-tree-row"
          style={{ paddingLeft: `${16 + depth * 28}px` }}
          onClick={() => { if (!acc.children || acc.children.length === 0) navigate(`/accounts/${acc.id}`); }}
        >
          <div className="account-tree-row-icon">
            {acc.children && acc.children.length > 0 ? '📁' :
             acc.type === 'bank_card' ? '🏦' :
             acc.type === 'credit_card' ? '💳' :
             acc.type === 'online_pay' ? '📱' : '💵'}
          </div>
          <div className="account-tree-row-info">
            <div className="account-tree-row-name">{acc.name}</div>
            <div className="account-tree-row-meta">
              {ACCOUNT_TYPE_LABELS[acc.type] || acc.type}
              {acc.bank_name && ` · ${acc.bank_name}`}
              {acc.card_number && ` · ${acc.card_number}`}
              {acc.balances && acc.balances.length > 0 && (
                <span className="account-tree-row-currencies">
                  {' · '}
                  {acc.balances.map(b => `${b.currency} ${b.balance.toLocaleString()}`).join(' / ')}
                </span>
              )}
            </div>
          </div>
          <div className="account-tree-row-balance">
            <Amount value={acc.balance} currency={acc.currency} colored />
          </div>
          <div className="account-tree-row-actions" onClick={e => e.stopPropagation()}>
            <Button variant="secondary" size="sm" onClick={() => setEditingAcc(acc)}>✏️ 编辑</Button>
            <Button variant="secondary" size="sm" onClick={() => { setDeleteTarget(acc); setDeleteError(''); }}>
              🗑 删除
            </Button>
          </div>
        </div>
        {acc.children && acc.children.length > 0 && renderTree(acc.children, depth + 1)}
        {/* Linked investment accounts */}
        {investments.filter(inv => inv.funding_account_id === acc.id).map(inv => (
          <div key={`inv-${inv.id}`} className="account-tree-node">
            <div
              className="account-tree-row"
              style={{ paddingLeft: `${16 + (depth + 1) * 28}px` }}
              onClick={() => navigate(`/investments/${inv.id}`)}
            >
              <div className="account-tree-row-icon">📈</div>
              <div className="account-tree-row-info">
                <div className="account-tree-row-name">{inv.name}</div>
                <div className="account-tree-row-meta">
                  投资账户{inv.broker && ` · ${inv.broker}`} · {inv.assetCount || 0} 个持仓
                </div>
              </div>
              <div className="account-tree-row-balance">
                <Amount value={inv.totalMarketValue || 0} currency={inv.currency} colored={false} />
                {inv.totalProfitLoss !== undefined && (
                  <span style={{
                    fontSize: 'var(--font-size-xs)',
                    color: (inv.totalProfitLoss || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                    marginLeft: '8px',
                  }}>
                    {(inv.totalProfitLoss || 0) >= 0 ? '+' : ''}{(inv.totalProfitLoss || 0).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    ));
  }

  // ── Investment accounts group in tree (unlinked only) ──
  function renderInvestmentGroup(): React.ReactNode {
    const unlinked = investments.filter(inv => !inv.funding_account_id);
    if (unlinked.length === 0) return null;
    const unlinkedTotal = unlinked.reduce((s, inv) => s + (inv.totalMarketValue || 0), 0);
    return (
      <div className="account-tree-node">
        <div className="account-tree-row" style={{ paddingLeft: '16px', cursor: 'default', background: 'var(--color-surface-hover)' }}>
          <div className="account-tree-row-icon">📈</div>
          <div className="account-tree-row-info">
            <div className="account-tree-row-name">投资账户</div>
            <div className="account-tree-row-meta">共 {unlinked.length} 个券商/基金账户（未关联银行）</div>
          </div>
          <div className="account-tree-row-balance">
            <Amount value={unlinkedTotal} currency="CNY" colored />
          </div>
          <div className="account-tree-row-actions" />
        </div>
        {unlinked.map(inv => (
          <div key={`inv-${inv.id}`} className="account-tree-node">
            <div
              className="account-tree-row"
              style={{ paddingLeft: `${16 + 1 * 28}px` }}
              onClick={() => navigate(`/investments/${inv.id}`)}
            >
              <div className="account-tree-row-icon">📈</div>
              <div className="account-tree-row-info">
                <div className="account-tree-row-name">{inv.name}</div>
                <div className="account-tree-row-meta">
                  投资账户
                  {inv.broker && ` · ${inv.broker}`}
                  {inv.assetCount !== undefined && ` · ${inv.assetCount} 个持仓`}
                  {inv.totalProfitLoss !== undefined && (
                    <span style={{ color: inv.totalProfitLoss >= 0 ? 'var(--color-success)' : 'var(--color-danger)', marginLeft: 4 }}>
                      {inv.totalProfitLoss >= 0 ? '+' : ''}{inv.totalProfitLoss.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="account-tree-row-balance">
                <Amount value={inv.totalMarketValue || 0} currency={inv.currency} colored />
              </div>
              <div className="account-tree-row-actions" onClick={e => e.stopPropagation()}>
                <Button variant="secondary" size="sm" onClick={() => setEditingInv(inv)}>✏️ 编辑</Button>
                <Button variant="secondary" size="sm" onClick={() => openDeleteInv(inv)}>🗑 删除</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
}

// ════════════════════════════════════════════════════════════════
// Step 2: Dynamic add form by asset type
// ════════════════════════════════════════════════════════════════

function AddFormByType({ assetType, subAccounts, onAddSubAccount, onRemoveSubAccount, onUpdateSubAccount, onSubmit, onBack, onCancel }: {
  assetType: string;
  subAccounts: SubAccount[];
  onAddSubAccount: () => void;
  onRemoveSubAccount: (key: number) => void;
  onUpdateSubAccount: (key: number, field: string, value: string | number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  switch (assetType) {
    case 'bank':
      return <BankForm subAccounts={subAccounts} onAdd={onAddSubAccount} onRemove={onRemoveSubAccount} onUpdate={onUpdateSubAccount} onSubmit={onSubmit} onBack={onBack} onCancel={onCancel} />;
    case 'cash':
      return <SimpleForm assetType={assetType} label="现金资产" onSubmit={onSubmit} onBack={onBack} onCancel={onCancel} />;
    case 'insurance':
      return <InsuranceForm onSubmit={onSubmit} onBack={onBack} onCancel={onCancel} />;
    case 'investment':
      return <InvestmentAddForm onSubmit={onSubmit} onBack={onBack} onCancel={onCancel} bankOptions={getBankOptions()} />;
    case 'custom':
      return <SimpleForm assetType={assetType} label="自定义资产" onSubmit={onSubmit} onBack={onBack} onCancel={onCancel} />;
    default:
      return null;
  }
}

/** Bank: name + bank_name + sub-account rows */
function BankForm({ subAccounts, onAdd, onRemove, onUpdate, onSubmit, onBack, onCancel }: {
  subAccounts: SubAccount[];
  onAdd: () => void;
  onRemove: (key: number) => void;
  onUpdate: (key: number, field: string, value: string | number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">银行名称 *</label>
        <input className="form-input" name="name" required placeholder="如：招商银行" />
      </div>
      <div className="form-group">
        <label className="form-label">银行名称（备用）</label>
        <input className="form-input" name="bank_name" placeholder="同账户名称可不填" />
      </div>

      <div className="form-section-label">
        <span>子账户列表</span>
        <Button variant="secondary" size="sm" type="button" onClick={onAdd}>+ 添加子账户</Button>
      </div>

      {subAccounts.map((sa) => (
        <div key={sa.key} className="sub-account-row">
          <div className="sub-account-fields">
            <input
              className="form-input"
              placeholder="账户名（如：储蓄卡尾号1234）"
              value={sa.name}
              onChange={e => onUpdate(sa.key, 'name', e.target.value)}
              required
            />
            <input
              className="form-input"
              placeholder="卡号（选填）"
              value={sa.card_number}
              onChange={e => onUpdate(sa.key, 'card_number', e.target.value)}
            />
            <select
              className="form-select"
              value={sa.currency}
              onChange={e => onUpdate(sa.key, 'currency', e.target.value)}
            >
              <option value="CNY">¥ 人民币</option>
              <option value="HKD">HK$ 港币</option>
              <option value="USD">$ 美元</option>
            </select>
            <input
              className="form-input"
              type="number" step="0.01" placeholder="余额"
              value={sa.balance || ''}
              onChange={e => onUpdate(sa.key, 'balance', parseFloat(e.target.value) || 0)}
            />
          </div>
          <Button variant="secondary" size="sm" type="button" onClick={() => onRemove(sa.key)} disabled={subAccounts.length <= 1}>
            ✕
          </Button>
        </div>
      ))}

      <div className="form-group" style={{ marginTop: 'var(--spacing-sm)' }}>
        <label className="form-label">默认卡类型</label>
        <select className="form-select" name="type" defaultValue="bank_card">
          <option value="bank_card">🏦 银行卡（储蓄卡）</option>
          <option value="credit_card">💳 信用卡</option>
        </select>
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={onBack} type="button">← 返回</Button>
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">创建</Button>
      </div>
    </form>
  );
}

/** Simple form for cash / custom: name + balance + currency */
function SimpleForm({ assetType, label, onSubmit, onBack, onCancel }: {
  assetType: string; label: string; onSubmit: (e: React.FormEvent) => void; onBack: () => void; onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">{label}名称 *</label>
        <input className="form-input" name="name" required placeholder={assetType === 'cash' ? '如：钱包现金' : '如：我的资产'} />
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
          <label className="form-label">初始余额</label>
          <input className="form-input" name="balance" type="number" step="0.01" defaultValue="0" />
        </div>
      </div>
      {assetType === 'custom' && (
        <div className="form-group">
          <label className="form-label">类型标签</label>
          <select className="form-select" name="type" defaultValue="online_pay">
            <option value="cash">💵 现金</option>
            <option value="online_pay">📱 在线支付</option>
            <option value="bank_card">🏦 银行卡</option>
          </select>
        </div>
      )}
      <input type="hidden" name="type" value={assetType === 'cash' ? 'cash' : 'online_pay'} />
      <div className="form-actions">
        <Button variant="secondary" onClick={onBack} type="button">← 返回</Button>
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">创建</Button>
      </div>
    </form>
  );
}

/** Insurance: name + company + balance */
function InsuranceForm({ onSubmit, onBack, onCancel }: {
  onSubmit: (e: React.FormEvent) => void; onBack: () => void; onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">保单名称 *</label>
        <input className="form-input" name="name" required placeholder="如：平安人寿保险" />
      </div>
      <div className="form-group">
        <label className="form-label">保险公司</label>
        <input className="form-input" name="bank_name" placeholder="如：中国平安" />
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
          <label className="form-label">保单价值</label>
          <input className="form-input" name="balance" type="number" step="0.01" defaultValue="0" />
        </div>
      </div>
      <input type="hidden" name="type" value="cash" />
      <div className="form-actions">
        <Button variant="secondary" onClick={onBack} type="button">← 返回</Button>
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">创建</Button>
      </div>
    </form>
  );
}

/** Investment add form (creates investment_accounts record) */
function InvestmentAddForm({ onSubmit, onBack, onCancel, bankOptions }: {
  onSubmit: (e: React.FormEvent) => void; onBack: () => void; onCancel: () => void;
  bankOptions: { id: number; name: string; currency: string }[];
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">账户名称 *</label>
        <input className="form-input" name="name" required placeholder="如：五矿基金" />
      </div>
      <div className="form-group">
        <label className="form-label">券商/机构</label>
        <input className="form-input" name="broker" placeholder="如：耀才证券" />
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
          <label className="form-label">账号（选填）</label>
          <input className="form-input" name="account_number" placeholder="选填" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">资金来源账户</label>
        <select className="form-select" name="funding_account_id" defaultValue="">
          <option value="">无关联</option>
          {bankOptions.map((b) => (
            <option key={b.id} value={b.id}>🏦 {b.name} ({b.currency})</option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onBack} type="button">← 返回</Button>
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">创建</Button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════════
// Edit regular account form
// ════════════════════════════════════════════════════════════════

function EditAccountForm({ onSubmit, onCancel, parentOptions, initial }: {
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  parentOptions: { id: number; name: string }[];
  initial?: Record<string, string>;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">账户名称 *</label>
        <input className="form-input" name="name" required defaultValue={initial?.name} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">类型</label>
          <select className="form-select" name="type" defaultValue={initial?.type || 'bank_card'}>
            <option value="bank_card">🏦 银行卡</option>
            <option value="cash">💵 现金</option>
            <option value="credit_card">💳 信用卡</option>
            <option value="online_pay">📱 在线支付</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">资产分类</label>
          <select className="form-select" name="asset_type" defaultValue={initial?.asset_type || 'bank'}>
            {ASSET_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">币种</label>
          <select className="form-select" name="currency" defaultValue={initial?.currency || 'CNY'}>
            <option value="CNY">¥ 人民币</option>
            <option value="HKD">HK$ 港币</option>
            <option value="USD">$ 美元</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">当前余额</label>
          <input className="form-input" name="balance" type="number" step="0.01" defaultValue={initial?.balance || '0'} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">银行名称</label>
          <input className="form-input" name="bank_name" defaultValue={initial?.bank_name} />
        </div>
        <div className="form-group">
          <label className="form-label">卡号</label>
          <input className="form-input" name="card_number" defaultValue={initial?.card_number} />
        </div>
      </div>
      {parentOptions.length > 0 && (
        <div className="form-group">
          <label className="form-label">所属父账户</label>
          <select className="form-select" name="parent_account_id" defaultValue={initial?.parent_account_id || ''}>
            <option value="">无（顶级账户）</option>
            {parentOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">保存</Button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════════
// Edit investment account form
// ════════════════════════════════════════════════════════════════

function EditInvestmentForm({ onSubmit, onCancel, initial, bankOptions }: {
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  initial: Record<string, string>;
  bankOptions: { id: number; name: string; currency: string }[];
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="form-group">
        <label className="form-label">账户名称 *</label>
        <input className="form-input" name="name" required defaultValue={initial.name} />
      </div>
      <div className="form-group">
        <label className="form-label">券商/机构</label>
        <input className="form-input" name="broker" defaultValue={initial.broker} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">币种</label>
          <select className="form-select" name="currency" defaultValue={initial.currency}>
            <option value="CNY">¥ 人民币</option>
            <option value="HKD">HK$ 港币</option>
            <option value="USD">$ 美元</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">账号</label>
          <input className="form-input" name="account_number" defaultValue={initial.account_number} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">资金来源账户</label>
        <select className="form-select" name="funding_account_id" defaultValue={initial.funding_account_id || ''}>
          <option value="">无关联</option>
          {bankOptions.map((b) => (
            <option key={b.id} value={b.id}>🏦 {b.name} ({b.currency})</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">备注</label>
        <input className="form-input" name="notes" defaultValue={initial.notes} />
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel} type="button">取消</Button>
        <Button variant="primary" type="submit">保存</Button>
      </div>
    </form>
  );
}
