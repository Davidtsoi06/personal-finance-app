/**
 * Badge — unified status/tag pill component.
 * Replaces 10+ duplicate inline badge patterns across pages.
 */

interface BadgeProps {
  label: string;
  color?: 'success' | 'danger' | 'info' | 'warning' | 'default';
  size?: 'sm' | 'md';
}

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  success: { bg: '#F6FFED', text: 'var(--color-success)' },
  danger: { bg: '#FFF2F0', text: 'var(--color-danger)' },
  info: { bg: '#E6F7FF', text: 'var(--color-primary-500)' },
  warning: { bg: '#FFFBE6', text: '#8C6D00' },
  default: { bg: 'var(--color-bg-secondary)', text: 'var(--color-text-secondary)' },
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
