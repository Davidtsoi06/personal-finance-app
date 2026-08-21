/**
 * AiUsageBalanceCard — AI API 余额与今日用量（v1.10.5）。
 * 余额：DeepSeek/OpenAI 官方接口（手动刷新，不自动轮询）；
 * 用量：本地按天统计（调用次数 + 输入/输出 tokens，所有服务商通用）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';

export interface UsageToday {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export function AiUsageBalanceCard() {
  const [balance, setBalance] = useState<{ balance: number; currency: string; provider: string; fetchedAt?: string } | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState<UsageToday>({ calls: 0, promptTokens: 0, completionTokens: 0 });

  const loadUsage = useCallback(() => {
    invoke<UsageToday>('ai:usageToday')
      .then((u) => setUsage(u || { calls: 0, promptTokens: 0, completionTokens: 0 }))
      .catch(() => {});
  }, []);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  const refreshBalance = async () => {
    setLoading(true);
    setBalanceError('');
    try {
      const r = await invoke<{ success: boolean; balance?: number; currency?: string; provider?: string; fetchedAt?: string; error?: string }>('ai:balance');
      if (r.success && r.balance !== undefined) {
        setBalance({ balance: r.balance, currency: r.currency || 'USD', provider: r.provider || '', fetchedAt: r.fetchedAt });
      } else {
        setBalance(null);
        setBalanceError(r.error || '余额查询失败');
      }
    } catch (err: any) {
      setBalance(null);
      setBalanceError(err.message || '余额查询失败');
    }
    setLoading(false);
  };

  const providerLabel = (p: string) => (p === 'deepseek' ? 'DeepSeek' : p === 'openai' ? 'OpenAI' : p || '');
  const currencySymbol = (c: string) => (c === 'USD' ? '$' : c === 'CNY' ? '¥' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'JPY' ? 'JP¥' : c);
  const fetchedTime = balance?.fetchedAt ? new Date(balance.fetchedAt).toLocaleTimeString() : '';

  return (
    <Card title="💳 API 余额与用量">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {/* 余额 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 2 }}>
              API 余额{balance?.provider ? `（${providerLabel(balance.provider)}）` : ''}{fetchedTime ? ` · 更新于 ${fetchedTime}` : ''}
            </div>
            {balance ? (
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-success)' }}>
                {currencySymbol(balance.currency)} {balance.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6 }}>{balance.currency}</span>
              </div>
            ) : (
              <div style={{ fontSize: 'var(--font-size-sm)', color: balanceError ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                {balanceError || '点击「刷新余额」查询（DeepSeek / OpenAI 支持）'}
              </div>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={refreshBalance} disabled={loading}>
            {loading ? '⏳ 查询中...' : '🔄 刷新余额'}
          </Button>
        </div>

        {/* 今日用量 */}
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <div style={{
            flex: 1, minWidth: 120, padding: 'var(--spacing-sm) var(--spacing-md)',
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{usage.calls}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>今日调用次数</div>
          </div>
          <div style={{
            flex: 1, minWidth: 120, padding: 'var(--spacing-sm) var(--spacing-md)',
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{usage.promptTokens.toLocaleString()}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>今日输入 tokens</div>
          </div>
          <div style={{
            flex: 1, minWidth: 120, padding: 'var(--spacing-sm) var(--spacing-md)',
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{usage.completionTokens.toLocaleString()}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>今日输出 tokens</div>
          </div>
        </div>

        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          用量由本机统计（每次 AI 调用后记录），支持全部服务商；余额来自服务商官方接口，仅 DeepSeek / OpenAI 支持。
        </div>
      </div>
    </Card>
  );
}
