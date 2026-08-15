/**
 * AccountTxFormModal — 存入/取出资金表单弹窗。
 */
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  txType: 'deposit' | 'withdraw';
  onTypeChange: (t: 'deposit' | 'withdraw') => void;
  accountCurrency: string;
  invAccounts: Array<{ id: number; name: string; broker: string | null; currency: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function AccountTxFormModal({ open, txType, onTypeChange, accountCurrency, invAccounts, saving, error, onClose, onSubmit }: Props) {
  return (
    <Modal
      open={open}
      title={txType === 'deposit' ? '📥 存入资金' : '📤 取出资金'}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
          <button
            type="button"
            onClick={() => onTypeChange('deposit')}
            style={{
              flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
              borderColor: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-border)',
              background: txType === 'deposit' ? '#F6FFED' : 'var(--color-surface)',
              color: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-text-muted)',
              fontWeight: txType === 'deposit' ? 600 : 400,
              cursor: 'pointer', fontSize: 'var(--font-size-md)',
            }}
          >
            📥 存入
          </button>
          <button
            type="button"
            onClick={() => onTypeChange('withdraw')}
            style={{
              flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
              borderColor: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-border)',
              background: txType === 'withdraw' ? '#FFF2F0' : 'var(--color-surface)',
              color: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-text-muted)',
              fontWeight: txType === 'withdraw' ? 600 : 400,
              cursor: 'pointer', fontSize: 'var(--font-size-md)',
            }}
          >
            📤 取出
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">金额 *</label>
          <input
            className="form-input" name="amount" type="number" step="any"
            required placeholder="0.00" autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">币种</label>
            <select className="form-select" name="currency" defaultValue={accountCurrency}>
              <option value="CNY">¥ 人民币</option>
              <option value="HKD">HK$ 港币</option>
              <option value="USD">$ 美元</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">日期</label>
            <input
              className="form-input" name="date" type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">备注</label>
          <input className="form-input" name="notes" placeholder="如：工资入账 / 取现" />
        </div>
        {txType === 'withdraw' && invAccounts.length > 0 && (
          <div className="form-group">
            <label className="form-label">转入投资账户（可选）</label>
            <select className="form-select" name="investment_account_id" defaultValue="">
              <option value="">不转入</option>
              {invAccounts.map(ia => (
                <option key={ia.id} value={ia.id}>📈 {ia.name}{ia.broker ? ' (' + ia.broker + ')' : ''} ({ia.currency})</option>
              ))}
            </select>
          </div>
        )}
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
          <Button variant={txType === 'deposit' ? 'primary' : 'danger'} type="submit" disabled={saving}>
            {saving ? '处理中...' : txType === 'deposit' ? '确认存入' : '确认取出'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
