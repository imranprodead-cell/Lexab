import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tStandalone } from '@/i18n/messages';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render/runtime errors anywhere in the tree
 * and shows a recoverable fallback instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
    // Самые тяжёлые падения фронта (белый экран у пользователя) обязаны
    // долетать до мониторинга. Динамический импорт — как в main.tsx: без DSN
    // Sentry не грузится вовсе.
    if (import.meta.env.VITE_SENTRY_DSN) {
      void import('@sentry/react')
        .then((Sentry) => Sentry.captureException(error, { extra: { componentStack: info.componentStack } }))
        .catch(() => undefined);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          height: '100vh',
          width: '100vw',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
            color: 'var(--danger)',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          !
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{tStandalone('error.title')}</h1>
        <p style={{ color: 'var(--dim)', maxWidth: 380, margin: 0, lineHeight: 1.5 }}>
          {tStandalone('error.body')}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={this.reset}
            style={{
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '10px 18px',
              borderRadius: 10,
              color: 'var(--text)',
              background: 'var(--hover-2)',
              border: '1px solid var(--border)',
            }}
          >
            {tStandalone('error.retry')}
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '10px 18px',
              borderRadius: 10,
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              border: 'none',
            }}
          >
            {tStandalone('error.reload')}
          </button>
        </div>
      </div>
    );
  }
}
