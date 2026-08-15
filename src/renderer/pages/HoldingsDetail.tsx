import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Column } from '../components/ui/Table';
import { Amount, PctAmount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { SlidePanel } from '../components/ui/SlidePanel';
import { TradeForm } from '../components/forms/TradeForm';
import { invoke } from '../hooks/useIpc';
import { MARKET_LABELS, ASSET_TYPE_LABELS } from '@shared/constants/labels';

interface Holding {
  id: number; name: string; code: string; type: string; market: string;
  currency: string; quantity: number; cost_price: number; current_price: number;
  market_value: number; total_cost: number; profit_loss: number; profit_loss_pct: number;
  investment_account_id?: number | null;
  notes?: string | null;
}

interface TradeRecord {
  id: number; asset_id: number; type: string; quantity: number; price: number;
  fee: number; total_amount: number; currency: string; date: string; notes: string | null;
  asset_name: string; asset_code: string;
}

interface ParsedTrade {
  date: string; code: string; name: string; type: 'buy' | 'sell';
  quantity: number; price: number; fee: number; currency: string;
}

export function HoldingsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(true);
  const [showTrade, setShowTrade] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[] | null>(null);
  const [parseFormat, setParseFormat] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [deleteHolding, setDeleteHolding] = useState<Holding | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeRecord | null>(null);
  const [deletingTrade, setDeletingTrade] = useState<TradeRecord | null>(null);
  const [priceTarget, setPriceTarget] = useState<Holding | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState('');

  // ── Investment accounts for edit holding modal dropdown ──
  const [invAccounts, setInvAccounts] = useState<Array<{id: number; name: string; broker: string | null}>>([]);

  // ── Import broker selection ──
  const [brokerFormats, setBrokerFormats] = useState<string[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('');

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

  // Load investment accounts for edit-holding modal dropdown
  useEffect(() => {
    invoke<Array<{id: number; name: string; broker: string | null}>>('investmentAccount:list')
      .then(list => setInvAccounts(list || []))
      .catch(() => {});
  }, []);

  // ── Load broker formats when import modal opens ──
  useEffect(() => {
    if (showImport) {
      invoke<string[]>('trade:listBrokerFormats').then((f) => setBrokerFormats(f || []));
    }
  }, [showImport]);

  /** Parse the current CSV text with the selected broker format */
  const doParse = async (text: string, broker: string) => {
    if (!text.trim()) return;
    setImportStatus(broker ? `正在使用「${broker}」格式解析...` : '正在识别日结单格式...');
    setParsedTrades(null);
    try {
      const formatParam = broker || undefined;
      const result = await invoke<{
        success: boolean; format: string; trades: ParsedTrade[]; errors: string[];
      }>('trade:parseStatement', text, formatParam);
      if (result.success && result.trades.length > 0) {
        setParseFormat(result.format);
        setParsedTrades(result.trades);
        setImportStatus(`✅ 识别为「${result.format}」，共 ${result.trades.length} 条交易，请预览确认后导入`);
      } else {
        setImportStatus(`❌ 无法识别格式：${(result.errors || ['未知格式']).join('，')}`);
      }
    } catch (err: any) {
      setImportStatus(`❌ 解析失败：${err.message}`);
    }
  };

  /** Step 1: Parse statement with smart format matching */
  const handleParseStatement = async () => {
    await doParse(csvText, selectedBroker);
  };

  /** Handle broker selection change — re-parse if there's text */
  const handleBrokerChange = async (broker: string) => {
    setSelectedBroker(broker);
    if (csvText.trim()) {
      await doParse(csvText, broker);
    }
  };

  /** Handle Excel file upload — pick file, parse, preview */
  const handleExcelUpload = async () => {
    setImportStatus('正在打开文件选择器...');
    setParsedTrades(null);
    try {
      const formatParam = selectedBroker || undefined;
      const result = await invoke<{
        canceled: boolean;
        fileName?: string;
        success?: boolean;
        format?: string;
        trades?: ParsedTrade[];
        errors?: string[];
      }>('trade:importExcel', formatParam);

      if (result.canceled) {
        setImportStatus('');
        return;
      }

      if (result.success && result.trades && result.trades.length > 0) {
        setParseFormat(`${result.format} · ${result.fileName}`);
        setParsedTrades(result.trades);
        setImportStatus(`✅ 识别为「${result.format}」，共 ${result.trades.length} 条交易，请预览确认后导入`);
      } else {
        setImportStatus(`❌ 无法识别格式：${(result.errors || ['未知格式']).join('，')}`);
      }
    } catch (err: any) {
      setImportStatus(`❌ 读取文件失败：${err.message}`);
    }
  };

  /** Step 2: Import parsed trades */
  const handleImportParsed = async () => {
    if (!parsedTrades || parsedTrades.length === 0) return;
    setImporting(true);
    setImportStatus('正在导入...');
    try {
      const result = await invoke<{ imported: number; errors: string[] }>(
        'trade:importParsed', parsedTrades, accountId
      );
      let msg = `✅ 成功导入 ${result.imported} 条交易记录`;
      if (result.errors.length > 0) {
        msg += `（${result.errors.length} 条失败：${result.errors.slice(0, 3).join('；')}）`;
      }
      setImportStatus(msg);
      setCsvText('');
      setParsedTrades(null);
      load();
    } catch (err: any) {
      setImportStatus(`❌ 导入失败：${err.message}`);
    }
    setImporting(false);
  };

  /** Edit holding — submit updated quantity / cost_price / name / notes */
  const handleEditHolding = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingHolding) return;
    const fd = new FormData(e.currentTarget);
    const quantity = parseFloat(fd.get('quantity') as string);
    const costPrice = parseFloat(fd.get('cost_price') as string);
    const data: Record<string, any> = {
      name: fd.get('name'),
      code: fd.get('code'),
      type: fd.get('type'),
      market: fd.get('market'),
      currency: fd.get('currency'),
      notes: fd.get('notes'),
      investment_account_id: fd.get('investment_account_id') || null,
      quantity,
      cost_price: costPrice,
    };
    // Recalculate derived fields so updateAsset triggers the auto-recalc
    data.total_cost = quantity * costPrice;
    try {
      await invoke('asset:update', editingHolding.id, data);
      setEditingHolding(null);
      load();
    } catch (err: any) {
      console.error('编辑持仓失败:', err);
    }
  };

  /** Delete holding — removes asset + related transactions */
  const handleDeleteHolding = async () => {
    if (!deleteHolding) return;
    try {
      await invoke('asset:delete', deleteHolding.id);
      setDeleteHolding(null);
      load();
    } catch (err: any) {
      console.error('删除持仓失败:', err);
    }
  };

  /** Edit trade record */
  const handleEditTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrade) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const quantity = parseFloat(fd.get('quantity') as string);
    const price = parseFloat(fd.get('price') as string);
    const fee = parseFloat(fd.get('fee') as string) || 0;
    try {
      await invoke('transaction:update', editingTrade.id, {
        type: fd.get('type'), quantity, price, fee,
        currency: fd.get('currency'), date: fd.get('date'), notes: fd.get('notes'),
      });
      setEditingTrade(null);
      load();
    } catch (err: any) { console.error(err); }
  };

  /** Delete trade record */
  const handleDeleteTrade = async () => {
    if (!deletingTrade) return;
    try {
      await invoke('transaction:delete', deletingTrade.id);
      setDeletingTrade(null);
      load();
    } catch (err: any) { console.error(err); }
  };

  /** Manual current-price update — recalculates market value / P&L + records price history */
  const handleUpdatePrice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!priceTarget) return;
    const fd = new FormData(e.currentTarget);
    const price = parseFloat(fd.get('price') as string);
    if (!Number.isFinite(price) || price <= 0) {
      setPriceError('请输入大于 0 的有效价格');
      return;
    }
    setPriceError('');
    setSavingPrice(true);
    try {
      await invoke('asset:updatePrice', priceTarget.id, price);
      setPriceTarget(null);
      setSavingPrice(false);
      load();
    } catch (err: any) {
      setSavingPrice(false);
      setPriceError(`保存失败：${err?.message || '未知错误'}`);
    }
  };

  const totalMV = holdings.reduce((s, h) => s + h.market_value, 0);
  const totalPL = holdings.reduce((s, h) => s + h.profit_loss, 0);

  const holdingColumns: Column<Holding>[] = [
    {
      key: 'name', title: '名称/代码',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {r.code} · {MARKET_LABELS[r.market] || r.market}
          </div>
        </div>
      ),
    },
    {
      key: 'type', title: '类型',
      render: (r) => ASSET_TYPE_LABELS[r.type] || r.type,
    },
    {
      key: 'currency', title: '货币', align: 'center',
      render: (r) => <span style={{ fontWeight: 500 }}>{r.currency}</span>,
    },
    {
      key: 'quantity', title: '持仓数量', align: 'right',
      render: (r) => r.quantity.toLocaleString(),
    },
    {
      key: 'cost_price', title: '成本价', align: 'right',
      render: (r) => <Amount value={r.cost_price} currency={r.currency} showSign={false} size="sm" />,
    },
    {
      key: 'current_price', title: '最新价', align: 'right',
      render: (r) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Amount value={r.current_price} currency={r.currency} showSign={false} size="sm" />
          <Button variant="secondary" size="sm" onClick={() => setPriceTarget(r)}>✏️</Button>
        </div>
      ),
    },
    {
      key: 'market_value', title: '市值', align: 'right',
      render: (r) => <Amount value={r.market_value} currency={r.currency} showSign={false} />,
    },
    {
      key: 'profit_loss', title: '盈亏', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <Amount value={r.profit_loss} currency={r.currency} colored />
          <PctAmount value={r.profit_loss_pct} />
        </div>
      ),
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
          <Button variant="secondary" size="sm" onClick={() => setEditingHolding(r)}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeleteHolding(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  const tradeColumns: Column<TradeRecord>[] = [
    {
      key: 'date', title: '日期',
      render: (r) => r.date,
    },
    {
      key: 'type', title: '方向', align: 'center',
      render: (r) => (
        <Badge
          label={r.type === 'buy' ? '🟢 买入' : '🔴 卖出'}
          color={r.type === 'buy' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'asset', title: '股票',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.asset_name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.asset_code}</div>
        </div>
      ),
    },
    {
      key: 'quantity', title: '数量', align: 'right',
      render: (r) => r.quantity.toLocaleString(),
    },
    {
      key: 'price', title: '价格', align: 'right',
      render: (r) => <Amount value={r.price} currency={r.currency} showSign={false} size="sm" />,
    },
    {
      key: 'total_amount', title: '金额', align: 'right',
      render: (r) => (
        <span style={{ color: r.type === 'buy' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 500 }}>
          {r.type === 'buy' ? '-' : '+'}
          <Amount value={r.total_amount} currency={r.currency} showSign={false} />
        </span>
      ),
    },
    {
      key: 'actions', title: '操作', align: 'center',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <Button variant="secondary" size="sm" onClick={() => setEditingTrade(r)}>✏️</Button>
          <Button variant="secondary" size="sm" onClick={() => setDeletingTrade(r)}>🗑</Button>
        </div>
      ),
    },
  ];

  if (loading) return <div className="page-loading">加载中...</div>;

  // Filter trades for selected holding
  const holdingTradeHistory = selectedHolding
    ? trades.filter((t) => t.asset_id === selectedHolding.id)
    : [];

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
          <Button variant="secondary" onClick={() => { setParsedTrades(null); setCsvText(''); setImportStatus(''); setShowImport(true); }}>📥 导入日结单</Button>
        </div>
      </div>

      {/* Holdings Table */}
      <Card title="💼 当前持仓">
        <Table
          columns={holdingColumns}
          data={holdings}
          rowKey={(r) => r.id}
          onRowClick={(row) => setSelectedHolding(row)}
          emptyText="暂无持仓，点击「记录交易」或「导入日结单」"
        />
      </Card>

      {/* Single Stock Trade History Modal */}
      <Modal
        open={selectedHolding !== null}
        title={`📜 ${selectedHolding?.name || ''} (${selectedHolding?.code || ''}) 交易记录`}
        onClose={() => setSelectedHolding(null)}
        width="700px"
      >
        {selectedHolding && (
          <>
            <div style={{
              display: 'flex', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-md)',
              padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
            }}>
              <div>当前持仓：<b>{selectedHolding.quantity.toLocaleString()} 股</b></div>
              <div>成本价：<b>{selectedHolding.currency} {selectedHolding.cost_price.toFixed(3)}</b></div>
              <div>最新价：<b>{selectedHolding.currency} {selectedHolding.current_price.toFixed(3)}</b></div>
              <Button variant="secondary" size="sm" onClick={() => setPriceTarget(selectedHolding)}>✏️ 改价</Button>
            </div>
            <Table
              columns={[
                { key: 'date', title: '日期', render: (r: TradeRecord) => r.date },
                {
                  key: 'type', title: '方向', align: 'center',
                  render: (r: TradeRecord) => (
                    <Badge
                      label={r.type === 'buy' ? '🟢 买入' : '🔴 卖出'}
                      color={r.type === 'buy' ? 'success' : 'danger'}
                    />
                  ),
                },
                {
                  key: 'quantity', title: '数量', align: 'right',
                  render: (r: TradeRecord) => r.quantity.toLocaleString(),
                },
                {
                  key: 'price', title: '价格', align: 'right',
                  render: (r: TradeRecord) => <Amount value={r.price} currency={r.currency} showSign={false} size="sm" />,
                },
                {
                  key: 'total_amount', title: '金额', align: 'right',
                  render: (r: TradeRecord) => (
                    <span style={{ color: r.type === 'buy' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 500 }}>
                      {r.type === 'buy' ? '-' : '+'}
                      <Amount value={r.total_amount} currency={r.currency} showSign={false} />
                    </span>
                  ),
                },
                {
                  key: 'notes', title: '备注',
                  render: (r: TradeRecord) => r.notes || <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
                },
              ]}
              data={holdingTradeHistory}
              rowKey={(r) => r.id}
              emptyText="暂无该股票的交易记录"
            />
          </>
        )}
      </Modal>

      {/* Trade History */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="📜 交易记录">
          <Table columns={tradeColumns} data={trades} rowKey={(r) => r.id} emptyText="暂无交易记录" />
        </Card>
      </div>

      {/* Trade Form Modal */}
      <SlidePanel open={showTrade} title="📝 记录交易" onClose={() => setShowTrade(false)} width={520}>
        <TradeForm investmentAccountId={accountId} onClose={() => setShowTrade(false)} onSaved={load} />
      </SlidePanel>

      {/* Import Statement Modal with Smart Parsing */}
      <Modal open={showImport} title="📥 导入日结单" onClose={() => setShowImport(false)} width="700px">
        <div>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            粘贴 CSV 日结单，或直接上传文件（支持 CSV / Excel）。自动检测格式或手动选择券商。
          </p>

          {/* Broker format selector */}
          <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, whiteSpace: 'nowrap' }}>券商格式：</label>
            <select
              value={selectedBroker}
              onChange={(e) => handleBrokerChange(e.target.value)}
              style={{
                flex: 1, padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)',
                background: 'var(--color-bg-primary)', cursor: 'pointer',
              }}
            >
              <option value="">🔍 自动检测</option>
              {brokerFormats.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* Step 1: Paste raw text */}
          {!parsedTrades && (
            <>
              <textarea
                className="form-input"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`粘贴日结单，支持多种格式：

标准 CSV 格式：
2026-08-03, 00700, 腾讯控股, buy, 100, 345.0, 15, HKD
2026-08-03, 09988, 阿里巴巴, sell, 50, 80.5, 10, HKD

或者富途格式：
成交日期, 证券代码, 证券名称, 买卖方向, 成交数量, 成交价格, 手续费, 币种
2026-08-03, 00700, 腾讯控股, 买入, 100, 345.0, 15, HKD

或盈透英文格式：
Date, Symbol, Description, Buy/Sell, Quantity, Price, Commission, Currency
2026-08-03, 00700, Tencent, Buy, 100, 345.0, 15, HKD`}
                rows={10}
                style={{ height: 'auto', fontFamily: 'var(--font-family-number)', fontSize: 'var(--font-size-xs)' }}
              />
              {importStatus && (
                <div style={{
                  marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm) var(--spacing-md)',
                  background: importStatus.startsWith('✅') ? '#F6FFED' : importStatus.startsWith('❌') ? '#FFF2F0' : importStatus.startsWith('正在') ? '#E6F7FF' : '#FFFBE6',
                  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
                }}>
                  {importStatus}
                </div>
              )}
              <div className="form-actions" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                  <Button variant="secondary" onClick={() => setShowImport(false)}>取消</Button>
                  <Button variant="secondary" onClick={handleExcelUpload}>
                    📂 上传文件
                  </Button>
                </div>
                <Button variant="primary" onClick={handleParseStatement} disabled={!csvText.trim()}>
                  🔍 识别并解析
                </Button>
              </div>
            </>
          )}

          {/* Step 2: Preview parsed trades */}
          {parsedTrades && (
            <>
              <div style={{
                padding: 'var(--spacing-sm) var(--spacing-md)',
                background: '#F6FFED', borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)',
              }}>
                已识别格式：<b>{parseFormat}</b>，共 <b>{parsedTrades.length}</b> 条交易
              </div>

              <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: 'var(--spacing-md)' }}>
                <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-secondary)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>日期</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>代码</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>名称</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>方向</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>数量</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>价格</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>手续费</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>币种</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTrades.map((t, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '6px 8px' }}>{t.date}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'var(--font-family-number)' }}>{t.code}</td>
                        <td style={{ padding: '6px 8px' }}>{t.name}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <span style={{
                            color: t.type === 'buy' ? 'var(--color-success)' : t.type === 'sell' ? 'var(--color-danger)' : t.type === 'split' ? 'var(--color-primary-500)' : 'var(--color-text-secondary)',
                            fontWeight: 500,
                          }}>
                            {t.type === 'buy' ? '买入' : t.type === 'sell' ? '卖出' : t.type === 'split' ? '分拆' : '其他'}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>{t.quantity.toLocaleString()}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>{t.price.toFixed(3)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>{t.fee.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>{t.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importStatus && (
                <div style={{
                  marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)',
                  padding: 'var(--spacing-sm) var(--spacing-md)',
                  background: importStatus.startsWith('✅') ? '#F6FFED' : importStatus.startsWith('❌') ? '#FFF2F0' : '#E6F7FF',
                  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
                }}>
                  {importStatus}
                </div>
              )}

              <div className="form-actions">
                <Button variant="secondary" onClick={() => { setParsedTrades(null); setImportStatus(''); }}>
                  ← 返回修改
                </Button>
                <Button variant="primary" onClick={handleImportParsed} disabled={importing}>
                  {importing ? '导入中...' : `✅ 确认导入 ${parsedTrades.length} 条记录`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Edit Holding Modal ── */}
      <Modal
        open={editingHolding !== null}
        title={`✏️ 编辑持仓 · ${editingHolding?.name || ''}`}
        onClose={() => setEditingHolding(null)}
      >
        {editingHolding && (
          <form onSubmit={handleEditHolding}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">名称</label>
                <input className="form-input" name="name" defaultValue={editingHolding.name} required />
              </div>
              <div className="form-group">
                <label className="form-label">代码</label>
                <input className="form-input" name="code" defaultValue={editingHolding.code} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">类型</label>
                <select className="form-input" name="type" defaultValue={editingHolding.type}>
                  {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">市场</label>
                <select className="form-input" name="market" defaultValue={editingHolding.market}>
                  {Object.entries(MARKET_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">货币</label>
                <select className="form-input" name="currency" defaultValue={editingHolding.currency}>
                  <option value="CNY">CNY 人民币</option>
                  <option value="HKD">HKD 港币</option>
                  <option value="USD">USD 美元</option>
                  <option value="EUR">EUR 欧元</option>
                  <option value="JPY">JPY 日元</option>
                  <option value="GBP">GBP 英镑</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">持仓数量</label>
                <input className="form-input" name="quantity" type="number" step="any" defaultValue={editingHolding.quantity} required />
              </div>
              <div className="form-group">
                <label className="form-label">成本价</label>
                <input className="form-input" name="cost_price" type="number" step="any" defaultValue={editingHolding.cost_price} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingHolding.notes || ''} />
            </div>
            <div className="form-group">
              <label className="form-label">投资账户</label>
              <select className="form-select" name="investment_account_id" defaultValue={editingHolding.investment_account_id || ''}>
                <option value="">不关联</option>
                {invAccounts.map(ia => (
                  <option key={ia.id} value={ia.id}>📈 {ia.name}{ia.broker ? ` (${ia.broker})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingHolding(null)} type="button">取消</Button>
              <Button variant="primary" type="submit">保存</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Holding Modal ── */}
      <Modal
        open={deleteHolding !== null}
        title="🗑 删除持仓"
        onClose={() => setDeleteHolding(null)}
      >
        {deleteHolding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <p>确认删除持仓「{deleteHolding.name}」({deleteHolding.code}) 吗？</p>
            <div style={{
              padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
            }}>
              <div>持仓数量：<b>{deleteHolding.quantity.toLocaleString()}</b></div>
              <div>当前市值：<b>{deleteHolding.currency} {deleteHolding.market_value.toLocaleString()}</b></div>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              此操作不可撤销，关联交易记录和价格历史将一并删除。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
              <Button variant="secondary" onClick={() => setDeleteHolding(null)}>取消</Button>
              <Button variant="danger" onClick={handleDeleteHolding}>确认删除</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Trade Modal ── */}
      <Modal open={!!editingTrade} title="✏️ 编辑交易记录" onClose={() => setEditingTrade(null)}>
        {editingTrade && (
          <form onSubmit={handleEditTrade}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">方向</label>
                <select className="form-select" name="type" defaultValue={editingTrade.type}>
                  <option value="buy">🟢 买入</option>
                  <option value="sell">🔴 卖出</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-select" name="currency" defaultValue={editingTrade.currency}>
                  <option value="CNY">¥ 人民币</option>
                  <option value="HKD">HK$ 港币</option>
                  <option value="USD">$ 美元</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">数量 *</label>
                <input className="form-input" name="quantity" type="number" step="any" defaultValue={editingTrade.quantity} required />
              </div>
              <div className="form-group">
                <label className="form-label">价格 *</label>
                <input className="form-input" name="price" type="number" step="any" defaultValue={editingTrade.price} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">手续费</label>
                <input className="form-input" name="fee" type="number" step="any" defaultValue={editingTrade.fee} />
              </div>
              <div className="form-group">
                <label className="form-label">日期</label>
                <input className="form-input" name="date" type="date" defaultValue={editingTrade.date} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">备注</label>
              <input className="form-input" name="notes" defaultValue={editingTrade.notes || ''} />
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditingTrade(null)} type="button">取消</Button>
              <Button variant="primary" type="submit">保存修改</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Trade Modal ── */}
      <Modal open={!!deletingTrade} title="🗑 删除交易记录" onClose={() => setDeletingTrade(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <p>确认删除此交易记录吗？持仓数据将自动回滚。</p>
          {deletingTrade && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {deletingTrade.type === 'buy' ? '🟢 买入' : '🔴 卖出'} · {deletingTrade.asset_name} · {deletingTrade.quantity}股@{deletingTrade.price} · {deletingTrade.date}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setDeletingTrade(null)}>取消</Button>
            <Button variant="danger" onClick={handleDeleteTrade}>确认删除</Button>
          </div>
        </div>
      </Modal>

      {/* ── Manual Current Price Modal ── */}
      <Modal
        open={priceTarget !== null}
        title={`✏️ 手动修改现价 · ${priceTarget?.name || ''}`}
        onClose={() => { setPriceTarget(null); setPriceError(''); }}
        width="480px"
      >
        {priceTarget && (
          <form key={priceTarget.id} onSubmit={handleUpdatePrice}>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-md)',
            }}>
              <div>{priceTarget.name}（{priceTarget.code}）</div>
              <div>当前现价：<b>{priceTarget.currency} {priceTarget.current_price.toFixed(3)}</b></div>
              <div>成本价：{priceTarget.currency} {priceTarget.cost_price.toFixed(3)}</div>
            </div>
            <div className="form-group">
              <label className="form-label">新现价（{priceTarget.currency}）</label>
              <input
                className="form-input" name="price" type="number" step="any" min="0"
                defaultValue={priceTarget.current_price} autoFocus required
              />
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-sm)' }}>
              保存后市值、盈亏将按新价格自动重算，并记录一条价格历史。之后自动刷新成功获取到价格时，会被最新价格覆盖。
            </p>
            {priceError && (
              <div style={{
                padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-sm)',
              }}>
                {priceError}
              </div>
            )}
            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setPriceTarget(null); setPriceError(''); }}>取消</Button>
              <Button variant="primary" type="submit" disabled={savingPrice}>
                {savingPrice ? '保存中...' : '保存新价格'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
