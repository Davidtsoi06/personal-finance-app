import { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, Column } from '../components/ui/Table';
import { invoke } from '../hooks/useIpc';
import { ArchiveCard } from '../components/cards/ArchiveCard';
import { AiConfigCard } from '../components/cards/AiConfigCard';
import { AlertConfigCard } from '../components/cards/AlertConfigCard';
import { DataBackupCard } from '../components/cards/DataBackupCard';
import { BrokerFormatCard } from '../components/cards/BrokerFormatCard';
import { BankFormatCard } from '../components/cards/BankFormatCard';
import { UpdateCard } from '../components/cards/UpdateCard';
import { DangerZoneCard } from '../components/cards/DangerZoneCard';
import { SecurityCard } from '../components/cards/SecurityCard';

interface Currency {
  id: number; code: string; name: string; symbol: string;
  rate_to_base: number; is_base: number; updated_at: string;
}

export function Settings() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<'rates' | 'prices' | 'all' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [appName, setAppName] = useState('个人理财投资软件');
  const [appNameStatus, setAppNameStatus] = useState<string | null>(null);

  // ── Budget state ──
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetNotifyAt, setBudgetNotifyAt] = useState('0.8');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetStatus, setBudgetStatus] = useState<string | null>(null);

  // 数据清空后递增，驱动格式卡片重新加载
  const [dataVersion, setDataVersion] = useState(0);

  const loadCurrencies = useCallback(() => {
    invoke<Currency[]>('currency:list')
      .then((d) => { setCurrencies(d || []); setLoading(false); });
  }, []);

  useEffect(() => { loadCurrencies(); }, [loadCurrencies]);

  // ── Load app name ──
  useEffect(() => {
    invoke<string>('settings:getAppName').then((name) => {
      if (name) setAppName(name);
    });
  }, []);

  const handleSaveAppName = async () => {
    const input = document.getElementById('appNameInput') as HTMLInputElement;
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      setAppNameStatus('❌ 名称不能为空');
      return;
    }
    try {
      await invoke('settings:setAppName', name);
      setAppName(name);
      setAppNameStatus('✅ 应用名称已更新');
      setTimeout(() => setAppNameStatus(null), 3000);
    } catch (err: any) {
      setAppNameStatus('❌ 保存失败：' + err.message);
    }
  };

  const handleRefreshRates = async () => {
    setRefreshing('rates');
    setStatus('正在获取最新汇率...');
    try {
      const r = await invoke<{ success: boolean; updated: number; error?: string }>('data:refreshRates');
      if (r.success) { setStatus('✅ 汇率更新成功，更新了 ' + r.updated + ' 种货币'); loadCurrencies(); }
      else { setStatus('❌ 汇率更新失败：' + r.error); }
    } catch (err: any) { setStatus('❌ 网络错误：' + err.message); }
    setRefreshing(null);
  };

  const handleRefreshPrices = async () => {
    setRefreshing('prices');
    setStatus('正在获取最新价格...');
    try {
      const r = await invoke<{ success: boolean; total: number; updated: number; errors: string[] }>('data:refreshPrices');
      if (r.success) {
        setStatus('✅ 价格更新成功：' + r.updated + '/' + r.total + ' 个资产已更新');
        if (r.errors.length > 0) setStatus((s) => s + ' (' + r.errors.length + ' 个失败)');
      }
    } catch (err: any) { setStatus('❌ 网络错误：' + err.message); }
    setRefreshing(null);
  };

  const handleRefreshAll = async () => {
    setRefreshing('all');
    setStatus('正在更新全部数据（汇率+价格）...');
    try {
      const r = await invoke<{ rates: { success: boolean; updated: number; error?: string }; prices: { success: boolean; total: number; updated: number; errors: string[] } }>('data:refreshAll');
      const parts: string[] = [];
      if (r.rates.success) parts.push('汇率: ' + r.rates.updated + ' 种');
      if (r.prices.success) parts.push('价格: ' + r.prices.updated + '/' + r.prices.total + ' 个资产');
      setStatus('✅ 全部更新完成 — ' + parts.join('，'));
      loadCurrencies();
    } catch (err: any) { setStatus('❌ 更新失败：' + err.message); }
    setRefreshing(null);
  };

  // ── Budget handlers ──
  const loadBudget = useCallback(() => {
    const now = new Date();
    const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
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
      const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      // Check if budget exists for this month
      const list = await invoke<any[]>('budget:list', month);
      if (list && list.length > 0) {
        await invoke('budget:update', list[0].id, { amount, notify_at: parseFloat(budgetNotifyAt) });
      } else {
        await invoke('budget:create', { name: '月度总预算', amount, month, notify_at: parseFloat(budgetNotifyAt) });
      }
      setBudgetStatus('✅ 预算已保存，可在仪表盘查看进度');
    } catch (err: any) { setBudgetStatus('❌ 保存失败：' + err.message); }
    setBudgetSaving(false);
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

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">设置</h2>
        <p className="page-subtitle">货币汇率、数据源、数据管理</p>
      </div>

      {/* App name card */}
      <Card title="🔧 应用名称">
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">软件显示名称</label>
            <input className="form-input" id="appNameInput" defaultValue={appName} placeholder="个人理财投资软件" />
          </div>
          <Button variant="primary" onClick={handleSaveAppName}>保存</Button>
        </div>
        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          修改后立即生效。安装包名称在打包时固定，此处仅修改窗口标题和侧边栏显示名称。
        </div>
        {appNameStatus && (
          <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-xs) var(--spacing-md)', background: appNameStatus.startsWith('✅') ? '#F6FFED' : '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
            {appNameStatus}
          </div>
        )}
      </Card>

      {/* Data source refresh card */}
      <SecurityCard />

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

      {/* Broker custom statement format card */}
      <BrokerFormatCard refreshKey={dataVersion} />

      {/* Bank statement format card */}
      <BankFormatCard refreshKey={dataVersion} />

      {/* Version update card */}
      <UpdateCard />

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
      <DangerZoneCard
        onDataCleared={() => {
          loadCurrencies();
          loadBudget();
          setDataVersion((v) => v + 1); // 触发格式卡片重新加载
        }}
      />
    </div>
  );
}
