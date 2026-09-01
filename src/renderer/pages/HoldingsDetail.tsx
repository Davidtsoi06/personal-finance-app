import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Amount } from '../components/ui/Amount';
import { SlidePanel } from '../components/ui/SlidePanel';
import { TradeForm } from '../components/forms/TradeForm';
import { invoke } from '../hooks/useIpc';
import { usePriceRefresh } from '../hooks/usePriceRefresh';
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
  const [cnyTotals, setCnyTotals] = useState<{ marketValueCny: number; profitLossCny: number }>({ marketValueCny: 0, profitLossCny: 0 });
  const [loading, setLoading] = useState(true);
  const [showTrade, setShowTrade] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [priceTarget, setPriceTarget] = useState<Holding | null>(null);

  const accountId = parseInt(id || '0');
  // v1.8.0：交易历史分页加载
  const [tradeLimit, setTradeLimit] = useState(200);
  // v1.10.13：交易/校正后递增，触发 CashFlowCard 重新加载（现金余额立即刷新）
  const [flowRefresh, setFlowRefresh] = useState(0);

  const load = useCallback(async () => {
    try {
      const [acc, hList, tList, sum] = await Promise.all([
        invoke<any>('investmentAccount:get', accountId),
        invoke<Holding[]>('investmentAccount:holdings', accountId),
        invoke<TradeRecord[]>('transaction:listByAccount', accountId, tradeLimit),
        invoke<any>('investmentAccount:summary', accountId).catch(() => null),
      ]);
      setAccountName(acc?.name || '投资账户');
      setHoldings(hList || []);
      setTrades(tList || []);
      if (sum) {
        setCnyTotals({
          marketValueCny: sum.totalMarketValueCny ?? sum.totalMarketValue ?? 0,
          profitLossCny: sum.totalProfitLossCny ?? sum.totalProfitLoss ?? 0,
        });
      }
      // Keep open modals referencing fresh data after reload
      setSelectedHolding(prev => (prev ? (hList || []).find(h => h.id === prev.id) || null : null));
      // v1.10.13：刷新现金流卡片（现金余额随交易立即更新）
      setFlowRefresh(k => k + 1);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId, tradeLimit]);

  useEffect(() => { load(); }, [load]);
  usePriceRefresh(load); // v1.10.0：股价更新后持仓详情自动同步

  // 跨币种总市值/总盈亏统一使用后端 CNY 口径（v1.5.6 修正混币汇总）
  const totalMV = cnyTotals.marketValueCny;
  const totalPL = cnyTotals.profitLossCny;

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
      {trades.length >= tradeLimit && (
        <div style={{ textAlign: 'center', marginTop: 'var(--spacing-sm)' }}>
          <Button variant="secondary" size="sm" onClick={() => setTradeLimit((l) => l + 200)}>
            加载更多交易记录（当前 {trades.length} 条）
          </Button>
        </div>
      )}

      {/* Cash Flow (v1.5.6) */}
      <CashFlowCard accountId={accountId} onChanged={load} refreshKey={flowRefresh} />

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
