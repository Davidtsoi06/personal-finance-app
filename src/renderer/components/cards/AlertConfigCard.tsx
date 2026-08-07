/**
 * AlertConfigCard — Settings card for price change alert configuration.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { invoke } from '../../hooks/useIpc';

interface AlertCfg {
  id: number;
  type: string;
  enabled: number;
  threshold: number;
}

const ALERT_LABELS: Record<string, { emoji: string; label: string }> = {
  price_drop: { emoji: '📉', label: '跌幅提醒' },
  price_surge: { emoji: '📈', label: '涨幅提醒' },
};

export function AlertConfigCard() {
  const [alertConfigs, setAlertConfigs] = useState<AlertCfg[]>([]);

  const loadAlerts = useCallback(() => {
    invoke<AlertCfg[]>('alert:listConfig').then((list) => setAlertConfigs(list || []));
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const handleToggle = async (id: number, enabled: number) => {
    await invoke('alert:updateConfig', id, { enabled });
    loadAlerts();
  };

  const handleChangeThreshold = async (id: number, threshold: number) => {
    if (threshold <= 0 || threshold > 50) return;
    await invoke('alert:updateConfig', id, { threshold });
    loadAlerts();
  };

  return (
    <Card title="⚠️ 智能提醒">
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
        当持仓价格变动超过阈值时，通过 Windows 系统通知提醒你。价格每 30 分钟自动检查一次。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {alertConfigs.filter((ac) => ac.type === 'price_drop' || ac.type === 'price_surge').map((ac) => {
          const info = ALERT_LABELS[ac.type] || { emoji: '📊', label: ac.type };
          return (
            <div key={ac.id} style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 140 }}>
                <input
                  type="checkbox"
                  checked={ac.enabled === 1}
                  onChange={(e) => handleToggle(ac.id, e.target.checked ? 1 : 0)}
                />
                {info.emoji} {info.label}
              </label>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>超过</span>
              <input
                className="form-input" type="number" step="0.5"
                value={ac.threshold}
                onChange={(e) => handleChangeThreshold(ac.id, parseFloat(e.target.value) || 0)}
                style={{ width: 70, textAlign: 'center' }}
              />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>% 时通知</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
