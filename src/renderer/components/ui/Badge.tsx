/**
 * Badge — unified status/tag pill component.
 * Replaces 10+ duplicate inline badge patterns across pages.
 */

interface BadgeProps {
  label: string;
  color?: 'primary' | 'success' | 'danger' | 'info' | 'warning' | 'default';
  size?: 'sm' | 'md';
}

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'var(--color-primary-100)', text: 'var(--color-primary-700)' },
  success: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  danger: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
  info: { bg: 'var(--color-info-bg)', text: 'var(--color-primary-500)' },
  warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)' },
  default: { bg: 'var(--color-bg)', text: 'var(--color-text-secondary)' },
};

export function Badge({ label, color = 'default', size = 'sm' }: BadgeProps) {
  const c = COLOR_MAP[color] || COLOR_MAP.default;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: size === 'sm' ? '2px 10px' : '4px 14px',
        borderRadius: 'var(--radius-sm)',
        fontWeight: 500,
        fontSize: size === 'sm' ? 'var(--font-size-sm)' : 'var(--font-size-md)',
        background: c.bg,
        color: c.text,
      }}
    >
      {label}
    </span>
  );
}
