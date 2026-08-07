/**
 * ArchiveCard — Settings card for data archiving.
 * Configure archive folder, retention period, view pending months, and execute archive.
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';
import './ArchiveCard.css';

interface PendingMonth {
  month: string;
  monthLabel: string;
  transactionCount: number;
  ledgerCount: number;
  accountTxnCount: number;
}

interface ArchiveSettings {
  folderPath: string;
  retentionMonths: number;
  lastRun: string | null;
}

interface ArchiveResult {
  month: string;
  monthLabel: string;
  filePath: string;
  transactionsArchived: number;
  ledgersArchived: number;
  accountTxnsArchived: number;
  success: boolean;
  error?: string;
}

export function ArchiveCard() {
  const [settings, setSettings] = useState<ArchiveSettings | null>(null);
  const [pending, setPending] = useState<PendingMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [results, setResults] = useState<ArchiveResult[] | null>(null);

  const load = () => {
    Promise.all([
      invoke<ArchiveSettings>('archive:getSettings'),
      invoke<PendingMonth[]>('archive:getPendingMonths'),
    ])
      .then(([s, p]) => {
        setSettings(s);
        setPending(p || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSelectFolder = async () => {
    const result = await invoke<{ canceled: boolean; folderPath?: string }>('archive:setFolder');
    if (!result.canceled && result.folderPath) {
      setSettings(prev => prev ? { ...prev, folderPath: result.folderPath! } : null);
      setStatusMsg('归档文件夹已设置');
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  const handleRetentionChange = async (months: number) => {
    await invoke('archive:setRetentionMonths', months);
    setSettings(prev => prev ? { ...prev, retentionMonths: months } : null);
    // Reload pending months with new retention
    const p = await invoke<PendingMonth[]>('archive:getPendingMonths');
    setPending(p || []);
  };

  const handleArchive = async () => {
    if (pending.length === 0) return;
    if (!settings?.folderPath) {
      setStatusMsg('请先设置归档文件夹');
      setTimeout(() => setStatusMsg(null), 3000);
      return;
    }

    setArchiving(true);
    setStatusMsg('正在生成归档文件...');
    try {
      const months = pending.map(p => p.month);
      const r = await invoke<ArchiveResult[]>('archive:execute', months);
      setResults(r);
      const successCount = r.filter(x => x.success).length;
      setStatusMsg(`归档完成：${successCount}/${r.length} 个月成功`);
      // Reload
      load();
    } catch (err: any) {
      setStatusMsg(`归档失败：${err.message || err}`);
    }
    setArchiving(false);
  };

  if (loading) return null;

  const hasFolder = settings?.folderPath && settings.folderPath.length > 0;
  const cutoffDate = (() => {
    if (!settings) return '';
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - settings.retentionMonths + 1, 1);
    return `${cutoff.getFullYear()}年${cutoff.getMonth() + 1}月`;
  })();

  return (
    <Card title="📦 数据归档">
      <div className="archive-card">
        {/* Folder setting */}
        <div className="archive-card__section">
          <label className="archive-card__label">归档文件夹</label>
          <div className="archive-card__folder-row">
            <span className={`archive-card__folder-path ${!hasFolder ? 'archive-card__folder-path--empty' : ''}`}>
              {hasFolder ? settings!.folderPath : '未设置'}
            </span>
            <Button onClick={handleSelectFolder} size="sm">选择文件夹</Button>
          </div>
        </div>

        {/* Retention setting */}
        <div className="archive-card__section">
          <label className="archive-card__label">数据保留期限</label>
          <div className="archive-card__retention-row">
            <select
              className="archive-card__select"
              value={settings?.retentionMonths || 12}
              onChange={e => handleRetentionChange(parseInt(e.target.value))}
            >
              {[6, 12, 18, 24, 36].map(m => (
                <option key={m} value={m}>{m} 个月</option>
              ))}
            </select>
            <span className="archive-card__hint">
              当前保留范围：{cutoffDate} ~ 至今
            </span>
          </div>
        </div>

        {/* Pending months */}
        <div className="archive-card__section">
          <label className="archive-card__label">待归档数据</label>
          {pending.length === 0 ? (
            <div className="archive-card__empty">✅ 暂无待归档数据</div>
          ) : (
            <div className="archive-card__pending-list">
              {pending.map(p => (
                <div key={p.month} className="archive-card__pending-item">
                  <span className="archive-card__pending-month">📅 {p.monthLabel}</span>
                  <span className="archive-card__pending-counts">
                    {p.transactionCount > 0 && `${p.transactionCount} 笔交易`}
                    {p.ledgerCount > 0 && ` · ${p.ledgerCount} 条收支`}
                    {p.accountTxnCount > 0 && ` · ${p.accountTxnCount} 条存取`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action button */}
        {pending.length > 0 && (
          <div className="archive-card__actions">
            <Button
              onClick={handleArchive}
              disabled={archiving || !hasFolder}
            >
              {archiving ? '归档中...' : `📂 归档 ${pending.length} 个月数据 (生成 ${pending.length} 个 Excel)`}
            </Button>
            {!hasFolder && (
              <span className="archive-card__hint archive-card__hint--warn">
                ⚠️ 请先设置归档文件夹
              </span>
            )}
          </div>
        )}

        {/* Status message */}
        {statusMsg && (
          <div className="archive-card__status">{statusMsg}</div>
        )}

        {/* Archive results */}
        {results && results.length > 0 && (
          <div className="archive-card__results">
            {results.map(r => (
              <div key={r.month} className={`archive-card__result-item ${r.success ? 'archive-card__result-item--ok' : 'archive-card__result-item--fail'}`}>
                <span className="archive-card__result-month">{r.success ? '✅' : '❌'} {r.monthLabel}</span>
                <span className="archive-card__result-detail">
                  {r.success
                    ? `已归档 ${r.transactionsArchived} 笔交易 · ${r.ledgersArchived} 条收支 → ${r.filePath.split(/[\\/]/).pop()}`
                    : r.error}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Last run */}
        {settings?.lastRun && (
          <div className="archive-card__last-run">
            上次归档：{settings.lastRun}
          </div>
        )}
      </div>
    </Card>
  );
}
