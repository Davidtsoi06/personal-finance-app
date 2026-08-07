import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Column } from '../components/ui/Table';
import { Amount, PctAmount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { TradeForm } from '../components/forms/TradeForm';
import { invoke } from '../hooks/useIpc';
import { MARKET_LABELS, ASSET_TYPE_LABELS } from '@shared/constants/labels';

interface Holding {
  id: number; name: string; code: string; type: string; market: string;
  currency: string; quantity: number; cost_price: number; current_price: number;
  market_value: number; total_cost: number; profit_loss: number; profit_loss_pct: number;
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
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

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
      render: (r) => <Amount value={r.current_price} currency={r.currency} showSign={false} size="sm" />,
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
      <Modal open={showTrade} title="📝 记录交易" onClose={() => setShowTrade(false)} width="520px">
        <TradeForm investmentAccountId={accountId} onClose={() => setShowTrade(false)} onSaved={load} />
      </Modal>

      {/* Import Statement Modal with Smart Parsing */}
      <Modal open={showImport} title="📥 导入日结单" onClose={() => setShowImport(false)} width="700px">
        <div>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            粘贴 CSV 日结单，或直接上传券商 Excel 文件。自动检测格式或手动选择券商。
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
                    📂 上传 Excel
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
    </div>
  );
}
