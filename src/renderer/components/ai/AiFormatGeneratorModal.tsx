/**
 * AiFormatGeneratorModal — AI 生成日结单模板（v1.10.0）。
 * 流程：粘贴样例 → AI 生成列映射 → 示例渲染核对（前 3 行按映射抽取值）→ 可编辑微调 → 确认保存。
 * 手动创建模板入口保持不变（两种方式并存）。模板名称建议含银行/券商名以确认归属。
 */
import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

export interface GeneratedFormat {
  name: string;
  keywords: string[];
  hasHeader: boolean;
  columns: { position: number; field: string }[];
}

interface Props {
  open: boolean;
  kind: 'bank' | 'broker';
  initialSample?: string;
  onClose: () => void;
  /** 保存成功后回调（刷新格式列表 / 更新下拉） */
  onSaved?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  date: '日期', amount: '金额', type: '收支方向',
  description: '摘要/描述', currency: '币种', balance: '余额', ignore: '忽略',
  code: '证券代码', name: '证券名称', quantity: '成交数量',
  price: '成交价格', net_amount: '发生金额', fee: '手续费',
};

const BANK_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'income', label: '收入金额' },
  { value: 'expense', label: '支出金额' },
  { value: 'amount', label: '金额（单列带符号）' },
  { value: 'type', label: '收支方向' },
  { value: 'description', label: '摘要/描述' },
  { value: 'currency', label: '币种' },
  { value: 'balance', label: '余额' },
  { value: 'ignore', label: '忽略' },
];

const BROKER_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'code', label: '证券代码' },
  { value: 'name', label: '证券名称' },
  { value: 'type', label: '业务名称' },
  { value: 'quantity', label: '成交数量' },
  { value: 'price', label: '成交价格' },
  { value: 'amount', label: '成交金额' },
  { value: 'net_amount', label: '发生金额' },
  { value: 'fee', label: '手续费' },
  { value: 'currency', label: '币种' },
  { value: 'ignore', label: '忽略' },
];

/** 按列映射渲染样例前 3 行，供用户核对 AI 识别是否正确 */
function renderSamplePreview(sample: string, columns: { position: number; field: string }[], hasHeader: boolean): string[][] {
  const lines = sample.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const cols = [...columns].sort((a, b) => a.position - b.position);
  return dataLines.slice(0, 3).map((line) => {
    const parts = line.split(delimiter).map((p) => p.trim().replace(/^"|"$/g, ''));
    return cols.map((c) => (c.field === 'ignore' ? '—' : (parts[c.position] ?? '—')));
  });
}

export function AiFormatGeneratorModal({ open, kind, initialSample = '', onClose, onSaved }: Props) {
  const [sample, setSample] = useState(initialSample);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<GeneratedFormat | null>(null);
  // 可编辑字段
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [columns, setColumns] = useState<{ position: number; field: string }[]>([]);

  const reset = () => {
    setSample(initialSample);
    setError('');
    setResult(null);
    setGenerating(false);
    setSaving(false);
  };

  // v1.10.1：上传 Excel/CSV 文件作为样例（主进程读取前 30 行）
  const handleUploadFile = async () => {
    setUploading(true);
    setError('');
    try {
      const r = await invoke<{ canceled?: boolean; fileName?: string; sampleText?: string; error?: string }>('ai:readSampleFile');
      if (r.canceled) return;
      if (r.error) { setError(r.error); return; }
      if (r.sampleText) {
        setSample(r.sampleText);
        setUploadedName(r.fileName || '');
      }
    } catch (err: any) {
      setError(err.message || '读取文件失败');
    }
    setUploading(false);
  };

  const handleGenerate = async () => {
    if (!sample.trim()) { setError('请先粘贴日结单样例文本'); return; }
    setGenerating(true);
    setError('');
    try {
      const r = await invoke<{ success: boolean; format?: GeneratedFormat; error?: string }>('ai:generateFormat', sample, kind);
      if (!r.success || !r.format) {
        setError(r.error || 'AI 生成失败，请重试');
        return;
      }
      setResult(r.format);
      setName(r.format.name);
      setKeywords(r.format.keywords.join('，'));
      setHasHeader(r.format.hasHeader);
      setColumns([...r.format.columns]);
    } catch (err: any) {
      setError(err.message || 'AI 生成失败，请重试');
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('请填写模板名称（建议含银行/券商名称以确认归属）'); return; }
    const validCols = columns.filter((c) => c.field !== 'ignore');
    if (validCols.length === 0) { setError('至少保留一个有效列映射'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        keywords: keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean).join(','),
        column_mapping: JSON.stringify(validCols.map((c) => ({ position: c.position, field: c.field }))),
        has_header: hasHeader ? 1 : 0,
      };
      if (kind === 'bank') await invoke('bankFormat:create', payload);
      else await invoke('customFormat:create', payload);
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
    setSaving(false);
  };

  const previewRows = result ? renderSamplePreview(sample, columns, hasHeader) : [];
  const previewCols = result ? [...columns].sort((a, b) => a.position - b.position) : [];
  const fieldOptions = kind === 'bank' ? BANK_FIELD_OPTIONS : BROKER_FIELD_OPTIONS;

  return (
    <Modal open={open} title={kind === 'bank' ? '🤖 AI 生成银行日结单模板' : '🤖 AI 生成券商日结单模板'} onClose={onClose} width="760px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          粘贴日结单样例（含表头更佳）或<b>直接上传 Excel / CSV 文件</b>，AI 自动识别列格式生成模板。
          <b style={{ color: 'var(--color-warning, #E6A23C)' }}>样例前 30 行将发送给 AI 服务商用于识别</b>，
          生成后可核对示例、手动微调再保存。手动创建模板入口保持不变。
        </p>

        {!result && (
          <>
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
              <Button variant="secondary" onClick={handleUploadFile} disabled={uploading}>
                {uploading ? '⏳ 读取中...' : '📂 上传 Excel/CSV 文件'}
              </Button>
              {uploadedName && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  已读取：{uploadedName}（前 30 行填入，可继续编辑）
                </span>
              )}
            </div>
            <textarea
              className="form-input"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder={'粘贴日结单样例文本，或上传文件后自动填入，如：\n交易日期, 摘要, 收支方向, 金额, 币种\n2026-08-05, 工资入账, 收入, 5000.00, CNY'}
              rows={8}
              style={{ height: 'auto', fontFamily: 'var(--font-family-number)', fontSize: 'var(--font-size-xs)' }}
            />
            <div className="form-actions">
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button variant="primary" onClick={handleGenerate} disabled={generating}>
                {generating ? '⏳ AI 分析中...' : '🤖 AI 生成模板'}
              </Button>
            </div>
          </>
        )}

        {result && (
          <>
            {/* 模板信息编辑 */}
            <div className="form-group">
              <label className="form-label">模板名称（建议含银行/券商名，导入时以此确认归属）*</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：招商银行-个人流水" />
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">特征关键词（逗号分隔）</label>
                <input className="form-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </div>
              <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--spacing-md)' }}>
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                首行为表头
              </label>
            </div>

            {/* 列映射编辑 */}
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>
                列映射（可修改）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
                {columns.map((c, i) => (
                  <div key={c.position} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', width: 60 }}>第 {c.position + 1} 列</span>
                    <select
                      value={c.field}
                      onChange={(e) => {
                        const next = [...columns];
                        next[i] = { ...c, field: e.target.value };
                        setColumns(next);
                      }}
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', background: 'var(--color-bg-primary)' }}
                    >
                      {fieldOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <Button variant="secondary" size="sm" onClick={() => setColumns(columns.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                ))}
                {columns.length < 15 && (
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => setColumns([...columns, { position: Math.max(0, ...columns.map((c) => c.position)) + 1, field: 'ignore' }])}
                  >+ 添加列</Button>
                )}
              </div>
            </div>

            {/* 示例核对（用样例前 3 行按映射抽取值） */}
            {previewRows.length > 0 && (
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>
                  📄 示例核对（样例前 3 行按此映射解析的结果）
                </div>
                <div style={{ maxHeight: 160, overflow: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)', position: 'sticky', top: 0 }}>
                        {previewCols.map((c) => (
                          <th key={c.position} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                            {FIELD_LABELS[c.field] || c.field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ padding: '4px 8px' }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
                {error}
              </div>
            )}

            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setResult(null); setError(''); }}>← 换样例重新生成</Button>
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '✅ 确认保存模板'}
              </Button>
            </div>
          </>
        )}

        {error && !result && (
          <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
