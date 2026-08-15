import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { invoke } from '../hooks/useIpc';
import { AccountEditModal, EditableAccount } from '../components/account/AccountEditModal';
import './Accounts.css';

interface Account {
  id: number; name: string; type: string; currency: string; balance: number;
  bank_name: string | null; card_number: string | null;
  asset_type: string; display_alias: string | null;
  parent_account_id: number | null; sort_order: number;
}

interface AssetSummaryItem {
  id: number; name: string; asset_type: string; type: string;
  currency: string; balance: number;
  bank_name: string | null; broker: string | null;
  card_number: string | null; display_alias: string | null;
  market_value_cny: number; cash_balance?: number;
  asset_count?: number; total_profit_loss?: number;
  children: AssetSummaryItem[];
  is_investment: boolean;
}

const ASSET_TYPE_OPTIONS = [
  { value: 'bank', label: '银行卡', icon: '🏦', desc: '添加银行卡账户' },
  { value: 'investment', label: '券商账户', icon: '📈', desc: '添加证券/基金账户' },
];

const ASSET_CARD_ICONS: Record<string, string> = {
  e_wallet: '💬', cash: '💵', insurance: '🛡️', bank: '🏦', investment: '📈', custom: '✏️',
};

export function Accounts() {
  const [assetSummary, setAssetSummary] = useState<AssetSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBanks, setExpandedBanks] = useState<Set<string>>(new Set());

  // Add modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addAssetType, setAddAssetType] = useState('');
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);

  // Edit / delete modal state
  const [editingAccount, setEditingAccount] = useState<EditableAccount | null>(null);

  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const summary = await invoke<AssetSummaryItem[]>('account:allAssetsSummary');
      setAssetSummary(summary || []);
      const banks = await invoke<Account[]>('account:listBankAccounts');
      setBankAccounts(banks || []);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleBank = (bankName: string) => {
    setExpandedBanks(prev => {
      const next = new Set(prev);
      if (next.has(bankName)) next.delete(bankName);
      else next.add(bankName);
      return next;
    });
  };

  // ── Add handlers ──
  const handleAddBankCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = {
      name: fd.get('display_alias') || fd.get('name'),
      type: 'bank_card',
      asset_type: 'bank',
      currency: fd.get('currency') || 'CNY',
      balance: parseFloat(fd.get('balance') as string) || 0,
      bank_name: fd.get('bank_name'),
      card_number: fd.get('card_number'),
      display_alias: fd.get('display_alias') || null,
    };
    try {
      await invoke('account:create', data);
      setShowAdd(false);
      load();
    } catch (err) { console.error(err); }
  };

  const handleAddBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const data: Record<string, unknown> = {
      name: fd.get('name'),
      broker: fd.get('broker') || null,
      currency: fd.get('currency') || 'CNY',
      account_number: fd.get('account_number') || null,
      funding_account_id: fd.get('funding_account_id') || null,
    };
    try {
      await invoke('investmentAccount:create', data);
      setShowAdd(false);
      load();
    } catch (err) { console.error(err); }
  };

  // ── Compute stats ──
  const totalAssets = assetSummary.reduce((s, item) => s + (item.market_value_cny || 0), 0);
  const bankCount = assetSummary.filter(item => item.asset_type === 'bank').length;
  const brokerCount = assetSummary.filter(item => item.asset_type === 'investment').length;
  const walletCount = assetSummary.filter(item => item.asset_type === 'e_wallet').length;
  const policyCount = assetSummary.filter(item => item.asset_type === 'insurance').length;
  const cashCount = assetSummary.filter(item => item.asset_type === 'cash').length;
  const walletTotal = assetSummary
    .filter(item => item.asset_type === 'e_wallet')
    .reduce((s, item) => s + (item.market_value_cny || 0), 0);
  const brokerCashTotal = assetSummary
    .filter(item => item.asset_type === 'broker_cash')
    .reduce((s, item) => s + (item.market_value_cny || 0), 0);

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">资产管理</h2>
        <p className="page-subtitle">
          统一管理全部资产大类 · 总资产 <Amount value={totalAssets} currency="CNY" colored />
        </p>
        <Button variant="primary" onClick={() => { setAddAssetType(''); setShowAdd(true); }}>+ 添加资产</Button>
      </div>

      {/* Stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">总资产</div>
          <div className="stat-card-value number"><Amount value={totalAssets} currency="CNY" colored /></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">银行</div>
          <div className="stat-card-value number">{bankCount} 家</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">券商</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-md)' }}>
            {brokerCount} 家 · 流动金 ¥{brokerCashTotal.toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">电子钱包</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-md)' }}>
            {walletCount} 个 · ¥{walletTotal.toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">保单/现金</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-md)' }}>
            {policyCount}份 / {cashCount}个
          </div>
        </div>
      </div>

      {/* Layer 2 Cards */}
      {assetSummary.length === 0 ? (
        <Card><div className="card-placeholder">暂无资产，点击「添加资产」开始</div></Card>
      ) : (
        <div className="layer2-cards">
          {assetSummary.map((item) => {
            const assetType = item.asset_type;
            const icon = ASSET_CARD_ICONS[assetType] || '📦';

            // ── e_wallet card (WeChat, Alipay) ──
            if (assetType === 'e_wallet') {
              return (
                <div
                  key={`wallet-${item.id}`}
                  className="layer2-card layer2-card--clickable"
                  onClick={() => {
                    const slug = item.name === '微信' ? 'wechat' : item.name === '支付宝' ? 'alipay' : item.name.toLowerCase();
                    navigate(`/wallet/${slug}`);
                  }}
                >
                  <div className="layer2-card-main">
                    <div className="layer2-card-icon">{icon}</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">{item.name}</div>
                      <div className="layer2-card-meta">电子钱包 · 余额</div>
                    </div>
                    <div className="layer2-card-value">
                      <Amount value={item.market_value_cny} currency="CNY" colored />
                    </div>
                  </div>
                  <div className="layer2-card-actions">
                    <span className="layer2-card-link">查看流水 →</span>
                    <Button variant="secondary" size="sm" onClick={(e) => { e?.stopPropagation(); setEditingAccount(item as EditableAccount); }}>✏️</Button>
                  </div>
                </div>
              );
            }

            // ── Cash card ──
            if (assetType === 'cash') {
              return (
                <div
                  key={`cash-${item.id}`}
                  className="layer2-card layer2-card--clickable"
                  onClick={() => navigate(`/wallet/cash`)}
                >
                  <div className="layer2-card-main">
                    <div className="layer2-card-icon">{icon}</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">{item.name}</div>
                      <div className="layer2-card-meta">实体纸币</div>
                    </div>
                    <div className="layer2-card-value">
                      <Amount value={item.market_value_cny} currency="CNY" colored />
                    </div>
                  </div>
                  <div className="layer2-card-actions">
                    <span className="layer2-card-link">查看流水 →</span>
                    <Button variant="secondary" size="sm" onClick={(e) => { e?.stopPropagation(); setEditingAccount(item as EditableAccount); }}>✏️</Button>
                  </div>
                </div>
              );
            }

            // ── Insurance card ──
            if (assetType === 'insurance') {
              return (
                <div
                  key="insurance"
                  className="layer2-card layer2-card--clickable"
                  onClick={() => navigate('/insurance')}
                >
                  <div className="layer2-card-main">
                    <div className="layer2-card-icon">{icon}</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">保险</div>
                      <div className="layer2-card-meta">
                        保单现金价值
                      </div>
                    </div>
                    <div className="layer2-card-value">
                      <Amount value={item.market_value_cny} currency="CNY" colored />
                    </div>
                  </div>
                  <div className="layer2-card-actions">
                    <span className="layer2-card-link">管理保单 →</span>
                  </div>
                </div>
              );
            }

            // ── Bank group card (expandable) ──
            if (assetType === 'bank') {
              const isExpanded = expandedBanks.has(item.name);
              return (
                <div key={`bank-${item.name}`} className="layer2-card">
                  <div
                    className="layer2-card-main layer2-card--clickable"
                    onClick={() => toggleBank(item.name)}
                  >
                    <div className="layer2-card-icon">{icon}</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">{item.name}</div>
                      <div className="layer2-card-meta">
                        {item.children?.length || 0} 张卡
                      </div>
                    </div>
                    <div className="layer2-card-value">
                      <Amount value={item.market_value_cny} currency="CNY" colored={false} />
                      <span style={{ marginLeft: 8, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded card list */}
                  {isExpanded && item.children && item.children.length > 0 && (
                    <div className="layer2-card-children">
                      {item.children.map((child) => (
                        <div
                          key={`card-${child.id}`}
                          className="bank-card-row"
                          onClick={() => navigate(`/accounts/${child.id}`)}
                        >
                          <div className="bank-card-row-icon">💳</div>
                          <div className="bank-card-row-info">
                            <div className="bank-card-row-name">
                              {child.display_alias || child.name}
                            </div>
                            <div className="bank-card-row-meta">
                              {child.card_number ? `尾号 ${child.card_number.slice(-4)}` : ''}
                              {child.cash_balance && child.cash_balance > 0 ? ` · 定期 ${child.cash_balance.toLocaleString()}` : ''}
                              {(child.asset_count || 0) > 0 ? ` · 理财 ${child.asset_count} 笔` : ''}
                            </div>
                          </div>
                          <div className="bank-card-row-value">
                            <Amount value={child.market_value_cny} currency="CNY" colored />
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e?.stopPropagation();
                              setEditingAccount(child as EditableAccount);
                            }}
                          >
                            ✏️
                          </Button>
                        </div>
                      ))}
                      <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }} onClick={(e) => e.stopPropagation()}>
                        <Button variant="secondary" size="sm" onClick={() => {
                          setAddAssetType('bank');
                          setShowAdd(true);
                        }}>
                          + 添加银行卡
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ── Investment (broker) card ──
            if (assetType === 'investment') {
              return (
                <div
                  key={`inv-${item.id}`}
                  className="layer2-card layer2-card--clickable"
                  onClick={() => navigate('/investments')}
                >
                  <div className="layer2-card-main">
                    <div className="layer2-card-icon">{icon}</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">{item.name}</div>
                      <div className="layer2-card-meta">
                        {item.broker || '券商'}
                        {item.asset_count !== undefined && ` · ${item.asset_count} 个持仓`}
                        {item.total_profit_loss !== undefined && (
                          <span style={{
                            marginLeft: 8,
                            color: (item.total_profit_loss || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                          }}>
                            {(item.total_profit_loss || 0) >= 0 ? '+' : ''}{((item.total_profit_loss || 0)).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="layer2-card-value">
                      <div style={{ textAlign: 'right' }}>
                        <Amount value={item.market_value_cny} currency="CNY" colored={false} />
                        {item.cash_balance !== undefined && item.cash_balance > 0 && (
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary-500)' }}>
                            💵 现金 {(item.cash_balance || 0).toLocaleString()} {item.currency}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="layer2-card-actions">
                    <span className="layer2-card-link">进入投资管理 →</span>
                  </div>
                </div>
              );
            }

            // ── Broker cash (券商流动金) card (expandable, v1.5.8) ──
            if (assetType === 'broker_cash') {
              const isExpanded = expandedBanks.has(item.name);
              return (
                <div key="broker-cash" className="layer2-card">
                  <div
                    className="layer2-card-main layer2-card--clickable"
                    onClick={() => toggleBank(item.name)}
                  >
                    <div className="layer2-card-icon">💸</div>
                    <div className="layer2-card-info">
                      <div className="layer2-card-name">{item.name}</div>
                      <div className="layer2-card-meta">
                        {item.children?.length || 0} 个券商账户的闲置现金
                      </div>
                    </div>
                    <div className="layer2-card-value">
                      <Amount value={item.market_value_cny} currency="CNY" colored={false} />
                      <span style={{ marginLeft: 8, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>
                  {isExpanded && item.children && item.children.length > 0 && (
                    <div className="layer2-card-children">
                      {item.children.map((child) => (
                        <div key={'bc-' + child.id} className="bank-card-row">
                          <div className="bank-card-row-icon">📈</div>
                          <div className="bank-card-row-info">
                            <div className="bank-card-row-name">{child.name}</div>
                            <div className="bank-card-row-meta">
                              {child.broker ? child.broker + ' · ' : ''}现金 {child.currency} {(child.balance ?? 0).toLocaleString()}
                            </div>
                          </div>
                          <div className="bank-card-row-value">
                            <Amount value={child.market_value_cny} currency="CNY" showSign={false} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // ── Custom / Fallback ──
            return (
              <div key={`custom-${item.id}`} className="layer2-card">
                <div className="layer2-card-main">
                  <div className="layer2-card-icon">{icon}</div>
                  <div className="layer2-card-info">
                    <div className="layer2-card-name">{item.name}</div>
                    <div className="layer2-card-meta">{item.asset_type}</div>
                  </div>
                  <div className="layer2-card-value">
                    <Amount value={item.market_value_cny} currency="CNY" colored />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="layer2-actions" style={{ marginTop: 'var(--spacing-lg)', display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => { setAddAssetType('bank'); setShowAdd(true); }}>+ 添加银行卡</Button>
        <Button variant="secondary" onClick={() => { setAddAssetType('investment'); setShowAdd(true); }}>+ 添加券商账户</Button>
      </div>

      {/* ── Add Asset Modal ── */}
      <Modal
        open={showAdd}
        title={!addAssetType ? '选择资产类型' : addAssetType === 'bank' ? '添加银行卡' : '添加券商账户'}
        onClose={() => { setShowAdd(false); setAddAssetType(''); }}
      >
        {!addAssetType ? (
          <div className="asset-type-grid">
            {ASSET_TYPE_OPTIONS.map(opt => (
              <div
                key={opt.value}
                className="asset-type-card"
                onClick={() => setAddAssetType(opt.value)}
              >
                <div className="asset-type-card-icon">{opt.icon}</div>
                <div className="asset-type-card-label">{opt.label}</div>
                <div className="asset-type-card-desc">{opt.desc}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
              <Button variant="secondary" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        ) : addAssetType === 'bank' ? (
          <form onSubmit={handleAddBankCard}>
            <div className="form-group">
              <label className="form-label">银行名称 *</label>
              <input className="form-input" name="bank_name" required placeholder="如：招商银行" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">卡片别名</label>
                <input className="form-input" name="display_alias" placeholder="如：工资卡" />
              </div>
              <div className="form-group">
                <label className="form-label">卡号 *</label>
                <input className="form-input" name="card_number" required placeholder="完整卡号（仅保存后 4 位）" />
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
                <label className="form-label">初始余额</label>
                <input className="form-input" name="balance" type="number" step="0.01" defaultValue="0" />
              </div>
            </div>
            <input type="hidden" name="name" value="" />
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setAddAssetType('')} type="button">← 返回</Button>
              <Button variant="secondary" onClick={() => { setShowAdd(false); setAddAssetType(''); }} type="button">取消</Button>
              <Button variant="primary" type="submit">创建</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleAddBroker}>
            <div className="form-group">
              <label className="form-label">账户名称 *</label>
              <input className="form-input" name="name" required placeholder="如：五矿基金" />
            </div>
            <div className="form-group">
              <label className="form-label">券商/机构</label>
              <input className="form-input" name="broker" placeholder="如：耀才证券" />
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
                <label className="form-label">账号（选填）</label>
                <input className="form-input" name="account_number" placeholder="选填" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">关联银行账户</label>
              <select className="form-select" name="funding_account_id" defaultValue="">
                <option value="">无关联</option>
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={ba.id}>🏦 {ba.bank_name || ba.name} · {ba.card_number ? `尾号${ba.card_number.slice(-4)}` : ba.name}</option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setAddAssetType('')} type="button">← 返回</Button>
              <Button variant="secondary" onClick={() => { setShowAdd(false); setAddAssetType(''); }} type="button">取消</Button>
              <Button variant="primary" type="submit">创建</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Edit / Delete Account Modal ── */}
      <AccountEditModal
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onChanged={load}
      />
    </div>
  );
}
