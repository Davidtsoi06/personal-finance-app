import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Amount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';
import { usePriceRefresh } from '../hooks/usePriceRefresh';
import { ACCOUNT_TYPE_LABELS, ASSET_TYPE_LABELS } from '@shared/constants/labels';
import { AccountTransactionsSection, AccountTransaction } from '../components/account/AccountTransactionsSection';
import { FixedDepositsSection } from '../components/account/FixedDepositsSection';
import { BankStatementImportModal } from '../components/account/BankStatementImportModal';

interface AccountBalance {
  id: number; account_id: number; currency: string; balance: number;
}

interface Account {
  id: number; name: string; type: string; currency: string;
  balance: number; bank_name: string | null; card_number: string | null;
  balances: AccountBalance[];
}

interface BankAsset {
  id: number; name: string; code: string; type: string; market: string;
  currency: string; quantity: number; cost_price: number; current_price: number;
  market_value: number; total_cost: number; profit_loss: number; profit_loss_pct: number;
  investment_account_id: number | null; account_id: number | null;
}

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [bankAssets, setBankAssets] = useState<BankAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBankImport, setShowBankImport] = useState(false);

  const accountId = parseInt(id || '0');

  const load = useCallback(async () => {
    try {
      const [acc, txs, assets] = await Promise.all([
        invoke<Account>('account:get', accountId),
        invoke<AccountTransaction[]>('accountTransaction:list', accountId),
        invoke<BankAsset[]>('asset:listByAccount', accountId).catch(() => []),
      ]);
      setAccount(acc);
      setTransactions(txs || []);
      setBankAssets(assets || []);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);
  usePriceRefresh(load); // v1.10.0：股价更新后账户详情自动同步

  if (loading) return <div className="page-loading">加载中...</div>;
  if (!account) return <div className="page-loading">账户不存在</div>;

  return (
    <div className="page">
      <div className="page-header">
        <button
          onClick={() => navigate('/accounts')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-500)',
            padding: 0, marginBottom: 'var(--spacing-xs)',
          }}
        >
          ← 返回账户列表
        </button>
        <h2 className="page-title">{account.name}</h2>
        <p className="page-subtitle">
          {ACCOUNT_TYPE_LABELS[account.type] || account.type}
          {account.bank_name && ' · ' + account.bank_name}
          {account.card_number && ' · 尾号 ' + account.card_number}
          {' · '}当前余额 <Amount value={account.balance} currency={account.currency} colored size="md" />
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="secondary" onClick={() => { setShowBankImport(true); }}>
            📥 导入银行日结单
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">当前余额</div>
          <div className="stat-card-value number">
            <Amount value={account.balance} currency={account.currency} colored />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">交易次数</div>
          <div className="stat-card-value number">{transactions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">最近交易</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-sm)' }}>
            {transactions.length > 0 ? transactions[0].date : '暂无'}
          </div>
        </div>
      </div>

      {/* Multi-currency balances */}
      {account.balances && account.balances.length > 0 && (
        <Card title="💱 多币种余额">
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
            {account.balances.map(b => {
              const isZero = Math.abs(b.balance) < 0.005;
              return (
              <div key={b.currency} style={{
                flex: '1 1 180px',
                background: 'var(--color-bg, #fafbfc)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--spacing-md)',
                border: '1px solid var(--color-border-light, #f0f0f0)',
                textAlign: 'center',
                position: 'relative',
              }}>
                {/* v1.10.9：余额归零的币种可删除（不再占位） */}
                {isZero && (
                  <button
                    title="删除该币种（余额为 0）"
                    onClick={async () => {
                      try {
                        await invoke('account:deleteBalanceBucket', accountId, b.currency);
                        load();
                      } catch (err: any) {
                        console.error(err);
                        alert('删除失败：' + (err?.message || '未知错误'));
                      }
                    }}
                    style={{
                      position: 'absolute', top: 4, right: 6, border: 'none', background: 'none',
                      cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)',
                    }}
                  >🗑</button>
                )}
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  {b.currency}
                </div>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
                  {b.currency === 'CNY' ? '¥' : b.currency === 'HKD' ? 'HK$' : '$'}
                  {b.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Fixed Deposits */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <FixedDepositsSection accountId={accountId} accountCurrency={account.currency} onChanged={load} />
      </div>

      {/* Bank Products (stocks/funds/ETFs held at bank) */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📊 银行理财产品">
          {bankAssets.length === 0 ? (
            <div className="card-placeholder">暂无银行理财产品，持仓中的银行理财/基金/ETF会显示在这里</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
              {bankAssets.map(asset => {
                const isPositive = asset.profit_loss >= 0;
                return (
                  <div
                    key={asset.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: 'var(--spacing-sm) var(--spacing-md)',
                      background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                    onClick={() => navigate('/holdings/' + asset.id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
                        <span>{asset.name}</span>
                        <Badge label={ASSET_TYPE_LABELS[asset.type] || asset.type} color="primary" />
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        {asset.code}
                        {asset.currency !== 'CNY' && ' · ' + asset.currency}
                        {' · '}数量 {asset.quantity.toLocaleString()}
                        {' · '}成本 {asset.cost_price.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: 'var(--spacing-md)' }}>
                      <div style={{ fontWeight: 600 }}>
                        <Amount value={asset.market_value} currency={asset.currency} colored={false} />
                      </div>
                      <div style={{
                        fontSize: 'var(--font-size-xs)',
                        color: isPositive ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>
                        {isPositive ? '+' : ''}{asset.profit_loss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {' '}({asset.profit_loss_pct >= 0 ? '+' : ''}{asset.profit_loss_pct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Transaction History */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <AccountTransactionsSection
          accountId={accountId}
          accountCurrency={account.currency}
          transactions={transactions}
          onTransactionsChange={setTransactions}
          onChanged={load}
        />
      </div>

      {/* Bank Statement Import Modal */}
      <BankStatementImportModal
        open={showBankImport}
        accountId={accountId}
        onClose={() => setShowBankImport(false)}
        onImported={load}
      />
    </div>
  );
}
