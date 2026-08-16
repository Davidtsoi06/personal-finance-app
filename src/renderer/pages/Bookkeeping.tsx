import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Amount } from '../components/ui/Amount';
import { AddLedgerForm } from '../components/forms/AddLedgerForm';
import { invoke } from '../hooks/useIpc';

interface Ledger {
  id: number; type: string; amount: number; currency: string;
  category_id: number; date: string; description: string; category_name?: string;
}

export function Bookkeeping() {
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failures: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // v1.8.0：分页加载
  const [limit, setLimit] = useState(100);
  const load = useCallback(() => {
    invoke<Ledger[]>('ledger:list', { limit })
      .then((d) => { setLedgers(d || []); setLoading(false); });
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  // CSV import handler
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter((l) => l.trim());
    // Skip header line
    let imported = 0;
    const failures: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) { failures.push(`第 ${i + 1} 行：列数不足`); continue; }
      // Expected CSV format: date, type, amount, category, description
      const [date, type, amountStr, , description] = cols.map((c) => c.trim().replace(/^"|"$/g, ''));
      const amount = parseFloat(amountStr);
      if (isNaN(amount)) { failures.push(`第 ${i + 1} 行：金额无效（${amountStr}）`); continue; }
      const ledgerType = type === '收入' || type === 'income' ? 'income' : 'expense';
      try {
        await invoke('ledger:create', {
          type: ledgerType,
          amount: Math.abs(amount),
          category_id: ledgerType === 'income' ? 11 : 1, // default categories
          date: date || new Date().toISOString().slice(0, 10),
          description: description || 'CSV导入',
        });
        imported++;
      } catch (err: any) {
        failures.push(`第 ${i + 1} 行：${err?.message || '写入失败'}`);
      }
    }
    load();
    // v1.8.0：结果报告弹窗（成功/失败明细，不再静默跳过）
    setImportResult({ imported, failures });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const columns: Column<Ledger>[] = [
    { key: 'type', title: '类型', render: (r) => (
      <span style={{ color: r.type === 'income' ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 500 }}>
        {r.type === 'income' ? '收入' : '支出'}
      </span>
    )},
    { key: 'category_name', title: '分类', render: (r) => (r as any).category_name || '未分类' },
    { key: 'description', title: '描述' },
    { key: 'amount', title: '金额', align: 'right', render: (r) => (
      <Amount value={r.type === 'income' ? r.amount : -r.amount} currency={r.currency} colored />
    )},
    { key: 'date', title: '日期' },
  ];

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">记账</h2>
        <p className="page-subtitle">记录日常收支 · 共 {ledgers.length} 条</p>
        <Button variant="primary" onClick={() => setShowAdd(true)}>+ 记一笔</Button>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>📥 导入CSV</Button>
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvImport} />
      </div>

      <Card>
        <Table columns={columns} data={ledgers} rowKey={(r) => r.id} emptyText="暂无记账记录" />
        {ledgers.length >= limit && (
          <div style={{ marginTop: 'var(--spacing-sm)', textAlign: 'center' }}>
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 100)}>
              加载更多（当前 {ledgers.length} 条）
            </Button>
          </div>
        )}
      </Card>

      <Modal open={showAdd} title="记一笔" onClose={() => setShowAdd(false)}>
        <AddLedgerForm onClose={() => setShowAdd(false)} onSaved={load} />
      </Modal>

      {/* ── CSV 导入结果报告（v1.8.0：不再静默跳过） ── */}
      <Modal open={!!importResult} title="📥 CSV 导入结果" onClose={() => setImportResult(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 380, maxHeight: 420, overflowY: 'auto' }}>
          {importResult && (
            <>
              <p style={{ margin: 0, fontSize: 'var(--font-size-md)' }}>
                ✅ 成功导入 <strong>{importResult.imported}</strong> 条
                {importResult.failures.length > 0 && (
                  <span style={{ color: 'var(--color-danger)', marginLeft: 12 }}>
                    ⚠️ 失败 {importResult.failures.length} 条
                  </span>
                )}
              </p>
              {importResult.failures.length > 0 && (
                <div style={{ background: '#FFF2F0', borderRadius: 'var(--radius-sm)', padding: 'var(--spacing-sm) var(--spacing-md)', fontSize: 'var(--font-size-sm)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>失败明细：</div>
                  {importResult.failures.slice(0, 20).map((f, i) => (
                    <div key={i} style={{ color: 'var(--color-danger)' }}>{f}</div>
                  ))}
                  {importResult.failures.length > 20 && <div style={{ color: 'var(--color-text-muted)' }}>… 其余 {importResult.failures.length - 20} 条略</div>}
                </div>
              )}
              <div className="form-actions">
                <Button variant="primary" onClick={() => setImportResult(null)}>知道了</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
