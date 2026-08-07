/**
 * DataBackupCard — Settings card for one-click data export and import restore.
 */
import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

export function DataBackupCard() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<{ sheet: string; count: number }[]>([]);
  const [filePath, setFilePath] = useState('');
  const [confirming, setConfirming] = useState(false);

  const handleExport = async () => {
    setExporting(true); setStatus(null);
    try {
      const r = await invoke<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>('data:exportAll');
      if (r.canceled) { setStatus(null); }
      else if (r.success) { setStatus(`✅ 备份成功！已保存到：${r.filePath}`); }
      else { setStatus(`❌ 导出失败：${r.error}`); }
    } catch (err: any) { setStatus(`❌ 导出失败：${err.message}`); }
    setExporting(false);
  };

  const handleImport = async () => {
    setImporting(true); setStatus(null);
    try {
      const r = await invoke<{ success: boolean; canceled?: boolean; preview?: { sheet: string; count: number }[]; filePath?: string; error?: string }>('data:importAll');
      if (r.canceled) { setStatus(null); }
      else if (r.success && r.preview && r.filePath) {
        setPreview(r.preview);
        setFilePath(r.filePath);
        setShowPreview(true);
      } else { setStatus(`❌ 导入失败：${r.error || '未知错误'}`); }
    } catch (err: any) { setStatus(`❌ 导入失败：${err.message}`); }
    setImporting(false);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const r = await invoke<{ success: boolean; totalImported?: number; error?: string }>('data:confirmImport', filePath);
      if (r.success) {
        setStatus(`✅ 导入成功！共恢复 ${r.totalImported} 条数据。建议重启应用以刷新所有页面。`);
      } else {
        setStatus(`❌ 导入失败：${r.error}`);
      }
    } catch (err: any) { setStatus(`❌ 导入失败：${err.message}`); }
    setConfirming(false);
    setShowPreview(false);
    setFilePath('');
  };

  return (
    <>
      <Card title="📤 数据备份">
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
          将全部数据（账户、持仓、交易、记账等 14 张表）导出为一个 Excel 文件。
          换设备或重装系统后，可通过导入功能一键恢复所有数据。
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? '⏳ 导出中...' : '📤 一键备份'}
          </Button>
          <Button variant="secondary" onClick={handleImport} disabled={importing}>
            {importing ? '⏳ 导入中...' : '📥 一键恢复'}
          </Button>
        </div>
        {status && (
          <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm)', background: status.startsWith('✅') ? '#F6FFED' : status.startsWith('❌') ? '#FFF2F0' : '#E6F7FF', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
            {status}
          </div>
        )}
      </Card>

      {/* Import preview modal */}
      <Modal open={showPreview} title="📥 数据恢复预览" onClose={() => { setShowPreview(false); setFilePath(''); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', minWidth: 400 }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            备份文件包含以下数据：
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {preview.map((p) => (
                <tr key={p.sheet}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{p.sheet}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>{p.count} 条</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 'var(--spacing-sm)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            ⚠️ 导入将覆盖当前全部数据！此操作不可撤销。建议先导出一份备份。
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setShowPreview(false); setFilePath(''); }}>取消</Button>
            <Button variant="danger" onClick={handleConfirm} disabled={confirming}>
              {confirming ? '⏳ 导入中...' : '确认导入'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
