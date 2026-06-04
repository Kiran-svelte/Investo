import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, ShieldAlert } from 'lucide-react';
import { dashboardPath } from '../../config/navigation.config';

interface AccessFeedbackPageProps {
  eyebrow?: string;
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
  showBackAction?: boolean;
}

const AccessFeedbackPage: React.FC<AccessFeedbackPageProps> = ({
  eyebrow = 'Workspace access',
  title,
  description,
  primaryHref = dashboardPath(),
  primaryLabel = 'Go to my home',
  showBackAction = true,
}) => {
  const navigate = useNavigate();

  return (
    <div className="investo-page flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border border-surface-border bg-surface-elevated p-6 text-center shadow-investo sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-primary">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-muted">{description}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={primaryHref} className="investo-btn-primary inline-flex items-center justify-center gap-2">
            <Home className="h-4 w-4" />
            {primaryLabel}
          </Link>
          {showBackAction && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="investo-btn-secondary inline-flex items-center justify-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default AccessFeedbackPage;
