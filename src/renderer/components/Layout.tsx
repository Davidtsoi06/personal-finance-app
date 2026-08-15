import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { invoke } from '../hooks/useIpc';
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
  { path: '/social', label: '人情债', icon: '🤝' },
  { path: '/reports', label: '报表分析', icon: '📉' },
  { path: '/settings', label: '设置', icon: '⚙️' },
];

function Layout({ children }: LayoutProps) {
  const [appName, setAppName] = useState('个人理财');

  useEffect(() => {
    invoke<string>('settings:getAppName').then((name) => {
      if (name) setAppName(name);
    });
  }, []);

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
          <span className="version-text">v1.5.9</span>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="main-content">{children}</main>
    </div>
  );
}

export default Layout;
