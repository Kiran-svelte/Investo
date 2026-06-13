import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Home, RefreshCw, ArrowLeft } from 'lucide-react';
import { dashboardPath, getRoleHomePath } from '../config/navigation.config';
import type { UserRole } from '../context/AuthContext';

interface ErrorFallbackProps {
  title?: string;
  description?: string;
  errorId?: string | null;
  errorMessage?: string | null;
  showDevDetails?: boolean;
  variant?: 'page' | 'fullscreen';
  homeHref?: string;
  onRetry?: () => void;
  onReload?: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  title = 'This page hit a snag',
  description = 'Something unexpected happened while loading this screen. Your session is still active — try again or return to your dashboard.',
  errorId,
  errorMessage,
  showDevDetails = false,
  variant = 'page',
  homeHref = dashboardPath(),
  onRetry,
  onReload,
}) => {
  const shellClass =
    variant === 'fullscreen'
      ? 'min-h-screen bg-surface-muted px-4 py-10'
      : 'min-h-[calc(100dvh-3.5rem)] bg-surface-muted px-4 py-10';

  return (
    <div className={`investo-page flex items-center justify-center ${shellClass}`}>
      <section className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-elevated p-6 text-center shadow-investo sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Investo</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-primary">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-muted">{description}</p>
        {errorId ? (
          <p className="mt-4 text-xs text-ink-faint">
            Reference: <code className="rounded bg-surface-subtle px-2 py-0.5 font-mono">{errorId}</code>
          </p>
        ) : null}
        {showDevDetails && errorMessage ? (
          <details className="mt-4 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-rose-800">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-rose-900">{errorMessage}</pre>
          </details>
        ) : null}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="investo-btn-primary inline-flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          ) : null}
          {onReload ? (
            <button type="button" onClick={onReload} className="investo-btn-secondary inline-flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Reload page
            </button>
          ) : null}
          <Link to={homeHref} className="investo-btn-secondary inline-flex items-center justify-center gap-2">
            <Home className="h-4 w-4" />
            Go to dashboard
          </Link>
        </div>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mt-4 inline-flex items-center justify-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back
        </button>
      </section>
    </div>
  );
};

export function roleHomePath(role?: UserRole | string): string {
  return getRoleHomePath(role as UserRole | undefined);
}

export default ErrorFallback;
