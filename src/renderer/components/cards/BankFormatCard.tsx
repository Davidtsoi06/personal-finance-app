/**
 * BankFormatCard — 银行日结单自定义格式管理卡片 + 配置弹窗（自 Settings.tsx 拆分）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Table, Column } from '../ui/Table';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

interface BankFormat {
  id: number;
  name: string;
  keywords: string;
  column_mapping: string;
  has_header: number;
  created_at: string;
}

const BANK_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'amount', label: '金额' },
  { value: 'type', label: '收支方向' },
  { value: 'description', label: '摘要/描述' },
  { value: 'currency', label: '币种' },
  { value: 'balance', label: '余额' },
  { value: 'ignore', label: '忽略' },
];

const MAX_COLUMNS = 15;

interface Props {
  /** 外部数据清空等操作后递增，触发重新加载 */
  refreshKey?: number;
}

export function BankFormatCard({ refreshKey = 0 }: Props) {
  const [bankFormats, setBankFormats] = useState<BankFormat[]>([]);
  const [showBankFormatModal, setShowBankFormatModal] = useState(false);
  const [bankFormatName, setBankFormatName] = useState('');
  const [bankFormatKeywords, setBankFormatKeywords] = useState('');
  const [bankFormatHasHeader, setBankFormatHasHeader] = useState(true);
  const [bankFormatColumns, setBankFormatColumns] = useState<{ field: string }[]>(
    Array.from({ length: 6 }, () => ({ field: '' }))
  );
  const [editingBankFormatId, setEditingBankFormatId] = useState<number | null>(null);
  const [bankFormatSaving, setBankFormatSaving] = useState(false);
  const [bankFormatMsg, setBankFormatMsg] = useState<string | null>(null);

  const loadBankFormats = useCallback(() => {
    invoke<BankFormat[]>('bankFormat:list').then((d) => setBankFormats(d || []));
  }, []);

  useEffect(() => { loadBankFormats(); }, [loadBankFormats, refreshKey]);

  const handleOpenBankFormatModal = (fmt?: BankFormat) => {
    if (fmt) {
      setEditingBankFormatId(fmt.id);
      setBankFormatName(fmt.name);
      setBankFormatKeywords(fmt.keywords);
      setBankFormatHasHeader(!!fmt.has_header);
      try {
        const cols: { position: number; field: string }[] = JSON.parse(fmt.column_mapping);
        const maxPos = Math.max(...cols.map(c => c.position), 5);
        const arr = Array.from({ length: maxPos + 1 }, () => ({ field: '' as string }));
        for (const c of cols) arr[c.position] = { field: c.field };
        setBankFormatColumns(arr);
      } catch { setBankFormatColumns(Array.from({ length: 6 }, () => ({ field: '' }))); }
    } else {
      setEditingBankFormatId(null);
      setBankFormatName('');
      setBankFormatKeywords('');
      setBankFormatHasHeader(true);
      setBankFormatColumns(Array.from({ length: 6 }, () => ({ field: '' })));
    }
    setBankFormatMsg(null);
    setShowBankFormatModal(true);
  };

  const handleSaveBankFormat = async () => {
    if (!bankFormatName.trim()) { setBankFormatMsg('❌ 请输入格式名称'); return; }
    if (!bankFormatKeywords.trim()) { setBankFormatMsg('❌ 请输入检测关键词'); return; }

    const cleanMapping = bankFormatColumns
      .map((col, i) => ({ position: i, field: col.field || 'ignore' }));

    const fields = cleanMapping.map((c) => c.field);
    if (!fields.includes('date') || !fields.includes('amount')) {
      setBankFormatMsg('❌ 列映射必须包含：日期、金额');
      return;
    }

    setBankFormatSaving(true); setBankFormatMsg(null);
    try {
      const data = {
        name: bankFormatName.trim(),
        keywords: bankFormatKeywords.trim(),
        column_mapping: JSON.stringify(cleanMapping),
        has_header: bankFormatHasHeader ? 1 : 0,
      };
      if (editingBankFormatId != null) {
        await invoke('bankFormat:update', editingBankFormatId, data);
      } else {
        await invoke('bankFormat:create', data);
      }
      setShowBankFormatModal(false);
      loadBankFormats();
      setBankFormatMsg(editingBankFormatId != null ? '✅ 格式已更新' : '✅ 格式保存成功');
    } catch (err: any) {
      setBankFormatMsg('❌ 保存失败：' + err.message);
    }
    setBankFormatSaving(false);
  };

  const handleDeleteBankFormat = async (id: number) => {
    await invoke('bankFormat:delete', id);
    loadBankFormats();
  };

  const handleAddBankColumn = () => {
    if (bankFormatColumns.length < MAX_COLUMNS) {
      setBankFormatColumns([...bankFormatColumns, { field: '' }]);
    }
  };

  const handleRemoveBankColumn = (index: number) => {
    if (bankFormatColumns.length > 1) {
      setBankFormatColumns(bankFormatColumns.filter((_, i) => i !== index));
    }
  };

  const bankFormatColumnMapPreview = (mapping: string) => {
    try {
      const cols: { position: number; field: string }[] = JSON.parse(mapping);
      return cols.filter((c) => c.field !== 'ignore').map((c) => {
        const opt = BANK_FIELD_OPTIONS.find((o) => o.value === c.field);
        return '第' + (c.position + 1) + '列→' + (opt?.label || c.field);
      }).join('，');
    } catch { return mapping; }
  };

  const bankFormatColumns_: Column<BankFormat>[] = [
    { key: 'name', title: '格式名称' },
    { key: 'keywords', title: '检测关键词' },
    { key: 'column_mapping', title: '列映射', render: (r) => (
      <span style={{ fontSize: 'var(--font-size-xs)' }}>{bankFormatColumnMapPreview(r.column_mapping)}</span>
    )},
    { key: 'actions', title: '操作', render: (r) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <Button variant="secondary" onClick={() => handleOpenBankFormatModal(r)}>✏️ 编辑</Button>
        <Button variant="secondary" onClick={() => handleDeleteBankFormat(r.id)}>🗑 删除</Button>
      </div>
    )},
  ];

  return (
    <div style={{ marginTop: 'var(--spacing-lg)' }}>
      <Card title="🏦 自定义银行日结单格式">
        <div style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
          在此添加你的银行日结单格式配置。每个格式定义名称、识别关键词和各列的字段映射。添加后导入银行日结单时可选择使用。
        </div>
        {bankFormats.length > 0 ? (
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <Table columns={bankFormatColumns_} data={bankFormats} rowKey={(r) => r.id} />
          </div>
        ) : (
          <div className="card-placeholder" style={{ marginBottom: 'var(--spacing-md)' }}>暂无自定义格式</div>
        )}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
          <Button variant="primary" onClick={() => handleOpenBankFormatModal()}>＋ 添加自定义格式</Button>
          {bankFormatMsg && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: bankFormatMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)' }}>{bankFormatMsg}</span>
          )}
        </div>
      </Card>

      {/* Bank format config Modal */}
      <Modal open={showBankFormatModal} title={editingBankFormatId ? '🏦 编辑自定义银行日结单格式' : '🏦 添加自定义银行日结单格式'} onClose={() => setShowBankFormatModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 500 }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 4 }}>银行 / 格式名称</label>
              <input value={bankFormatName} onChange={(e) => setBankFormatName(e.target.value)}
                placeholder="例如：中国银行" style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 4 }}>检测关键词（逗号分隔）</label>
              <input value={bankFormatKeywords} onChange={(e) => setBankFormatKeywords(e.target.value)}
                placeholder="例如：中国银行, 交易日期" style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                软件通过关键词自动识别银行日结单格式
              </div>
            </div>
            <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={bankFormatHasHeader} onChange={(e) => setBankFormatHasHeader(e.target.checked)} />
              日结单第一行是表头（列名）
            </label>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                列映射（按 Excel/CSV 中从左到右的顺序填写）
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bankFormatColumns.map((col, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', minWidth: 50 }}>第{i + 1}列</span>
                    <select
                      value={col.field}
                      onChange={(e) => {
                        const next = [...bankFormatColumns];
                        next[i] = { field: e.target.value };
                        setBankFormatColumns(next);
                      }}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-primary)' }}
                    >
                      <option value="">— 请选择 —</option>
                      {BANK_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {bankFormatColumns.length > 1 && (
                      <button onClick={() => handleRemoveBankColumn(i)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={handleAddBankColumn}
                style={{ marginTop: 8, border: '1px dashed var(--color-border)', background: 'none', padding: '6px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                ＋ 添加一列
              </button>
            </div>
            {bankFormatMsg && (
              <div style={{ padding: 'var(--spacing-sm)', background: bankFormatMsg.startsWith('✅') ? '#F6FFED' : '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
                {bankFormatMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setShowBankFormatModal(false)}>取消</Button>
              <Button variant="primary" onClick={handleSaveBankFormat} disabled={bankFormatSaving}>
                {bankFormatSaving ? '⏳ 保存中...' : '💾 保存格式'}
              </Button>
            </div>
          </div>
        </Modal>
    </div>
  );
}
