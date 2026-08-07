import { useState } from 'react';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface Props {
  investmentAccountId: number;
  onClose: () => void;
  onSaved: () => void;
}

export function TradeForm({ investmentAccountId, onClose, onSaved }: Props) {
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {
      investmentAccountId,
      type: tradeType,
    };
    new FormData(form).forEach((v, k) => { data[k] = v; });
    data.quantity = parseFloat(data.quantity as string) || 0;
    data.price = parseFloat(data.price as string) || 0;
    data.fee = parseFloat(data.fee as string) || 0;

    try {
      const result = await invoke<{ success: boolean; error?: string }>('trade:record', data);
      if (result.success) {
        onSaved();
        onClose();
      } else {
        setError(result.error || '操作失败');
        setSaving(false);
      }
    } catch (err: any) {
      setError(err.message || '操作失败');
      setSaving(false);
    }
  };

  const marketByCurrency: Record<string, string> = {
    CNY: 'a_stock', HKD: 'hk_stock', USD: 'us_stock',
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Buy/Sell toggle */}
      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
        <button
          type="button"
          onClick={() => setTradeType('buy')}
          style={{
            flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
            borderColor: tradeType === 'buy' ? 'var(--color-success)' : 'var(--color-border)',
            background: tradeType === 'buy' ? '#F6FFED' : 'var(--color-surface)',
            color: tradeType === 'buy' ? 'var(--color-success)' : 'var(--color-text-muted)',
            fontWeight: tradeType === 'buy' ? 600 : 400,
            cursor: 'pointer', fontSize: 'var(--font-size-md)',
          }}
        >
          🟢 买入 Buy
        </button>
        <button
          type="button"
          onClick={() => setTradeType('sell')}
          style={{
            flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
            borderColor: tradeType === 'sell' ? 'var(--color-danger)' : 'var(--color-border)',
            background: tradeType === 'sell' ? '#FFF2F0' : 'var(--color-surface)',
            color: tradeType === 'sell' ? 'var(--color-danger)' : 'var(--color-text-muted)',
            fontWeight: tradeType === 'sell' ? 600 : 400,
            cursor: 'pointer', fontSize: 'var(--font-size-md)',
          }}
        >
          🔴 卖出 Sell
        </button>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">股票名称 *</label>
          <input className="form-input" name="name" required placeholder="如：腾讯控股" />
        </div>
        <div className="form-group">
          <label className="form-label">代码 *</label>
          <input className="form-input" name="code" required placeholder="如：00700" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">数量 *</label>
          <input className="form-input" name="quantity" type="number" step="any" required placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">价格 *</label>
          <input className="form-input" name="price" type="number" step="any" required placeholder="0.00" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">手续费</label>
          <input className="form-input" name="fee" type="number" step="any" defaultValue="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">币种</label>
          <select className="form-select" name="currency" defaultValue="HKD">
            <option value="HKD">HK$ 港币</option>
            <option value="USD">$ 美元</option>
            <option value="CNY">¥ 人民币</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">交易日期</label>
          <input className="form-input" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="form-group">
          <label className="form-label">类型</label>
          <select className="form-select" name="assetType" defaultValue="stock">
            <option value="stock">📊 股票</option>
            <option value="etf">📋 ETF</option>
            <option value="fund">💼 基金</option>
          </select>
        </div>
      </div>

      <input type="hidden" name="market" value="" />
      {/* market auto-derived from currency in backend */}

      <div className="form-group">
        <label className="form-label">备注</label>
        <input className="form-input" name="notes" placeholder="可选备注" />
      </div>

      {error && (
        <div style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          background: '#FFF2F0', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)',
          marginBottom: 'var(--spacing-md)',
        }}>
          {error}
        </div>
      )}

      <div className="form-actions">
        <Button variant="secondary" onClick={onClose} type="button">取消</Button>
        <Button variant={tradeType === 'buy' ? 'primary' : 'danger'} type="submit" disabled={saving}>
          {saving ? '处理中...' : tradeType === 'buy' ? '✅ 确认买入' : '⚠️ 确认卖出'}
        </Button>
      </div>
    </form>
  );
}
