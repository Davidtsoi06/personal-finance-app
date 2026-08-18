/**
 * BrokerStatementImportModal — 券商日结单导入弹窗（粘贴 CSV / 上传文件 → 预览 → 确认导入，自 HoldingsDetail 拆分）。
 */
import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

interface ParsedTrade {
  date: string; code: string; name: string; type: 'buy' | 'sell';
  quantity: number; price: number; fee: number; currency: string;
}

interface Props {
  open: boolean;
  accountId: number;
  onClose: () => void;
  onImported: () => void;
}

const PLACEHOLDER = '粘贴日结单，支持多种格式：' + String.fromCharCode(10) + String.fromCharCode(10) +
  '标准 CSV 格式：' + String.fromCharCode(10) +
  '2026-08-03, 00700, 腾讯控股, buy, 100, 345.0, 15, HKD' + String.fromCharCode(10) +
  '2026-08-03, 09988, 阿里巴巴, sell, 50, 80.5, 10, HKD' + String.fromCharCode(10) + String.fromCharCode(10) +
  '或者富途格式：' + String.fromCharCode(10) +
  '成交日期, 证券代码, 证券名称, 买卖方向, 成交数量, 成交价格, 手续费, 币种' + String.fromCharCode(10) +
  '2026-08-03, 00700, 腾讯控股, 买入, 100, 345.0, 15, HKD' + String.fromCharCode(10) + String.fromCharCode(10) +
  '或盈透英文格式：' + String.fromCharCode(10) +
  'Date, Symbol, Description, Buy/Sell, Quantity, Price, Commission, Currency' + String.fromCharCode(10) +
  '2026-08-03, 00700, Tencent, Buy, 100, 345.0, 15, HKD';

export function BrokerStatementImportModal({ open, accountId, onClose, onImported }: Props) {
  const [csvText, setCsvText] = useState('');
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[] | null>(null);
  const [parseFormat, setParseFormat] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [brokerFormats, setBrokerFormats] = useState<string[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('');
  // v1.8.2：买卖方向反转开关（部分券商符号约定相反）
  const [flipDirection, setFlipDirection] = useState(false);

  useEffect(() => {
    if (open) {
      // 打开时重置状态（与原页面打开按钮行为一致）
      setCsvText('');
      setParsedTrades(null);
      setImportStatus('');
      invoke<string[]>('trade:listBrokerFormats').then((f) => setBrokerFormats(f || []));
    }
  }, [open]);

  const doParse = async (text: string, broker: string) => {
    if (!text.trim()) return;
    setImportStatus(broker ? '正在使用「' + broker + '」格式解析...' : '正在识别日结单格式...');
    setParsedTrades(null);
    try {
      const formatParam = broker || undefined;
      const result = await invoke<{
        success: boolean; format: string; trades: ParsedTrade[]; errors: string[];
      }>('trade:parseStatement', text, formatParam);
      if (result.success && result.trades.length > 0) {
        setParseFormat(result.format);
        setParsedTrades(result.trades);
        setImportStatus('✅ 识别为「' + result.format + '」，共 ' + result.trades.length + ' 条交易，请预览确认后导入');
      } else {
        setImportStatus('❌ 无法识别格式：' + (result.errors || ['未知格式']).join('，'));
      }
    } catch (err: any) {
      setImportStatus('❌ 解析失败：' + err.message);
    }
  };

  const handleParseStatement = async () => {
    await doParse(csvText, selectedBroker);
  };

  const handleBrokerChange = async (broker: string) => {
    setSelectedBroker(broker);
    if (csvText.trim()) {
      await doParse(csvText, broker);
    }
  };

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
        setParseFormat(result.format + ' · ' + result.fileName);
        setParsedTrades(result.trades);
        setImportStatus('✅ 识别为「' + result.format + '」，共 ' + result.trades.length + ' 条交易，请预览确认后导入');
      } else {
        setImportStatus('❌ 无法识别格式：' + (result.errors || ['未知格式']).join('，'));
      }
    } catch (err: any) {
      setImportStatus('❌ 读取文件失败：' + err.message);
    }
  };

  // v1.8.3：预览可编辑——用户可在预览上修正任意字段后再导入
  const updateTrade = (index: number, field: keyof ParsedTrade, value: string) => {
    setParsedTrades((prev) => {
      if (!prev) return prev;
      const next = prev.map((t, i) => {
        if (i !== index) return t;
        const copy = { ...t };
        if (field === 'quantity' || field === 'price' || field === 'fee') {
          copy[field] = parseFloat(value) || 0;
        } else if (field === 'type') {
          copy.type = value === 'sell' ? 'sell' : 'buy';
        } else {
          (copy as any)[field] = value;
        }
        return copy;
      });
      return next;
    });
  };

  const handleImportParsed = async () => {
    if (!parsedTrades || parsedTrades.length === 0) return;
    setImporting(true);
    setImportStatus('正在导入...');
    try {
      const finalTrades = flipDirection
        ? parsedTrades.map((t) => ({ ...t, type: t.type === 'buy' ? 'sell' : 'buy' }))
        : parsedTrades;
      const result = await invoke<{ imported: number; errors: string[] }>(
        'trade:importParsed', finalTrades, accountId
      );
      let msg = '✅ 成功导入 ' + result.imported + ' 条交易记录';
      if (result.errors.length > 0) {
        msg += '（' + result.errors.length + ' 条失败：' + result.errors.slice(0, 3).join('；') + '）';
      }
      setImportStatus(msg);
      setCsvText('');
      setParsedTrades(null);
      onImported();
    } catch (err: any) {
      setImportStatus('❌ 导入失败：' + err.message);
    }
    setImporting(false);
  };

  return (
    <Modal open={open} title="📥 导入日结单" onClose={onClose} width="700px">
      <div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
          粘贴 CSV 日结单，或直接上传文件（支持 CSV / Excel）。自动检测格式或手动选择券商。
        </p>
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
        {!parsedTrades && (
          <>
            <textarea
              className="form-input"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={PLACEHOLDER}
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
                <Button variant="secondary" onClick={onClose}>取消</Button>
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
        {parsedTrades && (
          <>
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: '#F6FFED', borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)',
            }}>
              已识别格式：<b>{parseFormat}</b>，共 <b>{parsedTrades.length}</b> 条交易 · 预览表格可直接修改后再导入
              <label style={{ marginLeft: 16, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={flipDirection} onChange={(e) => setFlipDirection(e.target.checked)} />
                🔁 反转买卖方向（部分券商的买入/卖出符号约定相反）
              </label>
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
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 96 }}
                          value={t.date} onChange={(e) => updateTrade(i, 'date', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 76 }}
                          value={t.code} onChange={(e) => updateTrade(i, 'code', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 110 }}
                          value={t.name} onChange={(e) => updateTrade(i, 'name', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                        <select className="form-select" style={{ padding: '2px 4px', fontSize: 'var(--font-size-xs)', width: 72 }}
                          value={flipDirection ? (t.type === 'buy' ? 'sell' : 'buy') : t.type}
                          onChange={(e) => updateTrade(i, 'type', flipDirection ? (e.target.value === 'sell' ? 'buy' : 'sell') : e.target.value)}
                        >
                          <option value="buy">买入</option>
                          <option value="sell">卖出</option>
                        </select>
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" type="number" step="any" min="0" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 76 }}
                          value={t.quantity} onChange={(e) => updateTrade(i, 'quantity', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" type="number" step="any" min="0" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 76 }}
                          value={t.price} onChange={(e) => updateTrade(i, 'price', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        <input className="form-input" type="number" step="any" min="0" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 66 }}
                          value={t.fee} onChange={(e) => updateTrade(i, 'fee', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                        <input className="form-input" style={{ padding: '2px 6px', fontSize: 'var(--font-size-xs)', width: 56 }}
                          value={t.currency} onChange={(e) => updateTrade(i, 'currency', e.target.value)} />
                      </td>
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
                {importing ? '导入中...' : '✅ 确认导入 ' + parsedTrades.length + ' 条记录'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
