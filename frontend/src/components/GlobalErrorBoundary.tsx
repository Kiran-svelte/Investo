import { Component, ErrorInfo, ReactNode } from 'react';
import ErrorFallback, { roleHomePath } from './ErrorFallback';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

/**
 * Last-resort boundary for errors outside the dashboard shell (login, onboarding, etc.).
 */
export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorId: `ERR-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[GlobalErrorBoundary]', this.state.errorId, error, info.componentStack);
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <ErrorFallback
        variant="fullscreen"
        title="Investo ran into a problem"
        description="An unexpected error occurred. You can reload the app or sign in again if the issue continues."
        errorId={this.state.errorId}
        errorMessage={this.state.error?.message ?? null}
        showDevDetails={import.meta.env.DEV}
        homeHref={roleHomePath()}
        onRetry={this.handleRetry}
        onReload={() => window.location.reload()}
      />
    );
  }
}

export default GlobalErrorBoundary;
