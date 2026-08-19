/**
 * BrokerFormatCard — 券商日结单自定义格式管理卡片 + 配置弹窗（自 Settings.tsx 拆分）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Table, Column } from '../ui/Table';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';
import { AiFormatGeneratorModal } from '../ai/AiFormatGeneratorModal';

interface CustomFormat {
  id: number;
  name: string;
  keywords: string;
  column_mapping: string; // JSON: [{position: 0, field: "date"}, ...]
  has_header: number;
  created_at: string;
}

const FIELD_OPTIONS: { value: string; label: string }[] = [
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

const MAX_COLUMNS = 15;

interface Props {
  /** 外部数据清空等操作后递增，触发重新加载 */
  refreshKey?: number;
}

export function BrokerFormatCard({ refreshKey = 0 }: Props) {
  const [customFormats, setCustomFormats] = useState<CustomFormat[]>([]);
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [formatName, setFormatName] = useState('');
  const [formatKeywords, setFormatKeywords] = useState('');
  const [formatHasHeader, setFormatHasHeader] = useState(true);
  const [formatColumns, setFormatColumns] = useState<{ field: string }[]>(
    Array.from({ length: 8 }, () => ({ field: '' }))
  );
  const [editingCustomFormatId, setEditingCustomFormatId] = useState<number | null>(null);
  const [formatSaving, setFormatSaving] = useState(false);
  const [formatMsg, setFormatMsg] = useState<string | null>(null);
  // v1.10.0：AI 生成模板
  const [showAiModal, setShowAiModal] = useState(false);

  const loadCustomFormats = useCallback(() => {
    invoke<CustomFormat[]>('customFormat:list').then((d) => setCustomFormats(d || []));
  }, []);

  useEffect(() => { loadCustomFormats(); }, [loadCustomFormats, refreshKey]);

  const handleOpenFormatModal = (fmt?: CustomFormat) => {
    if (fmt) {
      setEditingCustomFormatId(fmt.id);
      setFormatName(fmt.name);
      setFormatKeywords(fmt.keywords);
      setFormatHasHeader(!!fmt.has_header);
      try {
        const cols: { position: number; field: string }[] = JSON.parse(fmt.column_mapping);
        const maxPos = Math.max(...cols.map(c => c.position), 7);
        const arr = Array.from({ length: maxPos + 1 }, () => ({ field: '' as string }));
        for (const c of cols) arr[c.position] = { field: c.field };
        setFormatColumns(arr);
      } catch { setFormatColumns(Array.from({ length: 8 }, () => ({ field: '' }))); }
    } else {
      setEditingCustomFormatId(null);
      setFormatName('');
      setFormatKeywords('');
      setFormatHasHeader(true);
      setFormatColumns(Array.from({ length: 8 }, () => ({ field: '' })));
    }
    setFormatMsg(null);
    setShowFormatModal(true);
  };

  const handleSaveFormat = async () => {
    if (!formatName.trim()) { setFormatMsg('❌ 请输入格式名称'); return; }
    if (!formatKeywords.trim()) { setFormatMsg('❌ 请输入检测关键词'); return; }

    const cleanMapping = formatColumns
      .map((col, i) => ({ position: i, field: col.field || 'ignore' }));

    const fields = cleanMapping.map((c) => c.field);
    if (!fields.includes('date') || !fields.includes('quantity') || !fields.includes('price')) {
      setFormatMsg('❌ 列映射必须包含：日期、成交数量、成交价格');
      return;
    }

    setFormatSaving(true); setFormatMsg(null);
    try {
      const data = {
        name: formatName.trim(),
        keywords: formatKeywords.trim(),
        column_mapping: JSON.stringify(cleanMapping),
        has_header: formatHasHeader ? 1 : 0,
      };
      if (editingCustomFormatId != null) {
        await invoke('customFormat:update', editingCustomFormatId, data);
      } else {
        await invoke('customFormat:create', data);
      }
      setShowFormatModal(false);
      loadCustomFormats();
      setFormatMsg(editingCustomFormatId != null ? '✅ 格式已更新' : '✅ 格式保存成功');
    } catch (err: any) {
      setFormatMsg('❌ 保存失败：' + err.message);
    }
    setFormatSaving(false);
  };

  const handleDeleteFormat = async (id: number) => {
    await invoke('customFormat:delete', id);
    loadCustomFormats();
  };

  const handleAddColumn = () => {
    if (formatColumns.length < MAX_COLUMNS) {
      setFormatColumns([...formatColumns, { field: '' }]);
    }
  };

  const handleRemoveColumn = (index: number) => {
    if (formatColumns.length > 1) {
      setFormatColumns(formatColumns.filter((_, i) => i !== index));
    }
  };

  const formatColumnMapPreview = (mapping: string) => {
    try {
      const cols: { position: number; field: string }[] = JSON.parse(mapping);
      return cols.filter((c) => c.field !== 'ignore').map((c) => {
        const opt = FIELD_OPTIONS.find((o) => o.value === c.field);
        return '第' + (c.position + 1) + '列→' + (opt?.label || c.field);
      }).join('，');
    } catch { return mapping; }
  };

  const formatColumns_: Column<CustomFormat>[] = [
    { key: 'name', title: '格式名称' },
    { key: 'keywords', title: '检测关键词' },
    { key: 'column_mapping', title: '列映射', render: (r) => (
      <span style={{ fontSize: 'var(--font-size-xs)' }}>{formatColumnMapPreview(r.column_mapping)}</span>
    )},
    { key: 'actions', title: '操作', render: (r) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <Button variant="secondary" onClick={() => handleOpenFormatModal(r)}>✏️ 编辑</Button>
        <Button variant="secondary" onClick={() => handleDeleteFormat(r.id)}>🗑 删除</Button>
      </div>
    )},
  ];

  return (
    <div style={{ marginTop: 'var(--spacing-lg)' }}>
      <Card title="📐 自定义日结单格式">
        <div style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
          在此添加你的券商日结单格式配置。每个格式定义名称、识别关键词和各列的字段映射。添加后导入日结单时可选择使用。
        </div>
        {customFormats.length > 0 ? (
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <Table columns={formatColumns_} data={customFormats} rowKey={(r) => r.id} />
          </div>
        ) : (
          <div className="card-placeholder" style={{ marginBottom: 'var(--spacing-md)' }}>暂无自定义格式</div>
        )}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
          <Button variant="primary" onClick={() => handleOpenFormatModal()}>＋ 添加自定义格式</Button>
          <Button variant="secondary" onClick={() => setShowAiModal(true)}>🤖 AI 生成模板</Button>
          {formatMsg && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: formatMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatMsg}</span>
          )}
        </div>
      </Card>

      {/* v1.10.0：AI 生成模板（与手动创建并存） */}
      <AiFormatGeneratorModal
        open={showAiModal}
        kind="broker"
        onClose={() => setShowAiModal(false)}
        onSaved={loadCustomFormats}
      />

      {/* Custom format config Modal */}
      <Modal open={showFormatModal} title={editingCustomFormatId ? '📐 编辑自定义日结单格式' : '📐 添加自定义日结单格式'} onClose={() => setShowFormatModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 500 }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 4 }}>券商 / 格式名称</label>
              <input value={formatName} onChange={(e) => setFormatName(e.target.value)}
                placeholder="例如：国信证券" style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 4 }}>检测关键词（逗号分隔）</label>
              <input value={formatKeywords} onChange={(e) => setFormatKeywords(e.target.value)}
                placeholder="例如：国信, 成交日期" style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                软件通过关键词自动识别日结单格式
              </div>
            </div>
            <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={formatHasHeader} onChange={(e) => setFormatHasHeader(e.target.checked)} />
              日结单第一行是表头（列名）
            </label>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                列映射（按 Excel/CSV 中从左到右的顺序填写）
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {formatColumns.map((col, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', minWidth: 50 }}>第{i + 1}列</span>
                    <select
                      value={col.field}
                      onChange={(e) => {
                        const next = [...formatColumns];
                        next[i] = { field: e.target.value };
                        setFormatColumns(next);
                      }}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)' }}
                    >
                      <option value="">— 请选择 —</option>
                      {FIELD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {formatColumns.length > 1 && (
                      <button onClick={() => handleRemoveColumn(i)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={handleAddColumn}
                style={{ marginTop: 8, border: '1px dashed var(--color-border)', background: 'none', padding: '6px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                ＋ 添加一列
              </button>
            </div>
            {formatMsg && (
              <div style={{ padding: 'var(--spacing-sm)', background: formatMsg.startsWith('✅') ? '#F6FFED' : '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
                {formatMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setShowFormatModal(false)}>取消</Button>
              <Button variant="primary" onClick={handleSaveFormat} disabled={formatSaving}>
                {formatSaving ? '⏳ 保存中...' : '💾 保存格式'}
              </Button>
            </div>
          </div>
        </Modal>
    </div>
  );
}
