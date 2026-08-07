/**
 * Amount display component — formats amounts with currency symbols and colors.
 */
import './Amount.css';

interface AmountProps {
  value: number;
  currency?: string;
  /** Show sign (+/-) */
  showSign?: boolean;
  /** Use appropriate color for positive/negative values */
  colored?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  GBP: '£',
};

function formatAmount(value: number, currency?: string): string {
  const symbol = currency ? CURRENCY_SYMBOLS[currency] || currency : '';
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${formatted}`;
}

export function Amount({ value, currency, showSign = true, colored = true, size = 'md', className = '' }: AmountProps) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const colorClass = colored
    ? value > 0
      ? 'amount--positive'
      : value < 0
        ? 'amount--negative'
        : ''
    : '';

  return (
    <span className={`amount amount--${size} ${colorClass} ${className}`.trim()}>
      {showSign && sign}
      {formatAmount(value, currency)}
    </span>
  );
}

/** Simplified display for net values (no color unless negative) */
export function NetAmount({ value, currency }: { value: number; currency?: string }) {
  return (
    <span className={`amount amount--xl ${value < 0 ? 'amount--negative' : ''}`}>
      {formatAmount(value, currency)}
    </span>
  );
}

/** Percentage display */
export function PctAmount({ value }: { value: number }) {
  const cls = value > 0 ? 'amount--positive' : value < 0 ? 'amount--negative' : '';
  return (
    <span className={`amount amount--sm ${cls}`}>
      {value > 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}
