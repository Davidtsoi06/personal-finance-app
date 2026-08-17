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
  // v1.8.1：完整数据包（跨设备迁移）与数据目录
  const [pkgStatus, setPkgStatus] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState('');
  const [loadingPath, setLoadingPath] = useState(false);

  const loadUserDataPath = () => {
    setLoadingPath(true);
    invoke<string>('settings:getUserDataPath')
      .then((p) => setUserDataPath(p || ''))
      .catch(() => {})
      .finally(() => setLoadingPath(false));
  };

  const handleExportPackage = async () => {
    setPkgStatus(null);
    try {
      const r = await invoke<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>('data:exportPackage');
      if (r.canceled) return;
      if (r.success) setPkgStatus(`✅ 数据包已导出：${r.filePath}（含数据库与加密密钥，可拷贝到新电脑一键导入）`);
      else setPkgStatus(`❌ 导出失败：${r.error}`);
    } catch (err: any) { setPkgStatus(`❌ 导出失败：${err.message}`); }
  };

  const handleImportPackage = async () => {
    setPkgStatus(null);
    try {
      const r = await invoke<{ success: boolean; canceled?: boolean; error?: string }>('data:importPackage');
      if (r.canceled) return;
      if (r.success) setPkgStatus('✅ 导入完成，应用即将重启...');
      else setPkgStatus(`❌ 导入失败：${r.error}`);
    } catch (err: any) { setPkgStatus(`❌ 导入失败：${err.message}`); }
  };

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
      const r = await invoke<{ success: boolean; totalImported?: number; totalSkipped?: number; error?: string }>('data:confirmImport', filePath);
      if (r.success) {
        const skippedNote = r.totalSkipped && r.totalSkipped > 0 ? `（${r.totalSkipped} 行数据不合法已跳过）` : '';
        setStatus(`✅ 导入成功！共恢复 ${r.totalImported} 条数据${skippedNote}。建议重启应用以刷新所有页面。`);
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
          将全部数据（账户、多币种余额、定存、持仓、交易、记账、保单等 21 张表）导出为一个 Excel 文件。
          换设备或重装系统后，可通过导入功能一键恢复所有数据。AI API Key 不随备份导出，恢复后需重新配置。
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

        <div style={{ borderTop: '1px dashed var(--color-border)', marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-md)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 4 }}>📦 完整数据包（推荐换电脑时使用）</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-sm)' }}>
            包含数据库与加密密钥的单文件（.pfbak），在新电脑安装本软件后「导入数据包」即可完整迁移，包括启动密码等全部设置。
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={handleExportPackage}>📦 导出数据包</Button>
            <Button variant="secondary" onClick={handleImportPackage}>📥 导入数据包</Button>
          </div>
          {pkgStatus && (
            <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm)', background: pkgStatus.startsWith('✅') ? '#F6FFED' : '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
              {pkgStatus}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px dashed var(--color-border)', marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-md)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 4 }}>☁️ 网盘同步（可选）</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-sm)' }}>
            可用 OneDrive / 坚果云等网盘同步下方数据目录实现自动备份。⚠️ 请勿在两台电脑同时打开本软件，否则可能产生数据冲突。
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={loadUserDataPath}>{loadingPath ? '读取中...' : '显示数据目录'}</Button>
            {userDataPath && (
              <>
                <code style={{ fontSize: 'var(--font-size-xs)', background: 'var(--color-bg-secondary)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{userDataPath}</code>
                <Button variant="secondary" size="sm" onClick={() => invoke('settings:openUserDataDir')}>打开目录</Button>
              </>
            )}
          </div>
        </div>
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
