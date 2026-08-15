/**
 * FixedDepositsSection — 定期存款区块（列表 + 添加/编辑/删除弹窗，自 AccountDetail 拆分）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

export interface FixedDeposit {
  id: number; account_id: number; amount: number; currency: string;
  interest_rate: number; start_date: string; maturity_date: string;
  notes: string | null; created_at: string; updated_at: string;
}

interface Props {
  accountId: number;
  accountCurrency: string;
  /** 余额发生变化后刷新账户数据 */
  onChanged: () => void;
}

export function FixedDepositsSection({ accountId, accountCurrency, onChanged }: Props) {
  const [fixedDeposits, setFixedDeposits] = useState<FixedDeposit[]>([]);
  const [showFdForm, setShowFdForm] = useState(false);
  const [editingFd, setEditingFd] = useState<FixedDeposit | null>(null);
  const [deletingFd, setDeletingFd] = useState<FixedDeposit | null>(null);
  const [fdSaving, setFdSaving] = useState(false);
  const [fdError, setFdError] = useState('');

  const loadFds = useCallback(() => {
    invoke<FixedDeposit[]>('fixedDeposit:listByAccount', accountId)
      .then((fds) => setFixedDeposits(fds || []))
      .catch(() => setFixedDeposits([]));
  }, [accountId]);

  useEffect(() => { loadFds(); }, [loadFds]);

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
      } else {
        await invoke('fixedDeposit:create', data);
        setShowFdForm(false);
      }
      loadFds();
      onChanged();
    } catch (err: any) { setFdError(err.message || '操作失败'); }
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

      {/* ── Fixed Deposit Form Modal ── */}
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
            ⚠️ 创建定期存款将从本账户余额中扣减对应金额。
          </p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => { setShowFdForm(false); setEditingFd(null); }} type="button">取消</Button>
            <Button variant="primary" type="submit" disabled={fdSaving}>
              {fdSaving ? '保存中...' : editingFd ? '保存修改' : '添加'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Fixed Deposit Modal ── */}
      <Modal open={!!deletingFd} title="🗑 删除定期存款" onClose={() => setDeletingFd(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除此定期存款吗？金额将恢复到账户余额。</p>
          {deletingFd && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {deletingFd.currency} {deletingFd.amount.toLocaleString()} · 年利率 {deletingFd.interest_rate}% · {deletingFd.start_date} ~ {deletingFd.maturity_date}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setDeletingFd(null)}>取消</Button>
            <Button variant="danger" onClick={handleDeleteFd}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
