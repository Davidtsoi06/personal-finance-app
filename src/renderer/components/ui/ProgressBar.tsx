/**
 * ProgressBar — color-adaptive progress bar with label.
 * Color transitions from green → blue → orange → red based on percentage.
 */
import './ProgressBar.css';

interface ProgressBarProps {
  percent: number;       // 0-100+
  height?: number;       // default 12px
  showLabel?: boolean;   // default true
  className?: string;
}

export function ProgressBar({ percent, height = 12, showLabel = true, className = '' }: ProgressBarProps) {
  const clampedPct = Math.min(Math.max(percent, 0), 100);

  let colorVar = 'var(--color-success)'; // green
  if (clampedPct > 60 && clampedPct <= 80) colorVar = 'var(--color-primary-500)'; // blue
  else if (clampedPct > 80 && clampedPct <= 100) colorVar = 'var(--color-warning)'; // orange
  else if (percent > 100) colorVar = 'var(--color-danger)'; // red

  return (
    <div className={`progress-bar ${className}`}>
      <div className="progress-bar__track" style={{ height }}>
        <div
          className="progress-bar__fill"
          style={{
            width: `${clampedPct}%`,
            background: colorVar,
            height,
          }}
        />
      </div>
      {showLabel && <span className="progress-bar__label" style={{ color: colorVar }}>{Math.round(percent)}%</span>}
    </div>
  );
}
