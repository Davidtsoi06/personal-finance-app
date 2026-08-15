/**
 * PriceModal — 手动修改现价弹窗（保存后重算市值/盈亏并记录价格历史，自 HoldingsDetail 拆分）。
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

export function PriceModal({ target, onClose, onChanged }: Props) {
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState('');

  const handleUpdatePrice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!target) return;
    const fd = new FormData(e.currentTarget);
    const price = parseFloat(fd.get('price') as string);
    if (!Number.isFinite(price) || price <= 0) {
      setPriceError('请输入大于 0 的有效价格');
      return;
    }
    setPriceError('');
    setSavingPrice(true);
    try {
      await invoke('asset:updatePrice', target.id, price);
      setSavingPrice(false);
      onClose();
      onChanged();
    } catch (err: any) {
      setSavingPrice(false);
      setPriceError('保存失败：' + (err?.message || '未知错误'));
    }
  };

  return (
    <Modal
      open={target !== null}
      title={'✏️ 手动修改现价 · ' + (target?.name || '')}
      onClose={() => { onClose(); setPriceError(''); }}
      width="480px"
    >
      {target && (
        <form key={target.id} onSubmit={handleUpdatePrice}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)',
            padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
            marginBottom: 'var(--spacing-md)',
          }}>
            <div>{target.name}（{target.code}）</div>
            <div>当前现价：<b>{target.currency} {target.current_price.toFixed(3)}</b></div>
            <div>成本价：{target.currency} {target.cost_price.toFixed(3)}</div>
          </div>
          <div className="form-group">
            <label className="form-label">新现价（{target.currency}）</label>
            <input
              className="form-input" name="price" type="number" step="any" min="0"
              defaultValue={target.current_price} autoFocus required
            />
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-sm)' }}>
            保存后市值、盈亏将按新价格自动重算，并记录一条价格历史。之后自动刷新成功获取到价格时，会被最新价格覆盖。
          </p>
          {priceError && (
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-sm)',
            }}>
              {priceError}
            </div>
          )}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => { onClose(); setPriceError(''); }}>取消</Button>
            <Button variant="primary" type="submit" disabled={savingPrice}>
              {savingPrice ? '保存中...' : '保存新价格'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
