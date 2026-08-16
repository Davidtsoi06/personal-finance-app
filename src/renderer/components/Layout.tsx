import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { invoke } from '../hooks/useIpc';
import { useIdleLock } from '../hooks/useIdleLock';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/', label: '资产结构', icon: '📊' },
  { path: '/accounts', label: '资产管理', icon: '💳' },
  { path: '/investments', label: '投资管理', icon: '📈' },
  { path: '/ai', label: 'AI 助手', icon: '🤖' },
  { path: '/bookkeeping', label: '记账', icon: '📝' },
  { path: '/social', label: '债务债权', icon: '🤝' },
  { path: '/reports', label: '报表分析', icon: '📉' },
  { path: '/settings', label: '设置', icon: '⚙️' },
];

function Layout({ children }: LayoutProps) {
  const [appName, setAppName] = useState('个人理财');
  const [idleMinutes, setIdleMinutes] = useState<number | null>(null);
  // v1.8.0：数据更新提示条（汇率/价格刷新后显示）
  const [staleBanner, setStaleBanner] = useState<string | null>(null);
  // v1.8.0：侧栏版本号改为真实版本（原硬编码 v1.6.0 过时）
  const [appVersion, setAppVersion] = useState('');
  // v1.8.0：跳过安全设置后的温和提醒（每次启动一次，可忽略）
  const [securityReminder, setSecurityReminder] = useState(false);

  useEffect(() => {
    invoke<string>('settings:getAppName').then((name) => {
      if (name) setAppName(name);
    });
    // v1.7.0：启动密码锁——读取空闲锁定时长并启用自动锁
    invoke<{ enabled: boolean; idleMinutes: number; onboardingSkipped: boolean }>('auth:status')
      .then((s) => {
        if (s?.enabled) setIdleMinutes(s.idleMinutes);
        // v1.8.0：跳过安全设置 → 每次启动温和提醒一次（可忽略）
        if (s && !s.enabled && s.onboardingSkipped && !sessionStorage.getItem('pf_security_reminded')) {
          setSecurityReminder(true);
        }
      })
      .catch(() => {});

    // v1.8.0：数据更新提示条（汇率/价格刷新完成 → 显示 8 秒）
    const showStale = (msg: string) => {
      setStaleBanner(msg);
      window.setTimeout(() => setStaleBanner(null), 8000);
    };
    if (window.electronAPI?.onCurrencyUpdated) {
      window.electronAPI.onCurrencyUpdated(() => showStale('汇率已更新'));
    }
    if (window.electronAPI?.onPricesUpdated) {
      window.electronAPI.onPricesUpdated(() => showStale('行情价格已更新'));
    }
    invoke<string>('update:getVersion').then((v) => { if (v) setAppVersion(v); }).catch(() => {});
    return () => {
      window.electronAPI?.removeCurrencyUpdatedListener?.();
      window.electronAPI?.removePricesUpdatedListener?.();
    };
  }, []);

  useIdleLock(idleMinutes);

  return (
    <div className="layout">
      {/* 侧边导航栏 */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">{appName}</h1>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-item--active' : ''}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="version-text">{appVersion ? 'v' + appVersion : ''}</span>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="main-content">
        {securityReminder && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: '#EAF3FC', borderBottom: '1px solid #B7D4F0',
            padding: '6px 16px', fontSize: 'var(--font-size-sm)', color: '#2f5d8a',
          }}>
            <span>🔒 尚未设置启动密码，他人打开电脑即可查看你的财务数据</span>
            <button
              style={{
                background: 'var(--color-primary)', border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)',
                padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              }}
              onClick={() => { window.location.hash = '#/settings'; }}
            >
              前往设置
            </button>
            <button
              style={{ background: 'transparent', border: 'none', color: '#2f5d8a', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
              onClick={() => { sessionStorage.setItem('pf_security_reminded', '1'); setSecurityReminder(false); }}
            >
              暂不提醒
            </button>
          </div>
        )}
        {staleBanner && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: '#FFF7E6', borderBottom: '1px solid #FFE1A8',
            padding: '6px 16px', fontSize: 'var(--font-size-sm)', color: '#8a6d3b',
          }}>
            <span>🔄 {staleBanner}，部分页面数据可能已过期</span>
            <button
              style={{
                background: 'var(--color-primary)', border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)',
                padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              }}
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export default Layout;
