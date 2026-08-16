/**
 * SecurityCard — 启动密码锁设置（v1.7.0）。
 * 启用前必须完成：SMTP 发件配置 + 恢复邮箱 + 测试邮件成功。
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

interface AuthStatus {
  enabled: boolean;
  idleMinutes: number;
  recoveryEmailMasked: string | null;
  smtpConfigured: boolean;
}

export function SecurityCard() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 配置表单
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');

  // 密码表单
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [testSent, setTestSent] = useState(false);

  const load = () => {
    invoke<AuthStatus>('auth:status')
      .then((s) => { setStatus(s || null); })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const msg = (err: any, ok: string) => {
    setError(err?.message || '操作失败');
    setNotice('');
    if (!err) setNotice(ok);
  };

  const handleSaveSmtp = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:setupSmtp', { host: smtpHost, port: parseInt(smtpPort) || 465, secure: smtpSecure, user: smtpUser, pass: smtpPass });
      await invoke('auth:setRecoveryEmail', recoveryEmail);
      setTestSent(false);
      setNotice('✅ SMTP 与恢复邮箱已保存，请发送测试邮件');
    } catch (err: any) { msg(err, ''); }
    setBusy(false);
    load();
  };

  const handleTestEmail = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:sendTestEmail');
      setTestSent(true);
      setNotice('✅ 测试邮件已发送，请到恢复邮箱查收');
    } catch (err: any) { msg(err, ''); }
    setBusy(false);
  };

  const handleEnable = async () => {
    if (newPassword.length < 6) { setError('密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:enable', newPassword);
      setNewPassword(''); setConfirmPassword('');
      setNotice('✅ 启动密码已启用');
    } catch (err: any) { msg(err, ''); }
    setBusy(false);
    load();
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { setError('新密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:changePassword', oldPassword, newPassword);
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice('✅ 密码已修改');
    } catch (err: any) { msg(err, ''); }
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('auth:disable', disablePassword);
      setDisablePassword('');
      setNotice('✅ 启动密码已关闭');
    } catch (err: any) { msg(err, ''); }
    setBusy(false);
    load();
  };

  const handleIdleChange = async (minutes: number) => {
    try { await invoke('auth:setIdleMinutes', minutes); setNotice(`✅ 空闲锁定时长已设为 ${minutes} 分钟`); }
    catch (err: any) { msg(err, ''); }
    load();
  };

  return (
    <Card title="🔒 启动密码锁">
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: 0 }}>
        打开软件时需输入密码；忘记密码时通过邮箱验证码重设。密码不会以明文保存。
      </p>

      {status?.enabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)' }}>
            ✅ 已启用 · 恢复邮箱 <strong>{status.recoveryEmailMasked || '未设置'}</strong>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">当前密码</label>
              <input className="form-input" type="password" value={oldPassword} placeholder="用于修改密码"
                onChange={(e) => setOldPassword(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">新密码</label>
              <input className="form-input" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <input className="form-input" type="password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <Button variant="primary" onClick={handleChangePassword} disabled={busy}>修改密码</Button>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">空闲自动锁定</label>
              <select className="form-select" value={status.idleMinutes} onChange={(e) => handleIdleChange(parseInt(e.target.value))}>
                {[1, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} 分钟</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">立即锁定</label>
              <Button variant="secondary" onClick={() => invoke('auth:lock').catch(() => {})}>🔒 立即锁定</Button>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">输入密码以关闭启动密码</label>
              <input className="form-input" type="password" value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)} />
            </div>
            <div className="form-group">
              <Button variant="danger" onClick={handleDisable} disabled={busy}>关闭启动密码</Button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-secondary)', padding: 'var(--spacing-sm) var(--spacing-md)', borderRadius: 'var(--radius-sm)' }}>
            启用前请完成 3 步：① 配置发件邮箱（SMTP 授权码）与恢复邮箱 → ② 发送测试邮件并收到 → ③ 设置启动密码。
            <br />⚠️ 找回密码完全依赖邮箱验证码，请确保邮箱配置正确；离线时将无法找回。
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">SMTP 服务器</label>
              <input className="form-input" placeholder="如 smtp.qq.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">端口</label>
              <input className="form-input" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">发件邮箱</label>
              <input className="form-input" placeholder="如 xxx@qq.com" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">SMTP 授权码</label>
              <input className="form-input" type="password" placeholder="邮箱设置里获取的授权码" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              使用 SSL（465 端口；部分邮箱 587 端口请取消勾选）
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">恢复邮箱（收验证码的邮箱）</label>
            <input className="form-input" type="email" placeholder="如 xxx@qq.com" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} />
          </div>
          <div className="form-row">
            <Button variant="secondary" onClick={handleSaveSmtp} disabled={busy}>保存配置</Button>
            <Button variant="secondary" onClick={handleTestEmail} disabled={busy || !status?.smtpConfigured}>发送测试邮件</Button>
          </div>
          {testSent && (
            <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">启动密码（至少 6 位）</label>
                  <input className="form-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">确认密码</label>
                  <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <Button variant="primary" onClick={handleEnable} disabled={busy}>启用启动密码</Button>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 'var(--spacing-md)', padding: 'var(--spacing-sm) var(--spacing-md)', background: '#FFF2F0', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
      {notice && <div style={{ marginTop: 'var(--spacing-md)', padding: 'var(--spacing-sm) var(--spacing-md)', background: '#F6FFED', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' }}>{notice}</div>}
    </Card>
  );
}