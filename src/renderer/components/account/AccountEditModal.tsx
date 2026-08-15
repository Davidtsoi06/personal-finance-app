/**
 * AccountEditModal — 账户编辑 + 删除（安全删除提示 → 强制删除二级确认，v1.5.6 恢复删除入口）。
 */
import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

export interface EditableAccount {
  id: number;
  name: string;
  display_alias: string | null;
  card_number: string | null;
  currency: string;
  asset_type: string;
}

interface ForceImpact {
  childCount: number; transactionCount: number; ledgerCount: number;
  fixedDepositCount: number; bankAssetCount: number; insuranceCount: number;
  premiumCount: number; linkedBrokerCount: number;
}

interface Props {
  account: EditableAccount | null;
  onClose: () => void;
  onChanged: () => void;
}

export function AccountEditModal({ account, onClose, onChanged }: Props) {
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [card, setCard] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [deleteStep, setDeleteStep] = useState<'none' | 'safe-error' | 'force-confirm'>('none');
  const [safeError, setSafeError] = useState('');
  const [impact, setImpact] = useState<ForceImpact | null>(null);
  const [forceDeleting, setForceDeleting] = useState(false);

  const isBank = account?.asset_type === 'bank';

  useEffect(() => {
    if (account) {
      setName(account.name);
      setAlias(account.display_alias || '');
      setCard(account.card_number || '');
      setCurrency(account.currency || 'CNY');
      setDeleteStep('none');
      setSafeError('');
      setImpact(null);
      setSaveMsg('');
    }
  }, [account]);

  const handleSave = async () => {
    if (!account) return;
    if (!name.trim()) { setSaveMsg('名称不能为空'); return; }
    setSaving(true); setSaveMsg('');
    try {
      await invoke('account:update', account.id, {
        name: name.trim(),
        display_alias: alias.trim() || null,
        ...(isBank ? { card_number: card.trim() || null } : {}),
        currency,
      });
      onChanged();
      onClose();
    } catch (err: any) { setSaveMsg('保存失败：' + err.message); }
    setSaving(false);
  };

  const handleDeleteClick = async () => {
    if (!account) return;
    try {
      const r = await invoke<{ success: boolean; error?: string }>('account:delete', account.id);
      if (r.success) { onChanged(); onClose(); return; }
      setSafeError(r.error || '删除失败');
      setDeleteStep('safe-error');
    } catch (err: any) { setSafeError(err.message); setDeleteStep('safe-error'); }
  };

  const handleForceClick = async () => {
    if (!account) return;
    setImpact(await invoke<ForceImpact>('account:deleteImpact', account.id));
    setDeleteStep('force-confirm');
  };

  const handleForceConfirm = async () => {
    if (!account) return;
    setForceDeleting(true);
    try {
      const r = await invoke<{ success: boolean; error?: string }>('account:forceDelete', account.id);
      if (r.success) { onChanged(); onClose(); return; }
      setSafeError(r.error || '强制删除失败');
      setDeleteStep('safe-error');
    } catch (err: any) { setSafeError(err.message); setDeleteStep('safe-error'); }
    setForceDeleting(false);
  };

  return (
    <Modal open={account !== null} title={'✏️ 编辑账户 · ' + (account?.name || '')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 380 }}>
        <div className="form-group">
          <label className="form-label">账户名称</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：招商银行储蓄卡" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">卡片别名</label>
            <input className="form-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="如：工资卡" />
          </div>
          <div className="form-group">
            <label className="form-label">币种</label>
            <select className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="CNY">¥ 人民币</option>
              <option value="HKD">HK$ 港币</option>
              <option value="USD">$ 美元</option>
            </select>
          </div>
        </div>
        {isBank && (
          <div className="form-group">
            <label className="form-label">卡号（仅保存后 4 位）</label>
            <input className="form-input" value={card} onChange={(e) => setCard(e.target.value)} placeholder="完整卡号或尾号" />
          </div>
        )}
        {saveMsg && (
          <div style={{ fontSize: 'var(--font-size-sm)', color: saveMsg.includes('成功') ? 'var(--color-success)' : 'var(--color-danger)' }}>{saveMsg}</div>
        )}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '💾 保存'}
          </Button>
        </div>

        {/* ── 危险区：删除账户 ── */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
          {deleteStep === 'none' && (
            <Button variant="danger" onClick={handleDeleteClick}>🗑 删除账户</Button>
          )}
          {deleteStep === 'safe-error' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
              <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                ❌ {safeError}
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <Button variant="secondary" size="sm" onClick={() => setDeleteStep('none')}>取消</Button>
                <Button variant="danger" size="sm" onClick={handleForceClick}>⚠️ 强制删除（级联清理）</Button>
              </div>
            </div>
          )}
          {deleteStep === 'force-confirm' && impact && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
              <div style={{ padding: 'var(--spacing-md)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                <strong>强制删除将影响：</strong>
                <div style={{ marginTop: 4, lineHeight: 1.8 }}>
                  子账户 {impact.childCount} 个 · 存取记录 {impact.transactionCount} 条 · 记账 {impact.ledgerCount} 条<br/>
                  定期存款 {impact.fixedDepositCount} 笔（删除） · 银行理财 {impact.bankAssetCount} 笔（解除关联保留）<br/>
                  保单 {impact.insuranceCount} 份、保费 {impact.premiumCount} 笔（解除扣款关联） · 券商 {impact.linkedBrokerCount} 个（解除资金关联）
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" onClick={() => setDeleteStep('none')}>取消</Button>
                <Button variant="danger" size="sm" onClick={handleForceConfirm} disabled={forceDeleting}>
                  {forceDeleting ? '删除中...' : '确认强制删除'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
