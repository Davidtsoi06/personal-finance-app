/**
 * CostPriceModal — 手动修改成本价弹窗（保存后重算市值/盈亏，v1.10.13）。
 * 与 PriceModal（修改现价）并列，方便用户直接维护成本价。
 */
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';
import type { Holding } from './HoldingsTableCard';

interface Props {
  target: Holding | null;
  onClose: () => void;
  onChanged: () => void;
}

export function CostPriceModal({ target, onClose, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!target) return;
    const fd = new FormData(e.currentTarget);
    const cost = parseFloat(fd.get('cost_price') as string);
    if (!Number.isFinite(cost) || cost < 0) {
      setError('请输入大于等于 0 的有效成本价');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await invoke('asset:update', target.id, { cost_price: cost });
      setSaving(false);
      onClose();
      onChanged();
    } catch (err: any) {
      setSaving(false);
      setError('保存失败：' + (err?.message || '未知错误'));
    }
  };

  return (
    <Modal
      open={target !== null}
      title={'✏️ 手动修改成本价 · ' + (target?.name || '')}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">{'成本价（' + (target?.currency || '') + '）'}</label>
          <input
            className="form-input"
            name="cost_price"
            type="number"
            step="any"
            min="0"
            defaultValue={target?.cost_price ?? ''}
            required
          />
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
            修改后自动重算总成本、市值与盈亏
          </div>
        </div>
        {error && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)' }}>❌ {error}</div>}
        <div className="form-actions">
          <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </Modal>
  );
}