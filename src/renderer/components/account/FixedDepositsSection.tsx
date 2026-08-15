/**
 * FixedDepositsSection — 定期存款区块（v1.6.0：资金交互询问式——扣款/单纯记录）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { invoke } from '../../hooks/useIpc';

export interface FixedDeposit {
  id: number; account_id: number; amount: number; currency: string;
  interest_rate: number; start_date: string; maturity_date: string;
  notes: string | null; deduct_mode: string; deduct_account_id: number | null;
  created_at: string; updated_at: string;
}

interface BankAccount { id: number; name: string; bank_name: string | null; card_number: string | null; display_alias: string | null; currency: string; }

interface Props {
  accountId: number;
  accountCurrency: string;
  onChanged: () => void;
}

export function FixedDepositsSection({ accountId, accountCurrency, onChanged }: Props) {
  const [fixedDeposits, setFixedDeposits] = useState<FixedDeposit[]>([]);
  const [showFdForm, setShowFdForm] = useState(false);
  const [editingFd, setEditingFd] = useState<FixedDeposit | null>(null);
  const [deletingFd, setDeletingFd] = useState<FixedDeposit | null>(null);
  const [fdSaving, setFdSaving] = useState(false);
  const [fdError, setFdError] = useState('');

  // ── 资金处理方式（v1.6.0 询问式） ──
  const [pendingCreate, setPendingCreate] = useState<Record<string, unknown> | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [deductMode, setDeductMode] = useState<'deduct' | 'record_only'>('deduct');
  const [deductAccountId, setDeductAccountId] = useState<string>('');

  const loadFds = useCallback(() => {
    invoke<FixedDeposit[]>('fixedDeposit:listByAccount', accountId)
      .then((fds) => setFixedDeposits(fds || []))
      .catch(() => setFixedDeposits([]));
  }, [accountId]);

  useEffect(() => { loadFds(); }, [loadFds]);

  // 打开资金处理方式弹窗时加载银行账户列表
  useEffect(() => {
    if (pendingCreate) {
      invoke<BankAccount[]>('account:listBankAccounts')
        .then((list) => {
          setBankAccounts(list || []);
          setDeductMode('deduct');
          setDeductAccountId(String(accountId));
        })
        .catch(() => {});
    }
  }, [pendingCreate, accountId]);

  const handleFdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFdSaving(true);
    setFdError('');
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = { account_id: accountId };
    new FormData(form).forEach((v, k) => { data[k] = v; });
    const amount = parseFloat(data.amount as string) || 0;
    if (amount <= 0) { setFdError('金额必须大于 0'); setFdSaving(false); return; }
    try {
      if (editingFd) {
        await invoke('fixedDeposit:update', editingFd.id, data);
        setEditingFd(null);
        setShowFdForm(false);
        loadFds();
        onChanged();
      } else {
        // 新建：先询问资金处理方式
        setShowFdForm(false);
        setPendingCreate(data);
      }
    } catch (err: any) { setFdError(err.message || '操作失败'); }
    setFdSaving(false);
  };

  const handleModeConfirm = async () => {
    if (!pendingCreate) return;
    setFdSaving(true);
    try {
      await invoke('fixedDeposit:create', {
        ...pendingCreate,
        deductMode: deductMode,
        deductAccountId: deductMode === 'deduct' ? (parseInt(deductAccountId) || accountId) : null,
      });
      setPendingCreate(null);
      loadFds();
      onChanged();
    } catch (err: any) { setFdError(err.message || '创建失败'); }
    setFdSaving(false);
  };

  const handleDeleteFd = async () => {
    if (!deletingFd) return;
    try {
      await invoke('fixedDeposit:delete', deletingFd.id);
      setDeletingFd(null);
      loadFds();
      onChanged();
    } catch (err: any) { console.error(err); }
  };

  return (
    <>
      <Card title="🏦 定期存款">
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <Button variant="primary" size="sm" onClick={() => { setEditingFd(null); setFdError(''); setShowFdForm(true); }}>
            + 添加定期存款
          </Button>
        </div>
        {fixedDeposits.length === 0 ? (
          <div className="card-placeholder">暂无定期存款</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            {fixedDeposits.map(fd => (
              <div key={fd.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                    {fd.currency === 'CNY' ? '¥' : fd.currency === 'HKD' ? 'HK$' : '$'}
                    {fd.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' '}
                    {fd.deduct_mode === 'record_only' ? (
                      <Badge label="📝 纯记录" color="default" />
                    ) : (
                      <Badge label="💳 已扣款" color="info" />
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    年利率 {fd.interest_rate}% · {fd.start_date} ~ {fd.maturity_date}
                    {fd.notes && ' · ' + fd.notes}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <Button variant="secondary" size="sm" onClick={() => { setEditingFd(fd); setFdError(''); setShowFdForm(true); }}>✏️</Button>
                  <Button variant="secondary" size="sm" onClick={() => setDeletingFd(fd)}>🗑</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── 定存表单弹窗 ── */}
      <Modal
        open={showFdForm}
        title={editingFd ? '✏️ 编辑定期存款' : '🏦 添加定期存款'}
        onClose={() => { setShowFdForm(false); setEditingFd(null); }}
      >
        <form onSubmit={handleFdSubmit}>
          <div className="form-group">
            <label className="form-label">存款金额 *</label>
            <input
              className="form-input" name="amount" type="number" step="0.01"
              required placeholder="0.00" autoFocus
              defaultValue={editingFd?.amount || ''}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">币种</label>
              <select className="form-select" name="currency" defaultValue={editingFd?.currency || accountCurrency}>
                <option value="CNY">¥ 人民币</option>
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">年利率（%）</label>
              <input
                className="form-input" name="interest_rate" type="number" step="0.01"
                placeholder="如：2.5" defaultValue={editingFd?.interest_rate || ''}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">起始日期 *</label>
              <input className="form-input" name="start_date" type="date" required
                defaultValue={editingFd?.start_date || new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="form-group">
              <label className="form-label">到期日期 *</label>
              <input className="form-input" name="maturity_date" type="date" required
                defaultValue={editingFd?.maturity_date || ''} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">备注</label>
            <input className="form-input" name="notes" placeholder="可选备注"
              defaultValue={editingFd?.notes || ''} />
          </div>
          {fdError && (
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: '#FFF2F0', borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-md)',
            }}>
              {fdError}
            </div>
          )}
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
            {editingFd
              ? (editingFd.deduct_mode === 'record_only'
                ? '📝 纯记录型：修改不影响任何账户余额。'
                : '💳 已扣款型：修改金额会按差额调整扣款账户余额。')
              : '提交后将询问资金处理方式：从账户扣款，或单纯记录（不动余额）。'}
          </p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => { setShowFdForm(false); setEditingFd(null); }} type="button">取消</Button>
            <Button variant="primary" type="submit" disabled={fdSaving}>
              {fdSaving ? '保存中...' : editingFd ? '保存修改' : '下一步'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── 资金处理方式弹窗（v1.6.0） ── */}
      <Modal open={pendingCreate !== null} title="💰 资金处理方式" onClose={() => setPendingCreate(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 380 }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            这笔定期存款的资金如何处理？
          </p>
          <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={deductMode === 'deduct'} onChange={() => setDeductMode('deduct')} />
            💳 从账户扣款（余额减少，删除时恢复）
          </label>
          <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={deductMode === 'record_only'} onChange={() => setDeductMode('record_only')} />
            📝 单纯记录（不影响任何账户余额）
          </label>
          {deductMode === 'deduct' && (
            <div className="form-group">
              <label className="form-label">从哪个账户扣款</label>
              <select className="form-select" value={deductAccountId} onChange={(e) => setDeductAccountId(e.target.value)}>
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={ba.id}>
                    🏦 {ba.bank_name || ba.name} · {ba.display_alias || ba.name}{ba.card_number ? ' · 尾号' + ba.card_number.slice(-4) : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {fdError && (
            <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {fdError}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setPendingCreate(null)}>取消</Button>
            <Button variant="primary" onClick={handleModeConfirm} disabled={fdSaving}>
              {fdSaving ? '创建中...' : '确认创建'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── 删除确认弹窗 ── */}
      <Modal open={!!deletingFd} title="🗑 删除定期存款" onClose={() => setDeletingFd(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除此定期存款吗？</p>
          {deletingFd && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {deletingFd.currency} {deletingFd.amount.toLocaleString()} · 年利率 {deletingFd.interest_rate}% · {deletingFd.start_date} ~ {deletingFd.maturity_date}
            </div>
          )}
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
            {deletingFd?.deduct_mode === 'record_only'
              ? '📝 纯记录型：仅删除记录，不影响任何账户余额。'
              : '💳 已扣款型：删除后金额将恢复到扣款账户余额。'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setDeletingFd(null)}>取消</Button>
            <Button variant="danger" onClick={handleDeleteFd}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
