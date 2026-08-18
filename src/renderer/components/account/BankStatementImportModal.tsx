/**
 * BankStatementImportModal — 银行日结单导入弹窗（粘贴 CSV / 上传文件 → 解析 → 智能配对预览 → 确认导入）。
 * v1.9.0：定期全自动体系——每行自动分类（转定期/定期回款/普通），按建议动作驱动定期生命周期：
 *   - fd_out → 自动创建定期（到期日待定）；已配对手动定期 → 跳过防重复扣款；
 *   - fd_in → 自动结算定期（利息=回款−本金，落账投资收入）；
 *   - 重复行指纹自动跳过；每行动作可在预览中修改。
 */
import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

export interface ParsedBankRecord {
  date: string; amount: number; type: 'deposit' | 'withdraw';
  description: string; currency: string; balance?: number;
  /** v1.9.0：fd_out / fd_in / normal */
  classification?: string;
  /** v1.9.0：行级动作 import / skip / create_fd / settle_fd */
  action?: string;
}

export interface BankSuggestion {
  index: number;
  classification: 'fd_out' | 'fd_in' | 'normal';
  duplicate: boolean;
  matchFdId: number | null;
  note: string;
  defaultAction: 'import' | 'skip' | 'create_fd' | 'settle_fd';
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

const CLASS_LABELS: Record<string, { label: string; color: string }> = {
  fd_out: { label: '🏦 转定期', color: '#FFF7E6' },
  fd_in: { label: '💰 定期回款', color: '#F6FFED' },
  normal: { label: '📄 普通', color: 'var(--color-bg-secondary)' },
};

function actionOptionsFor(rec: ParsedBankRecord, sug: BankSuggestion | undefined): { value: string; label: string }[] {
  if (sug?.duplicate) return [{ value: 'skip', label: '⏭ 跳过（重复行）' }];
  const opts: { value: string; label: string }[] = [
    { value: 'import', label: rec.type === 'withdraw' ? '📤 普通取出导入' : '📥 普通存入导入' },
  ];
  if (rec.type === 'withdraw') opts.push({ value: 'create_fd', label: '🏦 自动创建定期' });
  if (rec.type === 'deposit' && sug?.matchFdId) opts.push({ value: 'settle_fd', label: '💰 自动结算定期 #' + sug.matchFdId });
  opts.push({ value: 'skip', label: '⏭ 跳过不导入' });
  return opts;
}

export function BankStatementImportModal({ open, accountId, onClose, onImported }: Props) {
  const [bankCsvText, setBankCsvText] = useState('');
  const [parsedBankRecords, setParsedBankRecords] = useState<ParsedBankRecord[] | null>(null);
  const [bankParseFormat, setBankParseFormat] = useState('');
  const [bankImportStatus, setBankImportStatus] = useState('');
  const [bankImporting, setBankImporting] = useState(false);
  const [bankFormats, setBankFormats] = useState<string[]>([]);
  const [selectedBankFormat, setSelectedBankFormat] = useState('');
  // v1.9.0：智能建议与行级动作
  const [suggestions, setSuggestions] = useState<BankSuggestion[] | null>(null);
  const [rowActions, setRowActions] = useState<string[]>([]);

  // Load bank formats when modal opens（同时重置状态，与原页面打开按钮行为一致）
  useEffect(() => {
    if (open) {
      setBankCsvText('');
      setParsedBankRecords(null);
      setBankImportStatus('');
      setSuggestions(null);
      setRowActions([]);
      invoke<string[]>('bank:listFormats').then((f) => setBankFormats(f || []));
    }
  }, [open]);

  /** 解析后：拉取智能建议（分类/重复/配对）并填充默认动作 */
  const applySuggestions = async (records: ParsedBankRecord[]) => {
    try {
      const suggs = await invoke<BankSuggestion[]>('bank:suggestActions', records, accountId);
      setSuggestions(suggs || null);
      setRowActions((suggs || records.map((r) => r.action || 'import')).map((s) => s.defaultAction));
    } catch {
      setSuggestions(null);
      setRowActions(records.map(() => 'import'));
    }
  };

  const doBankParse = async (text: string, format: string) => {
    if (!text.trim()) return;
    setBankImportStatus(format ? '正在使用「' + format + '」格式解析...' : '正在识别银行日结单格式...');
    setParsedBankRecords(null);
    setSuggestions(null);
    try {
      const formatParam = format || undefined;
      const result = await invoke<{
        success: boolean; format: string; records: ParsedBankRecord[]; errors: string[];
      }>('bank:parseStatement', text, formatParam);
      if (result.success && result.records.length > 0) {
        setBankParseFormat(result.format);
        setParsedBankRecords(result.records);
        setBankImportStatus('✅ 识别为「' + result.format + '」，共 ' + result.records.length + ' 条记录，请预览确认后导入');
        await applySuggestions(result.records);
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
    setSuggestions(null);
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
        await applySuggestions(result.records);
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
      // v1.9.0：行级动作随记录提交
      const payload = parsedBankRecords.map((r, i) => ({ ...r, action: rowActions[i] || 'import' }));
      const result = await invoke<{
        imported: number; skipped: number; duplicates: number; errors: string[];
        createdFds: { id: number; amount: number; date: string }[];
        settledFds: { id: number; principal: number; interest: number }[];
      }>('bank:importParsed', payload, accountId);

      const parts: string[] = ['✅ 成功导入 ' + result.imported + ' 条存取记录'];
      if ((result.createdFds || []).length > 0) {
        parts.push('🏦 自动创建定期 ' + result.createdFds.map((f) => '#' + f.id + '（本金 ' + f.amount.toLocaleString() + '）').join('、'));
      }
      if ((result.settledFds || []).length > 0) {
        parts.push('💰 自动结算定期 ' + result.settledFds.map((f) => '#' + f.id + '（利息 ' + (f.interest >= 0 ? '+' : '') + f.interest.toFixed(2) + '）').join('、'));
      }
      if ((result.skipped || 0) > 0) parts.push('⏭ 按你的选择跳过 ' + result.skipped + ' 条');
      if ((result.duplicates || 0) > 0) parts.push('🔁 重复行自动跳过 ' + result.duplicates + ' 条');
      let msg = parts.join('；');
      if ((result.errors || []).length > 0) {
        msg += '（' + result.errors.length + ' 条失败：' + result.errors.slice(0, 3).join('；') + '）';
      }
      setBankImportStatus(msg);
      setBankCsvText('');
      setParsedBankRecords(null);
      setSuggestions(null);
      // 通知定期区块刷新（AccountDetail 页内）
      window.dispatchEvent(new CustomEvent('fixed-deposits:changed'));
      onImported();
    } catch (err: any) {
      setBankImportStatus('❌ 导入失败：' + err.message);
    }
    setBankImporting(false);
  };

  return (
    <Modal open={open} title="📥 导入银行日结单" onClose={onClose} width="860px">
      <div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
          粘贴 CSV 日结单，或直接上传文件（支持 CSV / Excel）。自动检测格式或手动选择银行格式。
          <br />v1.9.0：识别到「转定期 / 定期回款」会自动建议创建或结清定期，避免手动重复记录；可逐行修改动作。
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

            <div style={{ maxHeight: '340px', overflow: 'auto', marginBottom: 'var(--spacing-md)' }}>
              <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-secondary)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>日期</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>摘要</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>方向</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>金额</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>分类</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedBankRecords.map((r, i) => {
                    const sug = suggestions?.[i];
                    const cls = (sug?.classification || r.classification || 'normal') as string;
                    const clsMeta = CLASS_LABELS[cls] || CLASS_LABELS.normal;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.date}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <div>{r.description || '—'}</div>
                          {sug?.note && (
                            <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>💡 {sug.note}</div>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <span style={{
                            color: r.type === 'deposit' ? 'var(--color-success)' : 'var(--color-danger)',
                            fontWeight: 500,
                          }}>
                            {r.type === 'deposit' ? '📥 存入' : '📤 取出'}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)', whiteSpace: 'nowrap' }}>
                          {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span style={{ color: 'var(--color-text-muted)' }}> {r.currency}</span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{
                            background: clsMeta.color, borderRadius: 'var(--radius-sm)',
                            padding: '2px 8px', fontWeight: 500,
                          }}>{clsMeta.label}</span>
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <select
                            value={rowActions[i] || 'import'}
                            onChange={(e) => {
                              const next = [...rowActions];
                              next[i] = e.target.value;
                              setRowActions(next);
                            }}
                            style={{
                              padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)',
                              background: 'var(--color-bg-primary)', width: '100%', cursor: 'pointer',
                            }}
                          >
                            {actionOptionsFor(r, sug).map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
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
              <Button variant="secondary" onClick={() => { setParsedBankRecords(null); setSuggestions(null); setBankImportStatus(''); }}>
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
