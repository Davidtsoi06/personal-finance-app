import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface Category {
  id: number;
  name: string;
  type: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function AddLedgerForm({ onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [ledgerType, setLedgerType] = useState('expense');
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    invoke<Category[]>('category:list', ledgerType)
      .then((data) => setCategories(data || []));
  }, [ledgerType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    data.amount = parseFloat(data.amount as string) || 0;
    data.category_id = parseInt(data.category_id as string) || 0;
    data.type = ledgerType;
    try {
      await invoke('ledger:create', data);
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group" style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        <Button
          variant={ledgerType === 'expense' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setLedgerType('expense')}
          type="button"
        >
          支出
        </Button>
        <Button
          variant={ledgerType === 'income' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setLedgerType('income')}
          type="button"
        >
          收入
        </Button>
      </div>

      <div style={{ marginTop: 'var(--spacing-md)' }}>
        <div className="form-group">
          <label className="form-label">金额 *</label>
          <input className="form-input" name="amount" type="number" step="0.01" required placeholder="0.00" />
        </div>
        <div className="form-group">
          <label className="form-label">分类 *</label>
          <select className="form-select" name="category_id" required>
            <option value="">选择分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">描述</label>
          <input className="form-input" name="description" placeholder="如：午餐外卖" />
        </div>
        <div className="form-group">
          <label className="form-label">日期</label>
          <input className="form-input" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="form-group">
          <label className="form-label">标签（逗号分隔）</label>
          <input className="form-input" name="tags" placeholder="如：外卖, 周末" />
        </div>
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? '保存中...' : '记一笔'}
        </Button>
      </div>
    </form>
  );
}
