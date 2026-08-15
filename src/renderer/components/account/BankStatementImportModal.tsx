/**
 * BankStatementImportModal — 银行日结单导入弹窗（粘贴 CSV / 上传文件 → 预览 → 确认导入，自 AccountDetail 拆分）。
 */
import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

export interface ParsedBankRecord {
  date: string; amount: number; type: 'deposit' | 'withdraw';
  description: string; currency: string; balance?: number;
}

interface Props {
  open: boolean;
  accountId: number;
  onClose: () => void;
  /** 导入成功后刷新账户数据 */
  onImported: () => void;
}

const PLACEHOLDER = '粘贴银行日结单，支持多种格式：' + String.fromCharCode(10) + String.fromCharCode(10) +
  '标准 CSV 格式：' + String.fromCharCode(10) +
  '2026-08-05, 5000.00, 存入, 工资, CNY' + String.fromCharCode(10) +
  '2026-08-06, 200.00, 取出, 餐饮, CNY' + String.fromCharCode(10) + String.fromCharCode(10) +
  '常见银行格式（自动检测）：' + String.fromCharCode(10) +
  '交易日期, 摘要, 收支方向, 金额, 币种' + String.fromCharCode(10) +
  '2026-08-05, 工资入账, 收入, 5000.00, CNY' + String.fromCharCode(10) + String.fromCharCode(10) +
  '或收支分开格式：' + String.fromCharCode(10) +
  '日期, 摘要, 收入金额, 支出金额, 余额, 币种' + String.fromCharCode(10) +
  '2026-08-05, 工资, 5000.00, 0.00, 5000.00, CNY';

export function BankStatementImportModal({ open, accountId, onClose, onImported }: Props) {
  const [bankCsvText, setBankCsvText] = useState('');
  const [parsedBankRecords, setParsedBankRecords] = useState<ParsedBankRecord[] | null>(null);
  const [bankParseFormat, setBankParseFormat] = useState('');
  const [bankImportStatus, setBankImportStatus] = useState('');
  const [bankImporting, setBankImporting] = useState(false);
  const [bankFormats, setBankFormats] = useState<string[]>([]);
  const [selectedBankFormat, setSelectedBankFormat] = useState('');

  // Load bank formats when modal opens（同时重置状态，与原页面打开按钮行为一致）
  useEffect(() => {
    if (open) {
      setBankCsvText('');
      setParsedBankRecords(null);
      setBankImportStatus('');
      invoke<string[]>('bank:listFormats').then((f) => setBankFormats(f || []));
    }
  }, [open]);

  const doBankParse = async (text: string, format: string) => {
    if (!text.trim()) return;
    setBankImportStatus(format ? '正在使用「' + format + '」格式解析...' : '正在识别银行日结单格式...');
    setParsedBankRecords(null);
    try {
      const formatParam = format || undefined;
      const result = await invoke<{
        success: boolean; format: string; records: ParsedBankRecord[]; errors: string[];
      }>('bank:parseStatement', text, formatParam);
      if (result.success && result.records.length > 0) {
        setBankParseFormat(result.format);
        setParsedBankRecords(result.records);
        setBankImportStatus('✅ 识别为「' + result.format + '」，共 ' + result.records.length + ' 条记录，请预览确认后导入');
      } else {
        setBankImportStatus('❌ 无法识别格式：' + (result.errors || ['未知格式']).join('，'));
      }
    } catch (err: any) {
      setBankImportStatus('❌ 解析失败：' + err.message);
    }
  };

  const handleBankParse = async () => {
    await doBankParse(bankCsvText, selectedBankFormat);
  };

  const handleBankFormatChange = async (format: string) => {
    setSelectedBankFormat(format);
    if (bankCsvText.trim()) {
      await doBankParse(bankCsvText, format);
    }
  };

  const handleBankExcelUpload = async () => {
    setBankImportStatus('正在打开文件选择器...');
    setParsedBankRecords(null);
    try {
      const formatParam = selectedBankFormat || undefined;
      const result = await invoke<{
        canceled: boolean;
        fileName?: string;
        success?: boolean;
        format?: string;
        records?: ParsedBankRecord[];
        errors?: string[];
      }>('bank:importExcel', formatParam);

      if (result.canceled) { setBankImportStatus(''); return; }

      if (result.success && result.records && result.records.length > 0) {
        setBankParseFormat(result.format + ' · ' + result.fileName);
        setParsedBankRecords(result.records);
        setBankImportStatus('✅ 识别为「' + result.format + '」，共 ' + result.records.length + ' 条记录，请预览确认后导入');
      } else {
        setBankImportStatus('❌ 无法识别格式：' + (result.errors || ['未知格式']).join('，'));
      }
    } catch (err: any) {
      setBankImportStatus('❌ 读取文件失败：' + err.message);
    }
  };

  const handleBankImport = async () => {
    if (!parsedBankRecords || parsedBankRecords.length === 0) return;
    setBankImporting(true);
    setBankImportStatus('正在导入...');
    try {
      const result = await invoke<{ imported: number; errors: string[] }>(
        'bank:importParsed', parsedBankRecords, accountId
      );
      let msg = '✅ 成功导入 ' + result.imported + ' 条存取记录';
      if (result.errors.length > 0) {
        msg += '（' + result.errors.length + ' 条失败：' + result.errors.slice(0, 3).join('；') + '）';
      }
      setBankImportStatus(msg);
      setBankCsvText('');
      setParsedBankRecords(null);
      onImported();
    } catch (err: any) {
      setBankImportStatus('❌ 导入失败：' + err.message);
    }
    setBankImporting(false);
  };

  return (
    <Modal open={open} title="📥 导入银行日结单" onClose={onClose} width="700px">
      <div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
          粘贴 CSV 日结单，或直接上传文件（支持 CSV / Excel）。自动检测格式或手动选择银行格式。
        </p>

        <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, whiteSpace: 'nowrap' }}>银行格式：</label>
          <select
            value={selectedBankFormat}
            onChange={(e) => handleBankFormatChange(e.target.value)}
            style={{
              flex: 1, padding: '6px 12px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)',
              background: 'var(--color-bg-primary)', cursor: 'pointer',
            }}
          >
            <option value="">🔍 自动检测</option>
            {bankFormats.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {!parsedBankRecords && (
          <>
            <textarea
              className="form-input"
              value={bankCsvText}
              onChange={(e) => setBankCsvText(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={10}
              style={{ height: 'auto', fontFamily: 'var(--font-family-number)', fontSize: 'var(--font-size-xs)' }}
            />
            {bankImportStatus && (
              <div style={{
                marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm) var(--spacing-md)',
                background: bankImportStatus.startsWith('✅') ? '#F6FFED' : bankImportStatus.startsWith('❌') ? '#FFF2F0' : bankImportStatus.startsWith('正在') ? '#E6F7FF' : '#FFFBE6',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
              }}>
                {bankImportStatus}
              </div>
            )}
            <div className="form-actions" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <Button variant="secondary" onClick={onClose}>取消</Button>
                <Button variant="secondary" onClick={handleBankExcelUpload}>
                  📂 上传文件
                </Button>
              </div>
              <Button variant="primary" onClick={handleBankParse} disabled={!bankCsvText.trim()}>
                🔍 识别并解析
              </Button>
            </div>
          </>
        )}

        {parsedBankRecords && (
          <>
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: '#F6FFED', borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)',
            }}>
              已识别格式：<b>{bankParseFormat}</b>，共 <b>{parsedBankRecords.length}</b> 条记录
            </div>

            <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: 'var(--spacing-md)' }}>
              <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-secondary)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>日期</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>摘要</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>方向</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>金额</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>币种</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedBankRecords.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '6px 8px' }}>{r.date}</td>
                      <td style={{ padding: '6px 8px' }}>{r.description || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        <span style={{
                          color: r.type === 'deposit' ? 'var(--color-success)' : 'var(--color-danger)',
                          fontWeight: 500,
                        }}>
                          {r.type === 'deposit' ? '📥 存入' : '📤 取出'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>
                        {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{r.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bankImportStatus && (
              <div style={{
                marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                background: bankImportStatus.startsWith('✅') ? '#F6FFED' : bankImportStatus.startsWith('❌') ? '#FFF2F0' : '#E6F7FF',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
              }}>
                {bankImportStatus}
              </div>
            )}

            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setParsedBankRecords(null); setBankImportStatus(''); }}>
                ← 返回修改
              </Button>
              <Button variant="primary" onClick={handleBankImport} disabled={bankImporting}>
                {bankImporting ? '导入中...' : '✅ 确认导入 ' + parsedBankRecords.length + ' 条记录'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
