/**
 * FixedDepositsSection — 定期存款区块（v1.6.0：资金交互询问式——扣款/单纯记录）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { invoke } from '../../hooks/useIpc';
import { useToast } from '../ui/Toast';

export interface FixedDeposit {
  id: number; account_id: number; amount: number; currency: string;
  interest_rate: number; start_date: string; maturity_date: string;
  notes: string | null; deduct_mode: string; deduct_account_id: number | null;
  status: string; created_at: string; updated_at: string;
}

interface BankAccount { id: number; name: string; bank_name: string | null; card_number: string | null; display_alias: string | null; currency: string; }

function fdCurrencySymbol(c: string): string {
  return c === 'CNY' ? '¥' : c === 'HKD' ? 'HK$' : '$';
}

interface Props {
  accountId: number;
  accountCurrency: string;
  onChanged: () => void;
}

export function FixedDepositsSection({ accountId, accountCurrency, onChanged }: Props) {
  const { showToast } = useToast();
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

  // ── 编辑差额询问（v1.6.1：联动须经用户确认） ──
  const [pendingEdit, setPendingEdit] = useState<{ data: Record<string, unknown>; desc: string } | null>(null);

  // ── 到期处理（v1.6.1：询问式回款） ──
  const [settlingFd, setSettlingFd] = useState<FixedDeposit | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleAccountId, setSettleAccountId] = useState('');

  const loadFds = useCallback(() => {
    invoke<FixedDeposit[]>('fixedDeposit:listByAccount', accountId)
      .then((fds) => setFixedDeposits(fds || []))
      .catch(() => setFixedDeposits([]));
  }, [accountId]);

  useEffect(() => { loadFds(); }, [loadFds]);

  // 打开资金处理方式弹窗时加载银行账户列表
  useEffect(() => {
    if (pendingCreate || settlingFd) {
      invoke<BankAccount[]>('account:listBankAccounts')
        .then((list) => {
          setBankAccounts(list || []);
          if (pendingCreate) {
            setDeductMode('deduct');
            setDeductAccountId(String(accountId));
          }
          if (settlingFd) {
            setSettleAccountId(String(settlingFd.deduct_account_id ?? settlingFd.account_id));
          }
        })
        .catch(() => {});
    }
  }, [pendingCreate, settlingFd, accountId]);

  // 到期处理：预填建议回款金额（本金 + 年化利息按天折算）
  useEffect(() => {
    if (!settlingFd) return;
    const days = Math.max(0, (new Date(settlingFd.maturity_date).getTime() - new Date(settlingFd.start_date).getTime()) / 86400000);
    const interest = settlingFd.amount * (settlingFd.interest_rate / 100) * (days / 365.25);
    setSettleAmount((settlingFd.amount + interest).toFixed(2));
  }, [settlingFd]);

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
        // v1.6.1：扣款型且金额/币种变化 → 询问是否同步调整余额
        const currencyChanged = (data.currency as string) !== editingFd.currency;
        const amountDelta = editingFd.amount - amount;
        if (editingFd.deduct_mode === 'deduct' && (currencyChanged || amountDelta !== 0)) {
          const parts: string[] = [];
          if (currencyChanged) {
            parts.push(`币种由 ${editingFd.currency} 改为 ${data.currency}（退回 ${fdCurrencySymbol(editingFd.currency)}${editingFd.amount.toLocaleString()}，扣减 ${fdCurrencySymbol(data.currency as string)}${amount.toLocaleString()}）`);
          } else if (amountDelta !== 0) {
            parts.push(`金额由 ${editingFd.amount.toLocaleString()} 改为 ${amount.toLocaleString()}（${amountDelta > 0 ? '退回 ' + amountDelta.toLocaleString() : '扣减 ' + Math.abs(amountDelta).toLocaleString()}）`);
          }
          setShowFdForm(false);
          setPendingEdit({ data, desc: parts.join('；') });
        } else {
          await invoke('fixedDeposit:update', editingFd.id, data, 'sync');
          setEditingFd(null);
          setShowFdForm(false);
          loadFds();
          onChanged();
        }
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
      const row = await invoke<FixedDeposit>('fixedDeposit:create', {
        ...pendingCreate,
        deductMode: deductMode,
        deductAccountId: deductMode === 'deduct' ? (parseInt(deductAccountId) || accountId) : null,
      });
      setPendingCreate(null);
      loadFds();
      onChanged();
      // v1.8.0：操作后撤销——扣款型可一键撤销（删除定存并退回金额）
      if (row && deductMode === 'deduct') {
        showToast('已创建定期存款并写扣款记录', '撤销', async () => {
          await invoke('fixedDeposit:delete', row.id, true).catch(() => {});
          loadFds();
          onChanged();
        });
      }
    } catch (err: any) { setFdError(err.message || '创建失败'); }
    setFdSaving(false);
  };

  const handleEditConfirm = async (balanceMode: 'sync' | 'record_only') => {
    if (!pendingEdit || !editingFd) return;
    setFdSaving(true);
    try {
      await invoke('fixedDeposit:update', editingFd.id, pendingEdit.data, balanceMode);
      setPendingEdit(null);
      setEditingFd(null);
      loadFds();
      onChanged();
    } catch (err: any) { setFdError(err.message || '修改失败'); }
    setFdSaving(false);
  };

  const handleDeleteFd = async (restoreBalance: boolean) => {
    if (!deletingFd) return;
    try {
      await invoke('fixedDeposit:delete', deletingFd.id, restoreBalance);
      setDeletingFd(null);
      loadFds();
      onChanged();
    } catch (err: any) { console.error(err); }
  };

  const handleSettle = async () => {
    if (!settlingFd) return;
    const amount = parseFloat(settleAmount) || 0;
    if (amount <= 0) { setFdError('回款金额必须大于 0'); return; }
    setFdSaving(true);
    try {
      await invoke('fixedDeposit:settle', settlingFd.id, {
        amount,
        toAccountId: parseInt(settleAccountId) || settlingFd.account_id,
        currency: settlingFd.currency,
      });
      setSettlingFd(null);
      loadFds();
      onChanged();
    } catch (err: any) { setFdError(err.message || '结算失败'); }
    setFdSaving(false);
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
                    {fdCurrencySymbol(fd.currency)}
                    {fd.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' '}
                    {fd.status === 'settled' ? (
                      <Badge label="✅ 已结算" color="success" />
                    ) : (() => {
                      const matured = fd.maturity_date <= new Date().toISOString().slice(0, 10);
                      return (
                        <>
                          {matured && <Badge label="🔔 已到期" color="warning" />}
                          {fd.deduct_mode === 'record_only' ? (
                            <Badge label="📝 纯记录" color="default" />
                          ) : (
                            <Badge label="💳 已扣款" color="info" />
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    年利率 {fd.interest_rate}% · {fd.start_date} ~ {fd.maturity_date}
                    {fd.notes && ' · ' + fd.notes}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {fd.status === 'active' && fd.maturity_date <= new Date().toISOString().slice(0, 10) && (
                    <Button variant="primary" size="sm" onClick={() => { setSettlingFd(fd); setFdError(''); }}>💰 到期处理</Button>
                  )}
                  {fd.status === 'active' && (
                    <Button variant="secondary" size="sm" onClick={() => { setEditingFd(fd); setFdError(''); setShowFdForm(true); }}>✏️</Button>
                  )}
                  {fd.status === 'active' && (
                    <Button variant="secondary" size="sm" onClick={() => setDeletingFd(fd)}>🗑</Button>
                  )}
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

      {/* ── 编辑差额询问弹窗（v1.6.1） ── */}
      <Modal open={pendingEdit !== null} title="🔗 是否同步调整账户余额？" onClose={() => setPendingEdit(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 400 }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            检测到以下变化：{pendingEdit?.desc}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            <Button variant="primary" onClick={() => handleEditConfirm('sync')} disabled={fdSaving}>
              ✅ 同步调整账户余额，并写存取记录
            </Button>
            <Button variant="secondary" onClick={() => handleEditConfirm('record_only')} disabled={fdSaving}>
              📝 仅改记录（余额原封不动，此定存转为纯记录型）
            </Button>
          </div>
          {fdError && (
            <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {fdError}
            </div>
          )}
        </div>
      </Modal>

      {/* ── 到期处理弹窗（v1.6.1） ── */}
      <Modal open={!!settlingFd} title="💰 定期存款到期处理" onClose={() => setSettlingFd(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 400 }}>
          {settlingFd && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {settlingFd.currency} {settlingFd.amount.toLocaleString()} · 年利率 {settlingFd.interest_rate}% · {settlingFd.start_date} ~ {settlingFd.maturity_date}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">回款金额（默认本金+利息，可修改）*</label>
            <input className="form-input" type="number" step="0.01" value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">回款存入账户</label>
            <select className="form-select" value={settleAccountId} onChange={(e) => setSettleAccountId(e.target.value)}>
              {bankAccounts.map((ba) => (
                <option key={ba.id} value={ba.id}>
                  🏦 {ba.bank_name || ba.name} · {ba.display_alias || ba.name}{ba.card_number ? ' · 尾号' + ba.card_number.slice(-4) : ''}
                </option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            确认后将把回款金额存入所选账户（自动写一条存款记录），并把定存标记为「已结算」（保留历史，不再参与编辑）。
          </p>
          {fdError && (
            <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {fdError}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setSettlingFd(null)}>取消</Button>
            <Button variant="primary" onClick={handleSettle} disabled={fdSaving}>
              {fdSaving ? '处理中...' : '确认回款'}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            {deletingFd?.deduct_mode === 'deduct' && (
              <Button variant="primary" onClick={() => handleDeleteFd(true)}>
                ✅ 退回 {fdCurrencySymbol(deletingFd.currency)}{deletingFd.amount.toLocaleString()} 到扣款账户，并写存取记录
              </Button>
            )}
            {deletingFd?.deduct_mode === 'deduct' && (
              <Button variant="secondary" onClick={() => handleDeleteFd(false)}>
                📝 仅删除记录（余额原封不动，由你自行调整）
              </Button>
            )}
            {deletingFd?.deduct_mode !== 'deduct' && (
              <Button variant="danger" onClick={() => handleDeleteFd(false)}>确认删除（不影响余额）</Button>
            )}
            <Button variant="secondary" onClick={() => setDeletingFd(null)}>取消</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
