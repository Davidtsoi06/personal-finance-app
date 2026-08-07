import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { invoke } from '../hooks/useIpc';

interface InvAccount {
  id: number; name: string; broker: string | null; currency: string;
  account_number: string | null; notes: string | null;
  assetCount?: number; totalMarketValue?: number; totalProfitLoss?: number;
}

export function Investments() {
  const [accounts, setAccounts] = useState<InvAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const list = await invoke<InvAccount[]>('investmentAccount:list');
      // Load summary for each account
      const enriched = await Promise.all(
        (list || []).map(async (acc) => {
          const summary = await invoke<{ assetCount: number; totalMarketValue: number; totalProfitLoss: number }>(
            'investmentAccount:summary', acc.id
          );
          return { ...acc, ...summary };
        })
      );
      setAccounts(enriched);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    try {
      await invoke('investmentAccount:create', data);
      setShowAdd(false);
      load();
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">投资管理</h2>
        <p className="page-subtitle">管理你的投资账户，点击查看持仓明细</p>
        <Button variant="primary" onClick={() => setShowAdd(true)}>+ 添加投资账户</Button>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">投资账户数</div>
          <div className="stat-card-value number">{accounts.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">总市值</div>
          <div className="stat-card-value number">
            <Amount value={accounts.reduce((s, a) => s + (a.totalMarketValue || 0), 0)} currency="CNY" showSign={false} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">总盈亏</div>
          <div className="stat-card-value number">
            <Amount value={accounts.reduce((s, a) => s + (a.totalProfitLoss || 0), 0)} currency="CNY" colored />
          </div>
        </div>
      </div>

      {/* Investment Account Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {accounts.length === 0 && (
          <Card><div className="card-placeholder">暂无投资账户，点击「添加投资账户」开始</div></Card>
        )}
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="inv-account-card"
            onClick={() => navigate(`/investments/${acc.id}`)}
            style={{
              background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
              padding: 'var(--spacing-lg)', boxShadow: 'var(--shadow-sm)',
              cursor: 'pointer', transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '4px' }}>
                  🏦 {acc.name}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {acc.broker && `${acc.broker} · `}{acc.currency} {acc.account_number && `· ${acc.account_number}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ marginBottom: '4px' }}>
                  <Amount value={acc.totalMarketValue || 0} currency={acc.currency} showSign={false} size="lg" />
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {acc.assetCount || 0} 个持仓
                  <span style={{ marginLeft: '8px', color: (acc.totalProfitLoss || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {(acc.totalProfitLoss || 0) >= 0 ? '+' : ''}{((acc.totalProfitLoss || 0)).toLocaleString()} {acc.currency}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Investment Account Modal */}
      <Modal open={showAdd} title="添加投资账户" onClose={() => setShowAdd(false)}>
        <form onSubmit={handleAdd}>
          <div className="form-group">
            <label className="form-label">账户名称 *</label>
            <input className="form-input" name="name" required placeholder="如：富途牛牛" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">券商</label>
              <input className="form-input" name="broker" placeholder="如：富途证券" />
            </div>
            <div className="form-group">
              <label className="form-label">主要币种</label>
              <select className="form-select" name="currency" defaultValue="HKD">
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
                <option value="CNY">¥ 人民币</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">账号</label>
            <input className="form-input" name="account_number" placeholder="选填" />
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowAdd(false)} type="button">取消</Button>
            <Button variant="primary" type="submit">保存</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
