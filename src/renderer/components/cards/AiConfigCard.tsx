/**
 * AiConfigCard — Settings card for DeepSeek AI API configuration.
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

const KEY_MASK = '••••••••••••••••';

export function AiConfigCard() {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [includePortfolio, setIncludePortfolio] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(false);

  useEffect(() => {
    // Check if key is already configured
    invoke<{ hasApiKey: boolean; includePortfolio?: boolean }>('settings:getAiConfig').then((c) => {
      if (c?.hasApiKey) setApiKey(KEY_MASK);
      if (c && c.includePortfolio !== undefined) setIncludePortfolio(c.includePortfolio);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true); setStatus(null);
    try {
      await invoke('settings:saveAiConfig', {
        provider: 'deepseek',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        // 掩码未修改时传空串，表示保持现有 Key（空值不会覆盖已存 Key）
        apiKey: apiKey === KEY_MASK ? '' : apiKey,
        model: 'deepseek-chat',
      });
      setStatus('✅ 配置已保存');
      if (apiKey && apiKey !== KEY_MASK) setApiKey(KEY_MASK);
    } catch (err: any) { setStatus('❌ 保存失败：' + err.message); }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true); setStatus('正在测试连接...');
    try {
      const r = await invoke<{ ok: boolean; error?: string }>('settings:testAiConnection', {
        provider: 'deepseek',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        apiKey,
        model: 'deepseek-chat',
      });
      setStatus(r.ok ? '✅ 连接成功！AI 助手可以正常使用' : '❌ 连接失败：' + r.error);
    } catch (err: any) { setStatus('❌ 测试失败：' + err.message); }
    setTesting(false);
  };

  const handleTogglePrivacy = async (next: boolean) => {
    setIncludePortfolio(next);
    setPrivacySaving(true);
    try {
      await invoke('settings:saveAiConfig', {
        provider: 'deepseek',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: '',
        model: 'deepseek-chat',
        includePortfolio: next,
      });
    } catch (err: any) {
      setStatus('❌ 保存失败：' + err.message);
      setIncludePortfolio(!next); // 回滚
    }
    setPrivacySaving(false);
  };

  return (
    <Card title="🤖 AI 助手配置">
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
        配置 DeepSeek AI 服务。新用户注册即送 <strong>$5 免费额度</strong>，每天 50 次免费调用。
        API Key 存储在本机，不会上传到任何第三方服务器。
      </div>

      <div className="form-group">
        <label className="form-label">API Key</label>
        <input
          className="form-input" type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="输入 DeepSeek API Key（sk-...）"
        />
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          注册即送 $5 额度，个人使用足够数月 · <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://platform.deepseek.com/api_keys', '_blank'); }} style={{ color: 'var(--color-primary-500)' }}>获取免费 API Key →</a>
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 'var(--spacing-md)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
          <input
            type="checkbox"
            checked={includePortfolio}
            disabled={privacySaving}
            onChange={(e) => handleTogglePrivacy(e.target.checked)}
          />
          允许 AI 读取我的持仓、账户与交易数据（用于组合分析与日报）
        </label>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          开启后，提问时会把你的资产数据发送给 DeepSeek 用于分析；关闭后 AI 仅基于通用理财知识回答。
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ 保存中...' : '💾 保存配置'}
        </Button>
        <Button variant="secondary" onClick={handleTest} disabled={testing}>
          {testing ? '⏳ 测试中...' : '🔍 测试连接'}
        </Button>
      </div>
      {status && (
        <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm)', background: status.includes('成功') ? '#F6FFED' : '#FFF2F0', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)' }}>
          {status}
        </div>
      )}
    </Card>
  );
}
