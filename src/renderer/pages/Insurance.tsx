import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';

interface Policy {
  id: number; name: string; company: string | null; policy_number: string | null;
  type: string; annual_premium: number; premium_currency: string;
  cash_value: number; cash_value_currency: string;
  insured_person: string | null; start_date: string | null;
  premium_due_month: number | null; premium_due_day: number | null;
  account_id: number | null; notes: string | null; is_active: number;
}

interface PremiumPayment {
  id: number; policy_id: number; amount: number; currency: string;
  paid_date: string; account_id: number | null; notes: string | null;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  life: '人寿', health: '医疗险', annuity: '年金险',
  critical: '重疾险', accident: '意外险', other: '其他',
};

const ACCOUNTS_CACHE: Array<{ id: number; name: string; bank_name: string | null }> = [];

export function Insurance() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);

  // Premium payment
  const [showPremium, setShowPremium] = useState(false);
  const [payingPolicy, setPayingPolicy] = useState<Policy | null>(null);
  const [paySaving, setPaySaving] = useState(false);

  // Bank accounts for funding
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: number; name: string; bank_name: string | null }>>([]);

  const load = useCallback(async () => {
    try {
      const list = await invoke<Policy[]>('insurance:listPolicies');
      setPolicies(list || []);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showPremium || showForm) {
      invoke<Array<{ id: number; name: string; bank_name: string | null }>>('account:listBankAccounts')
        .then(list => setBankAccounts(list || []));
    }
  }, [showPremium, showForm]);

  // ── Policy CRUD ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = {};
    fd.forEach((v, k) => { data[k] = v; });
    data.annual_premium = parseFloat(data.annual_premium as string) || 0;
    data.cash_value = parseFloat(data.cash_value as string) || 0;
    data.premium_due_month = data.premium_due_month ? parseInt(data.premium_due_month as string) : null;
    data.premium_due_day = data.premium_due_day ? parseInt(data.premium_due_day as string) : null;
    data.account_id = data.account_id ? parseInt(data.account_id as string) : null;
    try {
      if (editing) {
        await invoke('insurance:updatePolicy', editing.id, data);
        setEditing(null);
      } else {
        await invoke('insurance:createPolicy', data);
      }
      setShowForm(false);
      load();
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await invoke('insurance:deletePolicy', deleting.id);
      setDeleting(null);
      load();
    } catch (err) { console.error(err); }
  };

  // ── Premium Payment ──
  const handlePayPremium = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingPolicy) return;
    setPaySaving(true);
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = { policy_id: payingPolicy.id };
    fd.forEach((v, k) => { data[k] = v; });
    data.amount = parseFloat(data.amount as string) || 0;
    data.account_id = data.account_id ? parseInt(data.account_id as string) : null;
    try {
      await invoke('insurance:payPremium', data);
      setShowPremium(false);
      setPayingPolicy(null);
      load();
    } catch (err: any) {
      alert(err.message || '保费支付失败');
    }
    setPaySaving(false);
  };

  const activePolicies = policies.filter(p => p.is_active);
  const totalCashValue = activePolicies.reduce((s, p) => s + p.cash_value, 0);
  const totalAnnualPremium = activePolicies.reduce((s, p) => s + p.annual_premium, 0);

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <button onClick={() => navigate('/accounts')} className="page-back-link">← 返回资产管理</button>
        <h2 className="page-title">🛡️ 保险管理</h2>
        <p className="page-subtitle">
          {activePolicies.length} 份有效保单 · 年度保费 ¥{totalAnnualPremium.toLocaleString()} · 现金价值 ¥{totalCashValue.toLocaleString()}
        </p>
        <Button variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ 添加保单</Button>
      </div>

      {/* Summary */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">有效保单</div>
          <div className="stat-card-value number">{activePolicies.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">年度保费</div>
          <div className="stat-card-value number">¥{totalAnnualPremium.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">现金价值</div>
          <div className="stat-card-value number">
            <Amount value={totalCashValue} currency="CNY" colored />
          </div>
        </div>
      </div>

      {/* Policy list */}
      {policies.length === 0 ? (
        <Card><div className="card-placeholder">暂无保单，点击「添加保单」开始</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
          {policies.map(policy => {
            const isActive = !!policy.is_active;
            const dueDate = policy.premium_due_month && policy.premium_due_day
              ? `${policy.premium_due_month}月${policy.premium_due_day}日`
              : '未设置';

            return (
              <Card key={policy.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{policy.name}</span>
                      <Badge label={POLICY_TYPE_LABELS[policy.type] || policy.type} color="primary" />
                      {!isActive && <Badge label="已停效" color="danger" />}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                      {policy.company && <span>🏢 {policy.company} · </span>}
                      {policy.policy_number && <span>📋 {policy.policy_number} · </span>}
                      {policy.insured_person && <span>👤 {policy.insured_person} · </span>}
                      {policy.start_date && <span>📅 生效 {policy.start_date} · </span>}
                      🔔 缴费日 {dueDate}
                      {policy.notes && <span> · 📝 {policy.notes}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 'var(--spacing-md)' }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 2 }}>
                      年保费 ¥{policy.annual_premium.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-500)' }}>
                      现金价值 ¥{policy.cash_value.toLocaleString()}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      {isActive && (
                        <Button variant="primary" size="sm" onClick={() => { setPayingPolicy(policy); setShowPremium(true); }}>
                          💰 缴费
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => { setEditing(policy); setShowForm(true); }}>✏️</Button>
                      <Button variant="secondary" size="sm" onClick={() => setDeleting(policy)}>🗑</Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add/Edit Policy Modal ── */}
      <Modal
        open={showForm}
        title={editing ? '✏️ 编辑保单' : '🛡️ 添加保单'}
        onClose={() => { setShowForm(false); setEditing(null); }}
      >
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">保单名称 *</label>
            <input className="form-input" name="name" required defaultValue={editing?.name || ''} placeholder="如：平安福" autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">保险公司</label>
              <input className="form-input" name="company" defaultValue={editing?.company || ''} placeholder="如：中国平安" />
            </div>
            <div className="form-group">
              <label className="form-label">保单号码</label>
              <input className="form-input" name="policy_number" defaultValue={editing?.policy_number || ''} placeholder="选填" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">险种</label>
              <select className="form-select" name="type" defaultValue={editing?.type || 'life'}>
                {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">被保险人</label>
              <input className="form-input" name="insured_person" defaultValue={editing?.insured_person || ''} placeholder="选填" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">年保费</label>
              <input className="form-input" name="annual_premium" type="number" step="0.01" defaultValue={editing?.annual_premium || 0} />
            </div>
            <div className="form-group">
              <label className="form-label">币种</label>
              <select className="form-select" name="premium_currency" defaultValue={editing?.premium_currency || 'CNY'}>
                <option value="CNY">¥ 人民币</option>
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">现金价值</label>
              <input className="form-input" name="cash_value" type="number" step="0.01" defaultValue={editing?.cash_value || 0} />
            </div>
            <div className="form-group">
              <label className="form-label">生效日期</label>
              <input className="form-input" name="start_date" type="date" defaultValue={editing?.start_date || ''} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">缴费月</label>
              <select className="form-select" name="premium_due_month" defaultValue={editing?.premium_due_month || ''}>
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}月</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">缴费日</label>
              <select className="form-select" name="premium_due_day" defaultValue={editing?.premium_due_day || ''}>
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}日</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">关联银行账户</label>
            <select className="form-select" name="account_id" defaultValue={editing?.account_id || ''}>
              <option value="">不关联</option>
              {bankAccounts.map(ba => (
                <option key={ba.id} value={ba.id}>🏦 {ba.bank_name || ba.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">备注</label>
            <input className="form-input" name="notes" defaultValue={editing?.notes || ''} placeholder="选填" />
          </div>
          {editing && (
            <div className="form-group">
              <label className="form-label">状态</label>
              <select className="form-select" name="is_active" defaultValue={editing.is_active}>
                <option value="1">✅ 有效</option>
                <option value="0">❌ 停效</option>
              </select>
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => { setShowForm(false); setEditing(null); }} type="button">取消</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? '保存中...' : editing ? '保存修改' : '创建'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Modal ── */}
      <Modal open={!!deleting} title="🗑 删除保单" onClose={() => setDeleting(null)}>
        <p>确认删除此保单吗？已缴保费记录将保留。</p>
        {deleting && (
          <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', margin: 'var(--spacing-md) 0', fontSize: 'var(--font-size-sm)' }}>
            🛡️ {deleting.name} · {deleting.company || '未知公司'} · 年保费 ¥{deleting.annual_premium.toLocaleString()}
          </div>
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setDeleting(null)}>取消</Button>
          <Button variant="danger" onClick={handleDelete}>确认删除</Button>
        </div>
      </Modal>

      {/* ── Premium Payment Modal ── */}
      <Modal
        open={showPremium}
        title="💰 缴纳保费"
        onClose={() => { setShowPremium(false); setPayingPolicy(null); }}
      >
        {payingPolicy && (
          <form onSubmit={handlePayPremium}>
            <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--spacing-md)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--spacing-md)' }}>
              <div style={{ fontWeight: 600 }}>{payingPolicy.name}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                年保费 ¥{payingPolicy.annual_premium.toLocaleString()} · {payingPolicy.company}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">缴费金额 *</label>
              <input className="form-input" name="amount" type="number" step="0.01" required defaultValue={payingPolicy.annual_premium || 0} autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-select" name="currency" defaultValue={payingPolicy.premium_currency || 'CNY'}>
                  <option value="CNY">¥ 人民币</option>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">缴费日期</label>
                <input className="form-input" name="paid_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">付款账户</label>
              <select className="form-select" name="account_id" defaultValue={payingPolicy.account_id || ''}>
                <option value="">不指定</option>
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>🏦 {ba.bank_name || ba.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={`${payingPolicy.name} 保费`} />
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
              ⚠️ 缴费将自动从指定银行账户扣款，并计入流水账。
            </p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setShowPremium(false); setPayingPolicy(null); }} type="button">取消</Button>
              <Button variant="primary" type="submit" disabled={paySaving}>
                {paySaving ? '处理中...' : '确认缴费'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
