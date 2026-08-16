import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LockScreen } from './pages/LockScreen';

// ── 路由级代码分割：每个页面独立 chunk，首屏只加载当前路由（修复单包 1.5MB 告警）──
// 页面为命名导出，lazy 需要 default → .then 适配
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./pages/AccountDetail').then((m) => ({ default: m.AccountDetail })));
const WalletFlow = lazy(() => import('./pages/WalletFlow').then((m) => ({ default: m.WalletFlow })));
const Insurance = lazy(() => import('./pages/Insurance').then((m) => ({ default: m.Insurance })));
const Investments = lazy(() => import('./pages/Investments').then((m) => ({ default: m.Investments })));
const HoldingsDetail = lazy(() => import('./pages/HoldingsDetail').then((m) => ({ default: m.HoldingsDetail })));
const AIAssistant = lazy(() => import('./pages/AIAssistant').then((m) => ({ default: m.AIAssistant })));
const Bookkeeping = lazy(() => import('./pages/Bookkeeping').then((m) => ({ default: m.Bookkeeping })));
const SocialObligations = lazy(() => import('./pages/SocialObligations').then((m) => ({ default: m.SocialObligations })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

/** 懒加载过渡：保持布局稳定，切换时短暂显示加载态 */
function PageFallback() {
  return (
    <div className="page-loading" style={{ padding: 'var(--spacing-xxl)' }}>
      页面加载中...
    </div>
  );
}

function App() {
  // 锁屏窗口（#/lock）独立渲染：不经 Layout、不加载业务数据（v1.7.0）
  if (window.location.hash.startsWith('#/lock')) {
    return <LockScreen />;
  }

  return (
    <ErrorBoundary>
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route path="/wallet/:type" element={<WalletFlow />} />
            <Route path="/insurance" element={<Insurance />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="/investments/:id" element={<HoldingsDetail />} />
            <Route path="/ai" element={<AIAssistant />} />
            <Route path="/bookkeeping" element={<Bookkeeping />} />
            <Route path="/social" element={<SocialObligations />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Suspense>
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
