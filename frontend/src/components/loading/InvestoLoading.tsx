import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2, LogOut, Sparkles, LayoutDashboard, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import InvestoLogo from '../brand/InvestoLogo';
import './InvestoLoading.css';

export type InvestoLoadingVariant =
  | 'workspace'
  | 'session'
  | 'route'
  | 'page'
  | 'inline'
  | 'button'
  | 'logout';

export type InvestoLoadingCategory =
  | 'default'
  | 'features'
  | 'onboarding'
  | 'auth'
  | 'page'
  | 'save';

export interface InvestoLoadingProps {
  variant?: InvestoLoadingVariant;
  category?: InvestoLoadingCategory;
  message?: string;
  hint?: string;
  className?: string;
  /** Route/page only — keep shell visible */
  embedded?: boolean;
}

const ROTATING_STATUS_KEYS = [
  'loading.status_starting',
  'loading.status_connecting',
  'loading.status_dashboard',
  'loading.status_almost',
] as const;

const CATEGORY_MESSAGE_KEYS: Record<InvestoLoadingCategory, string> = {
  default: 'loading.route_default',
  features: 'loading.route_features',
  onboarding: 'loading.route_onboarding',
  auth: 'loading.session_message',
  page: 'loading.page_default',
  save: 'common.saving',
};

const CATEGORY_ICONS: Record<InvestoLoadingCategory, LucideIcon> = {
  default: LayoutDashboard,
  features: Sparkles,
  onboarding: Shield,
  auth: Shield,
  page: LayoutDashboard,
  save: Loader2,
};

const InvestoLoading: React.FC<InvestoLoadingProps> = ({
  variant = 'workspace',
  category = 'default',
  message,
  hint,
  className = '',
  embedded = false,
}) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [statusIndex, setStatusIndex] = useState(0);

  const resolvedMessage =
    message
    ?? t(CATEGORY_MESSAGE_KEYS[category], {
      defaultValue:
        category === 'features'
          ? 'Loading your company features…'
          : 'Loading…',
    });

  const resolvedHint = hint ?? (
    variant === 'workspace'
      ? t('loading.workspace_hint_cold', {
          defaultValue:
            'First load after idle can take up to a minute while the server starts.',
        })
      : undefined
  );

  useEffect(() => {
    if (variant !== 'workspace' || reduceMotion) return undefined;
    const id = window.setInterval(() => {
      setStatusIndex((i) => (i + 1) % ROTATING_STATUS_KEYS.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [variant, reduceMotion]);

  const statusLine =
    variant === 'workspace' && !reduceMotion
      ? t(ROTATING_STATUS_KEYS[statusIndex], { defaultValue: 'Starting your workspace…' })
      : resolvedMessage;

  const Icon = CATEGORY_ICONS[category];

  if (variant === 'logout') {
    return (
      <div
        className={`investo-loading investo-loading--logout ${className}`.trim()}
        role="status"
        aria-live="polite"
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t('loading.logout', { defaultValue: 'Signing out…' })}</span>
      </div>
    );
  }

  if (variant === 'inline' || variant === 'button') {
    return (
      <span
        className={`investo-loading investo-loading--inline ${className}`.trim()}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        <span>{resolvedMessage}</span>
      </span>
    );
  }

  if (variant === 'session') {
    return (
      <div
        className={`investo-loading investo-loading--session min-h-[100dvh] ${className}`.trim()}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <motion.div
          className="investo-loading__session-card"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          <p className="text-sm font-medium text-ink-primary">{resolvedMessage}</p>
          {resolvedHint ? <p className="text-xs text-ink-muted">{resolvedHint}</p> : null}
        </motion.div>
      </div>
    );
  }

  if (variant === 'route' || variant === 'page') {
    const embeddedClass = embedded ? 'investo-loading--embedded' : '';
    return (
      <div
        className={`investo-loading investo-loading--route ${embeddedClass} ${className}`.trim()}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <motion.div
          className="investo-loading__route-card"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <span className="investo-loading__route-icon" aria-hidden>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-primary">{resolvedMessage}</p>
            {resolvedHint ? <p className="mt-0.5 text-xs text-ink-muted">{resolvedHint}</p> : null}
          </div>
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-600" />
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className={`investo-loading investo-loading--workspace ${embedded ? '' : 'min-h-[100dvh]'} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="workspace-loader__glow" aria-hidden="true" />
      <motion.div
        className="workspace-loader__card"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="workspace-loader__brand">
          <motion.span
            className="workspace-loader__logo"
            animate={reduceMotion ? undefined : { rotate: [0, 4, -4, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <InvestoLogo height={36} />
          </motion.span>
          <div className="workspace-loader__brand-text">
            <AnimatePresence mode="wait">
              <motion.span
                key={statusLine}
                className="workspace-loader__subtitle"
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
              >
                {statusLine}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <div className="workspace-loader__track" aria-hidden="true">
          <motion.div
            className="workspace-loader__bar"
            initial={{ width: '8%' }}
            animate={reduceMotion ? { width: '60%' } : { width: ['8%', '72%', '38%', '88%', '52%'] }}
            transition={reduceMotion ? undefined : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <p className="workspace-loader__message">{resolvedMessage}</p>
        {resolvedHint ? <p className="workspace-loader__hint">{resolvedHint}</p> : null}
      </motion.div>
    </div>
  );
};

export default InvestoLoading;
