/**
 * UpdateCard — 版本信息与自动更新卡片（自 Settings.tsx 拆分）。
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface VersionInfo {
  version: string;
  devMode: boolean;
  electron?: string;
  node?: string;
  platform?: string;
}

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdateCard() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState('');

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

  return (
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
                <div style={{ width: downloadPercent + '%', height: '100%', background: 'var(--color-primary)', borderRadius: 4, transition: 'width 0.3s ease' }} />
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
  );
}
