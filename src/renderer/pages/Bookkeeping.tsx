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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    invoke<Ledger[]>('ledger:list', { limit: 100 })
      .then((d) => { setLedgers(d || []); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // CSV import handler
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter((l) => l.trim());
    // Skip header line
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) continue;
      // Expected CSV format: date, type, amount, category, description
      const [date, type, amountStr, , description] = cols.map((c) => c.trim().replace(/^"|"$/g, ''));
      const amount = parseFloat(amountStr);
      if (isNaN(amount)) continue;
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
      } catch { /* skip errored rows */ }
    }
    load();
    alert(`成功导入 ${imported} 条记录`);
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
      </Card>

      <Modal open={showAdd} title="记一笔" onClose={() => setShowAdd(false)}>
        <AddLedgerForm onClose={() => setShowAdd(false)} onSaved={load} />
      </Modal>
    </div>
  );
}
