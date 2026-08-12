import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface Props {
  onClose: () => void;
  onSaved: () => void;
  investmentAccountId?: number;
}

interface InvAccountOption {
  id: number;
  name: string;
  broker: string | null;
}

export function AddAssetForm({ onClose, onSaved, investmentAccountId }: Props) {
  const [saving, setSaving] = useState(false);
  const [invAccounts, setInvAccounts] = useState<InvAccountOption[]>([]);

  useEffect(() => {
    invoke<InvAccountOption[]>('investmentAccount:list').then((list) => {
      setInvAccounts(list || []);
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    data.quantity = parseFloat(data.quantity as string) || 0;
    data.cost_price = parseFloat(data.cost_price as string) || 0;
    // Use form's investment_account_id if provided, otherwise fall back to prop
    const formInvId = (data as any).investment_account_id;
    if (formInvId) {
      (data as any).investmentAccountId = parseInt(formInvId);
    } else if (investmentAccountId) {
      (data as any).investmentAccountId = investmentAccountId;
    }
    delete (data as any).investment_account_id;
    try {
      await invoke('asset:create', data);
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">资产名称 *</label>
          <input className="form-input" name="name" required placeholder="如：腾讯控股" />
        </div>
        <div className="form-group">
          <label className="form-label">代码 *</label>
          <input className="form-input" name="code" required placeholder="如：00700" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">类型 *</label>
          <select className="form-select" name="type" required>
            <option value="stock">📊 股票</option>
            <option value="fund">💼 基金</option>
            <option value="etf">📋 ETF</option>
            <option value="gold">🥇 黄金</option>
            <option value="crypto">₿ 加密货币</option>
            <option value="fixed_deposit">🏦 定期存款</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">市场</label>
          <select className="form-select" name="market" defaultValue="other">
            <option value="a_stock">A股</option>
            <option value="hk_stock">港股</option>
            <option value="us_stock">美股</option>
            <option value="other">其他</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">持有数量 *</label>
          <input className="form-input" name="quantity" type="number" step="any" required placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">成本价 *</label>
          <input className="form-input" name="cost_price" type="number" step="any" required placeholder="0.00" />
        </div>
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
          <label className="form-label">关联账户</label>
          <select className="form-select" name="account_id">
            <option value="">不关联</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">投资账户</label>
          <select className="form-select" name="investment_account_id" defaultValue={investmentAccountId || ''}>
            <option value="">不关联</option>
            {invAccounts.map(ia => (
              <option key={ia.id} value={ia.id}>
                📈 {ia.name}{ia.broker ? ` (${ia.broker})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">备注</label>
        <input className="form-input" name="notes" placeholder="可选备注" />
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? '保存中...' : '添加持仓'}
        </Button>
      </div>
    </form>
  );
}
