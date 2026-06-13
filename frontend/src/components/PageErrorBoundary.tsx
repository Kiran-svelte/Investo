import { Component, ErrorInfo, ReactNode } from 'react';
import ErrorFallback from './ErrorFallback';
import { dashboardPath } from '../config/navigation.config';

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Reset boundary when route changes (e.g. pathname). */
  resetKey?: string;
}

interface PageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/** Catches render errors inside the dashboard shell without blanking the whole app. */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorId: `ERR-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  componentDidUpdate(prevProps: PageErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, errorId: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[PageErrorBoundary]', this.state.errorId, error, info.componentStack);
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
        variant="page"
        errorId={this.state.errorId}
        errorMessage={this.state.error?.message ?? null}
        showDevDetails={import.meta.env.DEV}
        homeHref={dashboardPath()}
        onRetry={this.handleRetry}
        onReload={() => window.location.reload()}
      />
    );
  }
}

export default PageErrorBoundary;
