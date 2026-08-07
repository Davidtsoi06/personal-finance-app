import { useState } from 'react';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function AddAccountForm({ onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = { balance: 0 };
    new FormData(form).forEach((v, k) => { data[k] = v; });
    data.balance = parseFloat(data.balance as string) || 0;
    try {
      await invoke('account:create', data);
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label">账户名称 *</label>
        <input className="form-input" name="name" required placeholder="如：招商银行储蓄卡" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">类型 *</label>
          <select className="form-select" name="type" required>
            <option value="bank_card">🏦 银行卡</option>
            <option value="cash">💵 现金</option>
            <option value="credit_card">💳 信用卡</option>
            <option value="online_pay">📱 在线支付</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">币种</label>
          <select className="form-select" name="currency" defaultValue="CNY">
            <option value="CNY">¥ 人民币</option>
            <option value="HKD">HK$ 港币</option>
            <option value="USD">$ 美元</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">当前余额</label>
        <input className="form-input" name="balance" type="number" step="0.01" defaultValue="0" placeholder="0.00" />
      </div>
      <div className="form-group">
        <label className="form-label">银行名称</label>
        <input className="form-input" name="bank_name" placeholder="如：招商银行" />
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </form>
  );
}
