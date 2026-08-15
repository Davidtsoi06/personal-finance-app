import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Amount } from '../components/ui/Amount';
import { invoke } from '../hooks/useIpc';

interface InvAccount {
  id: number; name: string; broker: string | null; currency: string;
  account_number: string | null; funding_account_id?: number | null; notes: string | null;
  assetCount?: number; totalMarketValue?: number; totalProfitLoss?: number; cashBalance?: number;
  totalValue?: number;
  /** CNY 口径（v1.5.6 跨币种汇总） */
  totalMarketValueCny?: number; totalProfitLossCny?: number; cashBalanceCny?: number; totalValueCny?: number;
}

interface DailyStats {
  buyCount: number; sellCount: number; realizedPnl: number; currency: string;
}

interface TodayTrade {
  id: number; asset_id: number; type: string; quantity: number;
  price: number; fee: number; total_amount: number; currency: string;
  date: string; notes: string | null; created_at: string; assetName: string;
}

export function Investments() {
  const [accounts, setAccounts] = useState<InvAccount[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [todayTrades, setTodayTrades] = useState<TodayTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  // Edit / Delete state
  const [editingAcc, setEditingAcc] = useState<InvAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvAccount | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Cash management state
  const [cashTarget, setCashTarget] = useState<InvAccount | null>(null);
  const [cashType, setCashType] = useState<'add' | 'withdraw'>('add');
  const [cashSaving, setCashSaving] = useState(false);

  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [list, stats, trades] = await Promise.all([
        invoke<InvAccount[]>('investmentAccount:list'),
        invoke<DailyStats>('investmentAccount:dailyStats').catch(() => null),
        invoke<TodayTrade[]>('transaction:todayList').catch(() => []),
      ]);
      setDailyStats(stats);
      setTodayTrades(trades || []);
      const enriched = await Promise.all(
        (list || []).map(async (acc) => {
          const summary = await invoke<{ assetCount: number; totalMarketValue: number; totalProfitLoss: number; cashBalance: number; totalValue: number }>(
            'investmentAccount:summary', acc.id
          );
          return { ...acc, ...summary };
        })
      );
      setAccounts(enriched);
      // Load bank accounts for funding dropdown
      invoke<any[]>('account:list').then((ba) => setBankAccounts((ba || []).filter((a: any) => a.asset_type === 'bank')));
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Add ──
  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    try { await invoke('investmentAccount:create', data); setShowAdd(false); load(); }
    catch (err) { console.error(err); }
  };

  // ── Edit ──
  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => { data[k] = v || null; });
    try { await invoke('investmentAccount:update', editingAcc!.id, data); setEditingAcc(null); load(); }
    catch (err) { console.error(err); }
  };

  // ── Delete ──
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await invoke<{ success: boolean; error?: string }>('investmentAccount:delete', deleteTarget.id);
      if (result.success) { setDeleteTarget(null); load(); }
      else { setDeleteError(result.error || '删除失败'); }
    } catch (err: any) { setDeleteError(err.message || '删除失败'); }
  };

  // ── Cash Management ──
  const handleCashOp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cashTarget) return;
    setCashSaving(true);
    const form = e.target as HTMLFormElement;
    const amount = parseFloat((form.elements as any).amount.value) || 0;
    if (amount <= 0) { setCashSaving(false); return; }
    try {
      if (cashType === 'add') {
        await invoke('investmentAccount:addCash', cashTarget.id, amount);
      } else {
        await invoke('investmentAccount:withdrawCash', cashTarget.id, amount);
      }
      setCashTarget(null);
      load();
    } catch (err: any) { console.error(err); }
    setCashSaving(false);
  };

  // Format time from ISO string
  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso?.slice(11, 16) || '-'; }
  };

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">投资管理</h2>
        <p className="page-subtitle">管理你的投资账户，查看持仓明细与当日交易</p>
        <Button variant="primary" onClick={() => setShowAdd(true)}>+ 添加投资账户</Button>
      </div>

      {/* ── Today's Trades ── */}
      <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: todayTrades.length > 0 ? 'var(--spacing-md)' : 0 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600 }}>📋 今日交易</h3>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {new Date().toLocaleDateString('zh-CN')}
          </span>
        </div>
        {todayTrades.length === 0 ? (
          <div className="card-placeholder">暂无今日交易</div>
        ) : (
          <Table
            columns={[
              { key: 'time', title: '时间', render: (row: TodayTrade) => formatTime(row.created_at) },
              { key: 'assetName', title: '标的', render: (row: TodayTrade) => row.assetName },
              { key: 'type', title: '操作', render: (row: TodayTrade) => (
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--font-size-xs)', fontWeight: 600,
                  background: row.type === 'buy' ? '#E6F7E9' : '#FFF2F0',
                  color: row.type === 'buy' ? 'var(--color-success)' : 'var(--color-danger)',
                }}>
                  {row.type === 'buy' ? '买入' : row.type === 'sell' ? '卖出' : row.type}
                </span>
              )},
              { key: 'quantity', title: '数量', render: (row: TodayTrade) => row.quantity.toLocaleString() },
              { key: 'price', title: '价格', render: (row: TodayTrade) => (
                <Amount value={row.price} currency={row.currency} showSign={false} />
              )},
              { key: 'total_amount', title: '总金额', render: (row: TodayTrade) => (
                <Amount value={row.total_amount} currency={row.currency} colored={row.type === 'buy' ? undefined : true} showSign={false} />
              )},
            ]}
            data={todayTrades}
          />
        )}
      </Card>

      {/* Stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">投资账户数</div>
          <div className="stat-card-value number">{accounts.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">总市值</div>
          <div className="stat-card-value number">
            <Amount value={accounts.reduce((s, a) => s + (a.totalMarketValueCny || 0), 0)} currency="CNY" showSign={false} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">总盈亏</div>
          <div className="stat-card-value number">
            <Amount value={accounts.reduce((s, a) => s + (a.totalProfitLoss || 0), 0)} currency="CNY" colored />
          </div>
        </div>
      </div>

      {/* Daily Trade Stats */}
      {dailyStats && (
        <div className="stat-cards" style={{ marginTop: 'var(--spacing-md)' }}>
          <div className="stat-card">
            <div className="stat-card-label">📈 今日买入</div>
            <div className="stat-card-value number">{dailyStats.buyCount} 笔</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">📉 今日卖出</div>
            <div className="stat-card-value number">{dailyStats.sellCount} 笔</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">💰 今日已实现盈亏</div>
            <div className="stat-card-value number">
              <Amount value={dailyStats.realizedPnl} currency={dailyStats.currency} colored />
            </div>
          </div>
        </div>
      )}

      {/* Investment Account Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {accounts.length === 0 && (
          <Card><div className="card-placeholder">暂无投资账户，点击「添加投资账户」开始</div></Card>
        )}
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="inv-account-card"
            style={{
              background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
              padding: 'var(--spacing-lg)', boxShadow: 'var(--shadow-sm)',
              cursor: 'pointer', transition: 'box-shadow 0.2s',
            }}
            onClick={() => navigate(`/investments/${acc.id}`)}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Header: name + edit/delete buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                  🏦 {acc.name}
                </div>
                <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                  <Button variant="secondary" size="sm" onClick={() => setEditingAcc(acc)}>✏️</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setDeleteTarget(acc); setDeleteError(''); }}>🗑</Button>
                </div>
              </div>
              {/* Body: broker info + market value */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {acc.broker && `${acc.broker} · `}{acc.currency} {acc.account_number && `· ${acc.account_number}`}
                  {acc.funding_account_id && (() => {
                    const bank = bankAccounts.find((b: any) => b.id === acc.funding_account_id);
                    return bank ? <span style={{ marginLeft: '8px' }}>🏦 {bank.name}</span> : null;
                  })()}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ marginBottom: '4px' }}>
                    <Amount value={acc.totalValueCny ?? acc.totalValue ?? acc.totalMarketValue ?? 0} currency="CNY" showSign={false} size="lg" />
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {acc.assetCount || 0} 个持仓
                    {acc.cashBalance !== undefined && acc.cashBalance > 0 && (
                      <span style={{ marginLeft: '8px', color: 'var(--color-primary-500)' }}>
                        💵 {acc.cashBalance.toLocaleString()} {acc.currency}
                      </span>
                    )}
                    <span style={{ marginLeft: '8px', color: (acc.totalProfitLoss || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {(acc.totalProfitLoss || 0) >= 0 ? '+' : ''}{((acc.totalProfitLoss || 0)).toLocaleString()} {acc.currency}
                    </span>
                  </div>
                </div>
              </div>
              {/* Cash management */}
              <div onClick={e => e.stopPropagation()} style={{
                display: 'flex', gap: '6px', paddingTop: '4px',
                borderTop: '1px solid var(--color-border-light)',
              }}>
                <Button variant="secondary" size="sm" onClick={() => { setCashTarget(acc); setCashType('add'); }}>
                  💵 存入
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setCashTarget(acc); setCashType('withdraw'); }}>
                  📤 取出
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Add Modal ── */}
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
          <div className="form-group">
            <label className="form-label">关联银行账户</label>
            <select className="form-select" name="funding_account_id" defaultValue="">
              <option value="">无关联</option>
              {bankAccounts.map((ba: any) => (
                <option key={ba.id} value={ba.id}>🏦 {ba.name} ({ba.currency})</option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowAdd(false)} type="button">取消</Button>
            <Button variant="primary" type="submit">保存</Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingAcc} title="编辑投资账户" onClose={() => setEditingAcc(null)}>
        {editingAcc && (
          <form onSubmit={handleEdit}>
            <div className="form-group">
              <label className="form-label">账户名称 *</label>
              <input className="form-input" name="name" required defaultValue={editingAcc.name} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">券商</label>
                <input className="form-input" name="broker" defaultValue={editingAcc.broker || ''} />
              </div>
              <div className="form-group">
                <label className="form-label">主要币种</label>
                <select className="form-select" name="currency" defaultValue={editingAcc.currency}>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                  <option value="CNY">¥ 人民币</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">账号</label>
              <input className="form-input" name="account_number" defaultValue={editingAcc.account_number || ''} />
            </div>
            <div className="form-group">
              <label className="form-label">关联银行账户</label>
              <select className="form-select" name="funding_account_id" defaultValue={editingAcc.funding_account_id || ''}>
                <option value="">无关联</option>
                {bankAccounts.map((ba: any) => (
                  <option key={ba.id} value={ba.id}>🏦 {ba.name} ({ba.currency})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingAcc.notes || ''} />
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingAcc(null)} type="button">取消</Button>
              <Button variant="primary" type="submit">保存</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal open={!!deleteTarget} title="删除投资账户" onClose={() => { setDeleteTarget(null); setDeleteError(''); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除投资账户「{deleteTarget?.name}」吗？</p>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            删除后，该账户下的持仓将被保留但取消关联。此操作不可撤销。
          </p>
          {deleteError && <div className="form-error">{deleteError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteError(''); }}>取消</Button>
            <Button variant="danger" onClick={handleDelete}>确认删除</Button>
          </div>
        </div>
      </Modal>

      {/* ── Cash Management Modal ── */}
      <Modal
        open={!!cashTarget}
        title={cashType === 'add' ? `💵 存入现金 — ${cashTarget?.name || ''}` : `📤 提取现金 — ${cashTarget?.name || ''}`}
        onClose={() => setCashTarget(null)}
      >
        <form onSubmit={handleCashOp}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
            当前现金余额：{cashTarget?.currency} {(cashTarget?.cashBalance || 0).toLocaleString()}
          </p>
          <div className="form-group">
            <label className="form-label">金额 *</label>
            <input
              className="form-input" name="amount" type="number" step="any"
              required placeholder="0.00" autoFocus
            />
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setCashTarget(null)} type="button">取消</Button>
            <Button variant={cashType === 'add' ? 'primary' : 'danger'} type="submit" disabled={cashSaving}>
              {cashSaving ? '处理中...' : cashType === 'add' ? '确认存入' : '确认取出'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
