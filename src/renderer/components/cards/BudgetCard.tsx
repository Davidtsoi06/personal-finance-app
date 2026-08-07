/**
 * BudgetCard — Dashboard card showing monthly budget progress.
 * Displays: spent/remaining, progress bar, "remaining per day" calculation.
 */
import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { invoke } from '../../hooks/useIpc';
import './BudgetCard.css';

interface BudgetStatus {
  budget: { id: number; name: string; amount: number; month: string; notify_at: number } | null;
  totalSpent: number;
  remaining: number;
  percent: number;
  daysInMonth: number;
  daysRemaining: number;
  dailyAvailable: number;
  isOverBudget: boolean;
  isOverWarning: boolean;
}

export function BudgetCard() {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    invoke<BudgetStatus>('budget:status', month)
      .then(s => { setStatus(s); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Reload after ledger changes (simple polling alternative — refresh on focus)
  useEffect(() => {
    const handleFocus = () => load();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  if (loading) return null;
  if (!status || !status.budget) return null; // No budget set — don't show card

  // Safe access after guard above — TypeScript narrows status.budget but not s.budget
  const budget = status.budget;

  return (
    <Card title={`📊 本月预算  ${budget.month}`}>
      <div className="budget-card">
        <div className="budget-card__summary">
          <div className="budget-card__item">
            <span className="budget-card__label">已用</span>
            <span className="budget-card__value budget-card__value--spent">
              ¥ {status.totalSpent.toLocaleString()}
            </span>
          </div>
          <div className="budget-card__item">
            <span className="budget-card__label">预算</span>
            <span className="budget-card__value">¥ {budget.amount.toLocaleString()}</span>
          </div>
        </div>

        <ProgressBar percent={status.percent} height={14} />

        <div className="budget-card__details">
          {status.isOverBudget ? (
            <div className="budget-card__alert budget-card__alert--danger">
              🚫 已超出预算 ¥ {(status.totalSpent - budget.amount).toLocaleString()}
            </div>
          ) : status.isOverWarning ? (
            <div className="budget-card__alert budget-card__alert--warning">
              ⚠️ 已超过预警线（{Math.round(budget.notify_at * 100)}%）· 剩余 ¥ {status.remaining.toLocaleString()}
            </div>
          ) : (
            <div className="budget-card__alert budget-card__alert--ok">
              💰 剩余 ¥ {status.remaining.toLocaleString()}
            </div>
          )}
          {status.daysRemaining > 0 && (
            <div className="budget-card__daily">
              💡 本月还剩 {status.daysRemaining} 天，每天可用约 ¥ {status.dailyAvailable.toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
