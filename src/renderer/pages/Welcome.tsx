/**
 * Welcome — 首次使用引导（v1.7.2）。
 * 仅全新数据库首次启动显示：欢迎 → 推荐设置启动密码（恢复邮箱 + 官方邮箱测试 + 密码，可跳过）。
 */
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { invoke } from '../hooks/useIpc';

interface Props {
  onDone: () => void;
}

export function Welcome({ onDone }: Props) {
  const [step, setStep] = useState<'intro' | 'security'>('intro');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [testSent, setTestSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const finish = async () => {
    setBusy(true);
    try {
      await invoke('onboarding:complete');
      onDone();
    } catch (err: any) {
      setError(err?.message || '操作失败');
    }
    setBusy(false);
  };

  const handleSaveEmail = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:setRecoveryEmail', email);
      setNotice('✅ 恢复邮箱已保存');
    } catch (err: any) { setError(err?.message || '保存失败'); }
    setBusy(false);
  };

  const handleTestEmail = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:sendTestEmail');
      setTestSent(true);
      setNotice('✅ 测试邮件已发送（由官方邮箱发送），请到邮箱查收');
    } catch (err: any) { setError(err?.message || '发送失败'); }
    setBusy(false);
  };

  const handleEnable = async () => {
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    if (password !== confirm) { setError('两次输入的密码不一致'); return; }
    setBusy(true); setError('');
    try {
      await invoke('auth:enable', password);
      await finish();
    } catch (err: any) { setError(err?.message || '启用失败'); }
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #EAF3FC 0%, #F5F7FA 60%)', padding: 'var(--spacing-lg)',
    }}>
      <div style={{
        width: 480, maxWidth: '100%', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 32px rgba(75, 120, 180, 0.18)', padding: 'var(--spacing-xl)',
      }}>
        {step === 'intro' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 52 }}>💰</div>
            <h2 style={{ margin: '12px 0 4px', fontSize: 'var(--font-size-xl)' }}>欢迎使用个人理财投资软件</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}>
              统一管理你的现金、银行卡、股票、基金、黄金与加密货币，
              提供深度财务洞察、智能记账与 AI 投资分析。
            </p>
            <div style={{ marginTop: 'var(--spacing-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
              <Button variant="primary" onClick={() => setStep('security')}>🚀 开始使用</Button>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                下一步将引导你设置启动密码（推荐，可跳过）
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <h3 style={{ margin: 0 }}>🔒 设置启动密码（推荐）</h3>
            <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              打开软件时需要输入密码，防止他人查看你的财务数据。忘记密码时通过邮箱验证码找回——
              无需任何邮箱服务器配置，官方邮箱自动发送。
            </p>
            <div className="form-group">
              <label className="form-label">恢复邮箱（收验证码）</label>
              <input className="form-input" type="email" placeholder="如 xxx@qq.com" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-row">
              <Button variant="secondary" onClick={handleSaveEmail} disabled={busy}>保存邮箱</Button>
              <Button variant="secondary" onClick={handleTestEmail} disabled={busy}>发送测试邮件</Button>
            </div>
            {testSent && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">启动密码（至少 6 位）</label>
                    <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">确认密码</label>
                    <input className="form-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </div>
                </div>
                <Button variant="primary" onClick={handleEnable} disabled={busy}>✅ 启用密码保护并进入</Button>
              </div>
            )}
            {error && <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
            {notice && <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', background: '#F6FFED', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' }}>{notice}</div>}
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setStep('intro')}>← 返回</Button>
              <Button variant="secondary" onClick={finish} disabled={busy}>跳过，稍后再说</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}