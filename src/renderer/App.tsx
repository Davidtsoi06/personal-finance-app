import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { AccountDetail } from './pages/AccountDetail';
import { Investments } from './pages/Investments';
import { HoldingsDetail } from './pages/HoldingsDetail';
import { Bookkeeping } from './pages/Bookkeeping';
import { SocialObligations } from './pages/SocialObligations';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { AIAssistant } from './pages/AIAssistant';

function App() {
  return (
    <ErrorBoundary>
      <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:id" element={<AccountDetail />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/investments/:id" element={<HoldingsDetail />} />
        <Route path="/ai" element={<AIAssistant />} />
        <Route path="/bookkeeping" element={<Bookkeeping />} />
        <Route path="/social" element={<SocialObligations />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
    </ErrorBoundary>
  );
}

export default App;
