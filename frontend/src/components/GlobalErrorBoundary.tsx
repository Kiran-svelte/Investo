import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

/**
 * GlobalErrorBoundary catches any unhandled React render error and shows a
 * recovery UI instead of white-screening the entire application.
 *
 * Without this, a crash in any route component (e.g., ConversationsPage,
 * LeadDetailPage) would completely blank the app with no recovery path.
 *
 * Logs the error with a generated errorId for support correlation.
 */
export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production this would be sent to an error tracking service (Sentry etc.)
    // We deliberately do NOT console.log in production — structured logging only.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[GlobalErrorBoundary]', this.state.errorId, error, info.componentStack);
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.icon}>⚠️</div>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.subtitle}>
            An unexpected error occurred. Our team has been notified.
          </p>
          {this.state.errorId && (
            <p style={styles.errorId}>
              Error ID: <code style={styles.code}>{this.state.errorId}</code>
            </p>
          )}
          {import.meta.env.DEV && this.state.error && (
            <details style={styles.details}>
              <summary style={styles.summary}>Technical details (dev only)</summary>
              <pre style={styles.pre}>{this.state.error.message}</pre>
            </details>
          )}
          <div style={styles.actions}>
            <button style={styles.primaryButton} onClick={this.handleReload}>
              Reload Page
            </button>
            <button style={styles.secondaryButton} onClick={this.handleReset}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '24px',
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '20px',
    padding: '48px 40px',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
    color: '#fff',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 12px',
    color: '#fff',
  },
  subtitle: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.65)',
    margin: '0 0 20px',
    lineHeight: 1.6,
  },
  errorId: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 24px',
  },
  code: {
    background: 'rgba(255,255,255,0.1)',
    padding: '2px 8px',
    borderRadius: '6px',
    fontFamily: 'monospace',
    letterSpacing: '0.05em',
  },
  details: {
    textAlign: 'left',
    marginBottom: '24px',
    background: 'rgba(255,100,100,0.1)',
    border: '1px solid rgba(255,100,100,0.2)',
    borderRadius: '8px',
    padding: '12px',
  },
  summary: {
    cursor: 'pointer',
    color: 'rgba(255,200,200,0.8)',
    fontSize: '13px',
    marginBottom: '8px',
  },
  pre: {
    fontSize: '12px',
    color: 'rgba(255,200,200,0.7)',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  primaryButton: {
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  secondaryButton: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.8)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
};
