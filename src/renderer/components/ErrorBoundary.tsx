/**
 * ErrorBoundary — catches unhandled React rendering errors and shows a fallback UI.
 */
import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 'var(--spacing-md)',
          padding: 'var(--spacing-xl)', fontFamily: 'var(--font-family)',
          color: 'var(--color-text)', background: 'var(--color-bg)',
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>页面出现错误</h2>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textAlign: 'center', maxWidth: 500 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: 500 }}>
            你的数据仍然安全存储在本地数据库中。请尝试刷新页面，或重启应用。
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 24px', fontSize: 'var(--font-size-sm)',
              background: 'var(--color-primary-500)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            🔄 刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
