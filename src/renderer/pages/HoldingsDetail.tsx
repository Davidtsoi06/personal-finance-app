import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Amount } from '../components/ui/Amount';
import { SlidePanel } from '../components/ui/SlidePanel';
import { TradeForm } from '../components/forms/TradeForm';
import { invoke } from '../hooks/useIpc';
import { HoldingsTableCard, Holding } from '../components/holdings/HoldingsTableCard';
import { TradesTableCard, TradeRecord } from '../components/holdings/TradesTableCard';
import { TradeHistoryModal } from '../components/holdings/TradeHistoryModal';
import { PriceModal } from '../components/holdings/PriceModal';
import { BrokerStatementImportModal } from '../components/holdings/BrokerStatementImportModal';
import { CashFlowCard } from '../components/holdings/CashFlowCard';

export function HoldingsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(true);
  const [showTrade, setShowTrade] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [priceTarget, setPriceTarget] = useState<Holding | null>(null);

  const accountId = parseInt(id || '0');

  const load = useCallback(async () => {
    try {
      const [acc, hList, tList] = await Promise.all([
        invoke<any>('investmentAccount:get', accountId),
        invoke<Holding[]>('investmentAccount:holdings', accountId),
        invoke<TradeRecord[]>('transaction:listByAccount', accountId),
      ]);
      setAccountName(acc?.name || '投资账户');
      setHoldings(hList || []);
      setTrades(tList || []);
      // Keep open modals referencing fresh data after reload
      setSelectedHolding(prev => (prev ? (hList || []).find(h => h.id === prev.id) || null : null));
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const totalMV = holdings.reduce((s, h) => s + h.market_value, 0);
  const totalPL = holdings.reduce((s, h) => s + h.profit_loss, 0);

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <button
          onClick={() => navigate('/investments')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-500)',
            padding: 0, marginBottom: 'var(--spacing-xs)',
          }}
        >
          ← 返回投资账户列表
        </button>
        <h2 className="page-title">🏦 {accountName} · 持仓明细</h2>
        <p className="page-subtitle">
          {holdings.length} 个持仓 · 总市值 <Amount value={totalMV} currency="CNY" showSign={false} />
          {' · '}总盈亏 <Amount value={totalPL} currency="CNY" colored />
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="primary" onClick={() => setShowTrade(true)}>📝 记录交易</Button>
          <Button variant="secondary" onClick={() => setShowImport(true)}>📥 导入日结单</Button>
        </div>
      </div>

      {/* Holdings Table */}
      <HoldingsTableCard
        holdings={holdings}
        onRowClick={setSelectedHolding}
        onPriceEdit={setPriceTarget}
        onChanged={load}
      />

      {/* Single Stock Trade History Modal */}
      <TradeHistoryModal
        holding={selectedHolding}
        trades={trades}
        onClose={() => setSelectedHolding(null)}
        onPriceEdit={setPriceTarget}
      />

      {/* Trade History */}
      <TradesTableCard trades={trades} onChanged={load} />

      {/* Cash Flow (v1.5.6) */}
      <CashFlowCard accountId={accountId} onChanged={load} />

      {/* Trade Form Modal */}
      <SlidePanel open={showTrade} title="📝 记录交易" onClose={() => setShowTrade(false)} width={520}>
        <TradeForm investmentAccountId={accountId} onClose={() => setShowTrade(false)} onSaved={load} />
      </SlidePanel>

      {/* Import Statement Modal with Smart Parsing */}
      <BrokerStatementImportModal
        open={showImport}
        accountId={accountId}
        onClose={() => setShowImport(false)}
        onImported={load}
      />

      {/* ── Manual Current Price Modal ── */}
      <PriceModal target={priceTarget} onClose={() => setPriceTarget(null)} onChanged={load} />
    </div>
  );
}
