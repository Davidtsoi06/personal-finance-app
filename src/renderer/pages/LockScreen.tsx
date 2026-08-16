/**
 * LockScreen — 锁屏页（v1.7.0）。锁屏窗口经最小权限 preload 加载（#/lock）。
 * 流程：输入密码解锁 / 忘记密码 → 邮箱验证码 → 重设密码。
 */
import { useState, useEffect } from 'react';
import { invoke } from '../hooks/useIpc';
import { Button } from '../components/ui/Button';

type Phase = 'login' | 'forgot-email' | 'forgot-code' | 'forgot-reset';

export function LockScreen() {
  const [phase, setPhase] = useState<Phase>('login');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ recoveryEmailMasked: string | null }>('auth:status')
      .then((s) => setMaskedEmail(s?.recoveryEmailMasked || null))
      .catch(() => {});
  }, []);

  const clearError = () => { setError(''); setNotice(''); };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    clearError();
    try {
      await invoke('auth:verify', password);
      setNotice('已解锁，正在进入...');
    } catch (err: any) {
      setError(err?.message || '验证失败');
    }
    setBusy(false);
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    clearError();
    try {
      await invoke('auth:requestResetCode', email);
      setNotice('验证码已发送，请查收邮件（10 分钟内有效）');
      setPhase('forgot-code');
    } catch (err: any) {
      setError(err?.message || '发送失败');
    }
    setBusy(false);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    clearError();
    try {
      const r = await invoke<{ ok: boolean }>('auth:verifyResetCode', email, code);
      if (r?.ok) {
        setPhase('forgot-reset');
        setNotice('验证通过，请设置新密码');
      } else {
        setError('验证码不正确或已过期');
      }
    } catch (err: any) {
      setError(err?.message || '验证失败');
    }
    setBusy(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { setError('新密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    clearError();
    try {
      await invoke('auth:resetPassword', email, code, newPassword);
      setNotice('密码已重设，正在进入...');
    } catch (err: any) {
      setError(err?.message || '重设失败');
    }
    setBusy(false);
  };

  const backToLogin = () => { setPhase('login'); clearError(); };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #EAF3FC 0%, #F5F7FA 60%)', padding: 'var(--spacing-lg)',
    }}>
      <div style={{
        width: 360, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 32px rgba(75, 120, 180, 0.18)', padding: 'var(--spacing-xl)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-lg)' }}>
          <div style={{ fontSize: 40 }}>🔒</div>
          <h2 style={{ margin: '8px 0 4px', fontSize: 'var(--font-size-xl)' }}>个人理财投资软件</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            应用已锁定，请输入启动密码
          </p>
        </div>

        {phase === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <input
                className="form-input" type="password" autoFocus placeholder="启动密码"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <div className="lock-msg lock-msg--error">{error}</div>}
            {error && error.includes('锁定') && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                等不及？可点击下方「忘记密码」通过邮箱验证码重设密码。
              </div>
            )}
            {notice && <div className="lock-msg lock-msg--ok">{notice}</div>}
            <div className="form-actions" style={{ flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? '验证中...' : '🔓 解锁'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => { setPhase('forgot-email'); clearError(); }}>
                忘记密码
              </Button>
              <Button variant="secondary" type="button"
                onClick={() => invoke('auth:quit').catch(() => {})}>
                退出应用
              </Button>
            </div>
          </form>
        )}

        {phase === 'forgot-email' && (
          <form onSubmit={handleRequestCode}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              输入登记时的恢复邮箱，我们将发送 6 位验证码。
              {maskedEmail && <>登记邮箱：<strong>{maskedEmail}</strong></>}
            </p>
            <div className="form-group">
              <input className="form-input" type="email" autoFocus placeholder="恢复邮箱"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error && <div className="lock-msg lock-msg--error">{error}</div>}
            {notice && <div className="lock-msg lock-msg--ok">{notice}</div>}
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={backToLogin}>返回</Button>
              <Button variant="primary" type="submit" disabled={busy}>{busy ? '发送中...' : '发送验证码'}</Button>
            </div>
          </form>
        )}

        {phase === 'forgot-code' && (
          <form onSubmit={handleVerifyCode}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              验证码已发送至 <strong>{email}</strong>，请输入 6 位验证码。
            </p>
            <div className="form-group">
              <input className="form-input" autoFocus placeholder="6 位验证码" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </div>
            {error && <div className="lock-msg lock-msg--error">{error}</div>}
            {notice && <div className="lock-msg lock-msg--ok">{notice}</div>}
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={backToLogin}>返回</Button>
              <Button variant="primary" type="submit" disabled={busy}>{busy ? '验证中...' : '下一步'}</Button>
            </div>
          </form>
        )}

        {phase === 'forgot-reset' && (
          <form onSubmit={handleReset}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              验证通过，设置新启动密码（至少 6 位）。
            </p>
            <div className="form-group">
              <input className="form-input" type="password" autoFocus placeholder="新密码"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <input className="form-input" type="password" placeholder="确认新密码"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            {error && <div className="lock-msg lock-msg--error">{error}</div>}
            {notice && <div className="lock-msg lock-msg--ok">{notice}</div>}
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={backToLogin}>返回</Button>
              <Button variant="primary" type="submit" disabled={busy}>{busy ? '重设中...' : '重设密码并进入'}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}