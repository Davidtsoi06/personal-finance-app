import { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { invoke } from '../hooks/useIpc';
import { ArchiveCard } from '../components/cards/ArchiveCard';
import { AiConfigCard } from '../components/cards/AiConfigCard';
import { AlertConfigCard } from '../components/cards/AlertConfigCard';
import { DataBackupCard } from '../components/cards/DataBackupCard';

interface Currency {
  id: number; code: string; name: string; symbol: string;
  rate_to_base: number; is_base: number; updated_at: string;
}

interface VersionInfo {
  version: string;
  devMode: boolean;
  electron?: string;
  node?: string;
  platform?: string;
}

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

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export function Settings() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<'rates' | 'prices' | 'all' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // ── Version / Update state ──
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState('');

  // ── Custom format state ──
  const [customFormats, setCustomFormats] = useState<CustomFormat[]>([]);
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [formatName, setFormatName] = useState('');
  const [formatKeywords, setFormatKeywords] = useState('');
  const [formatHasHeader, setFormatHasHeader] = useState(true);
  const [formatColumns, setFormatColumns] = useState<{ field: string }[]>(
    Array.from({ length: 8 }, () => ({ field: '' }))
  );
  const [formatSaving, setFormatSaving] = useState(false);
  const [formatMsg, setFormatMsg] = useState<string | null>(null);

  // ── Bank format state ──
  const [bankFormats, setBankFormats] = useState<BankFormat[]>([]);
  const [showBankFormatModal, setShowBankFormatModal] = useState(false);
  const [bankFormatName, setBankFormatName] = useState('');
  const [bankFormatKeywords, setBankFormatKeywords] = useState('');
  const [bankFormatHasHeader, setBankFormatHasHeader] = useState(true);
  const [bankFormatColumns, setBankFormatColumns] = useState<{ field: string }[]>(
    Array.from({ length: 6 }, () => ({ field: '' }))
  );
  const [bankFormatSaving, setBankFormatSaving] = useState(false);
  const [bankFormatMsg, setBankFormatMsg] = useState<string | null>(null);

  // ── Budget state ──
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetNotifyAt, setBudgetNotifyAt] = useState('0.8');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetStatus, setBudgetStatus] = useState<string | null>(null);

  // ── Data clear state ──
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearLoading, setClearLoading] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const loadCurrencies = useCallback(() => {
    invoke<Currency[]>('currency:list')
      .then((d) => { setCurrencies(d || []); setLoading(false); });
  }, []);

  const loadCustomFormats = useCallback(() => {
    invoke<CustomFormat[]>('customFormat:list').then((d) => setCustomFormats(d || []));
  }, []);

  const loadBankFormats = useCallback(() => {
    invoke<BankFormat[]>('bankFormat:list').then((d) => setBankFormats(d || []));
  }, []);

  useEffect(() => { loadCurrencies(); loadCustomFormats(); loadBankFormats(); }, [loadCurrencies, loadCustomFormats, loadBankFormats]);

  // ── Load version info ──
  useEffect(() => {
    invoke<VersionInfo>('update:getVersion').then((v) => setVersionInfo(v));
  }, []);

  // ── Listen for update status events from main process ──
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    window.electronAPI.onUpdateStatus((data) => {
      switch (data.event) {
        case 'checking-for-update':
          setUpdatePhase('checking');
          break;
        case 'update-available':
          setUpdatePhase('available');
          setUpdateVersion(data.version || '');
          break;
        case 'update-not-available':
          setUpdatePhase('idle');
          setUpdateError('');
          break;
        case 'download-progress':
          setUpdatePhase('downloading');
          setDownloadPercent(data.percent || 0);
          break;
        case 'update-downloaded':
          setUpdatePhase('downloaded');
          setUpdateVersion(data.version || updateVersion);
          break;
        case 'error':
          setUpdatePhase('error');
          setUpdateError(data.message || '更新出错');
          break;
      }
    });
    return () => {
      window.electronAPI?.removeUpdateStatusListener?.();
    };
  }, [updateVersion]);

  const handleRefreshRates = async () => {
    setRefreshing('rates');
    setStatus('正在获取最新汇率...');
    try {
      const r = await invoke<{ success: boolean; updated: number; error?: string }>('data:refreshRates');
      if (r.success) { setStatus(`✅ 汇率更新成功，更新了 ${r.updated} 种货币`); loadCurrencies(); }
      else { setStatus(`❌ 汇率更新失败：${r.error}`); }
    } catch (err: any) { setStatus(`❌ 网络错误：${err.message}`); }
    setRefreshing(null);
  };

  const handleRefreshPrices = async () => {
    setRefreshing('prices');
    setStatus('正在获取最新价格...');
    try {
      const r = await invoke<{ success: boolean; total: number; updated: number; errors: string[] }>('data:refreshPrices');
      if (r.success) {
        setStatus(`✅ 价格更新成功：${r.updated}/${r.total} 个资产已更新`);
        if (r.errors.length > 0) setStatus((s) => s + ` (${r.errors.length} 个失败)`);
      }
    } catch (err: any) { setStatus(`❌ 网络错误：${err.message}`); }
    setRefreshing(null);
  };

  const handleRefreshAll = async () => {
    setRefreshing('all');
    setStatus('正在更新全部数据（汇率+价格）...');
    try {
      const r = await invoke<{ rates: { success: boolean; updated: number; error?: string }; prices: { success: boolean; total: number; updated: number; errors: string[] } }>('data:refreshAll');
      const parts: string[] = [];
      if (r.rates.success) parts.push(`汇率: ${r.rates.updated} 种`);
      if (r.prices.success) parts.push(`价格: ${r.prices.updated}/${r.prices.total} 个资产`);
      setStatus(`✅ 全部更新完成 — ${parts.join('，')}`);
      loadCurrencies();
    } catch (err: any) { setStatus(`❌ 更新失败：${err.message}`); }
    setRefreshing(null);
  };

  // ── Update handlers ──
  const handleCheckUpdate = async () => {
    setUpdatePhase('checking'); setUpdateError('');
    try {
      const r = await invoke<{ devMode?: boolean; updateAvailable: boolean; currentVersion?: string; latestVersion?: string; message?: string; error?: string }>('update:check');
      if (r.devMode) { setUpdatePhase('idle'); setUpdateError(r.message || '开发模式'); }
      else if (r.error) { setUpdatePhase('error'); setUpdateError(r.error); }
      else if (r.updateAvailable) { setUpdatePhase('available'); setUpdateVersion(r.latestVersion || ''); }
      else { setUpdatePhase('idle'); setUpdateError(''); }
    } catch (err: any) { setUpdatePhase('error'); setUpdateError(err.message || '检查更新失败'); }
  };

  const handleDownloadUpdate = async () => {
    setUpdatePhase('downloading'); setUpdateError('');
    try {
      const r = await invoke<{ success: boolean; devMode?: boolean; error?: string }>('update:download');
      if (r.devMode) { setUpdatePhase('idle'); setUpdateError('开发模式：无法下载更新'); }
      else if (!r.success) { setUpdatePhase('error'); setUpdateError(r.error || '下载失败'); }
    } catch (err: any) { setUpdatePhase('error'); setUpdateError(err.message || '下载失败'); }
  };

  const handleInstallUpdate = async () => { await invoke('update:install'); };

  // ── Budget handlers ──
  const loadBudget = useCallback(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    invoke<any[]>('budget:list', month).then((list) => {
      if (list && list.length > 0) {
        setBudgetAmount(String(list[0].amount));
        setBudgetNotifyAt(String(list[0].notify_at));
      }
    });
  }, []);
  useEffect(() => { loadBudget(); }, [loadBudget]);

  const handleSaveBudget = async () => {
    setBudgetSaving(true); setBudgetStatus(null);
    const amount = parseFloat(budgetAmount);
    if (!amount || amount <= 0) { setBudgetStatus('❌ 请输入有效的预算金额'); setBudgetSaving(false); return; }
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      // Check if budget exists for this month
      const list = await invoke<any[]>('budget:list', month);
      if (list && list.length > 0) {
        await invoke('budget:update', list[0].id, { amount, notify_at: parseFloat(budgetNotifyAt) });
      } else {
        await invoke('budget:create', { name: '月度总预算', amount, month, notify_at: parseFloat(budgetNotifyAt) });
      }
      setBudgetStatus('✅ 预算已保存，可在仪表盘查看进度');
    } catch (err: any) { setBudgetStatus(`❌ 保存失败：${err.message}`); }
    setBudgetSaving(false);
  };

  // ── Custom format handlers ──
  const handleOpenFormatModal = () => {
    setFormatName('');
    setFormatKeywords('');
    setFormatHasHeader(true);
    setFormatColumns(Array.from({ length: 8 }, () => ({ field: '' })));
    setFormatMsg(null);
    setShowFormatModal(true);
  };

  const handleSaveFormat = async () => {
    if (!formatName.trim()) { setFormatMsg('❌ 请输入格式名称'); return; }
    if (!formatKeywords.trim()) { setFormatMsg('❌ 请输入检测关键词'); return; }

    const mapping = formatColumns
      .map((col, i) => ({ position: i, field: col.field || 'ignore' }))
      .filter((col) => col.field !== 'ignore' || formatColumns.some((c, idx) => idx === col.position && c.field !== 'ignore'));

    // Filter to only meaningful columns
    const cleanMapping = formatColumns
      .map((col, i) => ({ position: i, field: col.field || 'ignore' }));

    // Check that we have at least date, quantity, and price
    const fields = cleanMapping.map((c) => c.field);
    if (!fields.includes('date') || !fields.includes('quantity') || !fields.includes('price')) {
      setFormatMsg('❌ 列映射必须包含：日期、成交数量、成交价格');
      return;
    }

    setFormatSaving(true); setFormatMsg(null);
    try {
      await invoke('customFormat:create', {
        name: formatName.trim(),
        keywords: formatKeywords.trim(),
        column_mapping: JSON.stringify(cleanMapping),
        has_header: formatHasHeader ? 1 : 0,
      });
      setShowFormatModal(false);
      loadCustomFormats();
      setFormatMsg('✅ 格式保存成功');
    } catch (err: any) {
      setFormatMsg(`❌ 保存失败：${err.message}`);
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
        return `第${c.position + 1}列→${opt?.label || c.field}`;
      }).join('，');
    } catch { return mapping; }
  };

  // ── Bank format handlers ──
  const handleOpenBankFormatModal = () => {
    setBankFormatName('');
    setBankFormatKeywords('');
    setBankFormatHasHeader(true);
    setBankFormatColumns(Array.from({ length: 6 }, () => ({ field: '' })));
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
      await invoke('bankFormat:create', {
        name: bankFormatName.trim(),
        keywords: bankFormatKeywords.trim(),
        column_mapping: JSON.stringify(cleanMapping),
        has_header: bankFormatHasHeader ? 1 : 0,
      });
      setShowBankFormatModal(false);
      loadBankFormats();
      setBankFormatMsg('✅ 格式保存成功');
    } catch (err: any) {
      setBankFormatMsg(`❌ 保存失败：${err.message}`);
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
        return `第${c.position + 1}列→${opt?.label || c.field}`;
      }).join('，');
    } catch { return mapping; }
  };

  const currencyColumns: Column<Currency>[] = [
    { key: 'code', title: '代码' },
    { key: 'name', title: '名称' },
    { key: 'symbol', title: '符号' },
    { key: 'rate_to_base', title: '汇率（对人民币）', align: 'right',
      render: (r) => r.is_base ? '—' : r.rate_to_base.toFixed(4) },
    { key: 'is_base', title: '本位币', render: (r) => r.is_base ? '✅ 本位币' : '' },
    { key: 'updated_at', title: '更新时间' },
  ];

  const formatColumns_: Column<CustomFormat>[] = [
    { key: 'name', title: '格式名称' },
    { key: 'keywords', title: '检测关键词' },
    { key: 'column_mapping', title: '列映射', render: (r) => (
      <span style={{ fontSize: 'var(--font-size-xs)' }}>{formatColumnMapPreview(r.column_mapping)}</span>
    )},
    { key: 'actions', title: '操作', render: (r) => (
      <Button variant="secondary" onClick={() => handleDeleteFormat(r.id)}>🗑 删除</Button>
    )},
  ];

  const bankFormatColumns_: Column<BankFormat>[] = [
    { key: 'name', title: '格式名称' },
    { key: 'keywords', title: '检测关键词' },
    { key: 'column_mapping', title: '列映射', render: (r) => (
      <span style={{ fontSize: 'var(--font-size-xs)' }}>{bankFormatColumnMapPreview(r.column_mapping)}</span>
    )},
    { key: 'actions', title: '操作', render: (r) => (
      <Button variant="secondary" onClick={() => handleDeleteBankFormat(r.id)}>🗑 删除</Button>
    )},
  ];

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">设置</h2>
        <p className="page-subtitle">货币汇率、数据源、数据管理</p>
      </div>

      {/* Data source refresh card */}
      <Card title="📡 数据源更新">
        <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleRefreshRates} disabled={refreshing !== null}>
            {refreshing === 'rates' ? '⏳ 更新中...' : '💱 更新汇率'}
          </Button>
          <Button variant="secondary" onClick={handleRefreshPrices} disabled={refreshing !== null}>
            {refreshing === 'prices' ? '⏳ 更新中...' : '📈 更新价格'}
          </Button>
          <Button variant="secondary" onClick={handleRefreshAll} disabled={refreshing !== null}>
            {refreshing === 'all' ? '⏳ 更新中...' : '🔄 全部更新'}
          </Button>
        </div>
        {status && (
          <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: status.startsWith('✅') ? '#F6FFED' : status.startsWith('❌') ? '#FFF2F0' : '#E6F7FF', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
            {status}
          </div>
        )}
        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          汇率每 6 小时自动更新 · 价格每 30 分钟自动更新
        </div>
      </Card>

      {/* Custom statement format card */}
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
            <Button variant="primary" onClick={handleOpenFormatModal}>＋ 添加自定义格式</Button>
            {formatMsg && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: formatMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatMsg}</span>
            )}
          </div>
        </Card>
      </div>

      {/* Bank statement format card */}
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
            <Button variant="primary" onClick={handleOpenBankFormatModal}>＋ 添加自定义格式</Button>
            {bankFormatMsg && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: bankFormatMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)' }}>{bankFormatMsg}</span>
            )}
          </div>
        </Card>
      </div>

      {/* Version update card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="🔄 版本更新">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <div style={{ padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--spacing-sm)' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>当前版本</div>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600', color: 'var(--color-primary)' }}>v{versionInfo?.version || '...'}</div>
                {versionInfo?.devMode && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: '#FAAD14', background: '#FFFBE6', padding: '2px 8px', borderRadius: 'var(--radius-sm)', marginLeft: 'var(--spacing-xs)' }}>🔧 开发模式</span>
                )}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                {versionInfo?.electron && <div>Electron {versionInfo.electron}</div>}
                {versionInfo?.node && <div>Node.js {versionInfo.node}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
              {updatePhase === 'idle' && (<Button variant="primary" onClick={handleCheckUpdate}>🔍 检查更新</Button>)}
              {updatePhase === 'checking' && (<Button variant="secondary" disabled>⏳ 正在检查...</Button>)}
              {updatePhase === 'available' && (<>
                <Button variant="primary" onClick={handleDownloadUpdate}>📥 下载更新 (v{updateVersion})</Button>
                <Button variant="secondary" onClick={() => setUpdatePhase('idle')}>暂不更新</Button>
              </>)}
              {updatePhase === 'downloading' && (<>
                <Button variant="secondary" disabled>⏳ 下载中 {downloadPercent}%</Button>
                <div style={{ flex: 1, minWidth: 200, height: 8, background: 'var(--color-bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${downloadPercent}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
              </>)}
              {updatePhase === 'downloaded' && (<Button variant="primary" onClick={handleInstallUpdate}>🔄 立即重启安装 (v{updateVersion})</Button>)}
              {updatePhase === 'error' && (<>
                <Button variant="primary" onClick={handleCheckUpdate}>🔄 重试</Button>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>❌ {updateError}</span>
              </>)}
            </div>
            {versionInfo?.devMode && (
              <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFFBE6', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: '#8C6D00', border: '1px solid #FFE58F' }}>
                💡 开发模式下无法检查更新。打包为 .exe 安装后，更新功能将自动生效。
                请先配置 <code>electron-builder.yml</code> 中的 GitHub 仓库信息，然后使用 <code>npm run release</code> 发布版本。
              </div>
            )}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="货币与汇率">
          <Table columns={currencyColumns} data={currencies} rowKey={(r) => r.id} />
        </Card>
      </div>

      {/* Data Backup Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <DataBackupCard />
      </div>

      {/* Archive Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <ArchiveCard />
      </div>

      {/* AI Config Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <AiConfigCard />
      </div>

      {/* Budget Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <Card title="💰 预算管理">
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
            设置月度预算后，仪表盘将显示消费进度和每日可用额度。超支时自动弹出提醒。
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
              <label className="form-label">预算金额 (¥)</label>
              <input
                className="form-input" type="number"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="如：10000"
              />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
              <label className="form-label">预警比例 (%)</label>
              <select className="form-select" value={budgetNotifyAt} onChange={(e) => setBudgetNotifyAt(e.target.value)}>
                <option value="0.6">60%</option>
                <option value="0.7">70%</option>
                <option value="0.8">80%（推荐）</option>
                <option value="0.9">90%</option>
                <option value="1.0">100%</option>
              </select>
            </div>
            <Button variant="primary" onClick={handleSaveBudget} disabled={budgetSaving}>
              {budgetSaving ? '⏳ 保存中...' : '💾 保存预算'}
            </Button>
          </div>
          {budgetStatus && (
            <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm)', background: '#F6FFED', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
              {budgetStatus}
            </div>
          )}
        </Card>
      </div>

      {/* Alert Config Card */}
      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <AlertConfigCard />
      </div>

      {/* ── Danger Zone ── */}
      <div style={{ marginTop: 'var(--spacing-xl)' }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--color-danger)' }}>危险操作</h3>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                清空所有数据将删除你的全部账户、持仓、交易记录、记账流水、预算、人情债等数据。
                AI 配置和系统分类不会被清除。此操作不可撤销！
              </p>
            </div>
          </div>
          <Button variant="danger" onClick={() => { setShowClearModal(true); setClearConfirmText(''); setClearResult(null); }}>
            🗑 清空所有数据
          </Button>
        </Card>
      </div>

      {/* ── Clear Data Confirmation Modal ── */}
      <Modal open={showClearModal} title="⚠️ 确认清空所有数据" onClose={() => setShowClearModal(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div style={{
            padding: 'var(--spacing-md)',
            background: '#FFF2F0',
            border: '1px solid #FFCCC7',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-danger)',
          }}>
            <strong>此操作不可撤销！</strong><br/>
            所有账户、持仓、交易记录、记账流水、预算、人情债将被永久删除。<br/>
            AI 配置和系统分类不会被清除。
          </div>
          <div>
            <label className="form-label">请输入「确认清空」以继续：</label>
            <input
              className="form-input"
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder="确认清空"
              autoFocus
            />
          </div>
          {clearResult && (
            <div style={{
              padding: 'var(--spacing-sm)',
              background: clearResult.startsWith('✅') ? '#F6FFED' : '#FFF2F0',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)',
            }}>
              {clearResult}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setShowClearModal(false)}>取消</Button>
            <Button
              variant="danger"
              disabled={clearConfirmText !== '确认清空' || clearLoading}
              onClick={async () => {
                setClearLoading(true);
                setClearResult(null);
                try {
                  const r = await invoke<{ success: boolean; deletedCount: number }>('data:clearAll');
                  setClearResult(`✅ 已清空 ${r.deletedCount} 条数据，应用已恢复为全新状态`);
                  setClearConfirmText('');
                  // Reload data on page
                  loadCurrencies();
                  loadCustomFormats();
                  loadBudget();
                  setTimeout(() => setShowClearModal(false), 2000);
                } catch (err: any) {
                  setClearResult(`❌ 清空失败：${err.message}`);
                }
                setClearLoading(false);
              }}
            >
              {clearLoading ? '⏳ 清空中...' : '确认清空'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Custom format config Modal ── */}
      <Modal open={showFormatModal} title="📐 添加自定义日结单格式" onClose={() => setShowFormatModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 500 }}>
            {/* Name + keywords */}
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

            {/* Has header toggle */}
            <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={formatHasHeader} onChange={(e) => setFormatHasHeader(e.target.checked)} />
              日结单第一行是表头（列名）
            </label>

            {/* Column mapping */}
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

      {/* ── Bank format config Modal ── */}
      <Modal open={showBankFormatModal} title="🏦 添加自定义银行日结单格式" onClose={() => setShowBankFormatModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 500 }}>
            {/* Name + keywords */}
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

            {/* Has header toggle */}
            <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={bankFormatHasHeader} onChange={(e) => setBankFormatHasHeader(e.target.checked)} />
              日结单第一行是表头（列名）
            </label>

            {/* Column mapping */}
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
