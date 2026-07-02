import React from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from '../../lib/motion';
import InvestoLogo from './InvestoLogo';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

export { AnimatePresence, LayoutGroup };

export const LOGIN_BRAND_LAYOUT_ID = 'investo-brand-logo';

export function useLoginBrandIntro() {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = React.useState<'splash' | 'settled'>(reduceMotion ? 'settled' : 'splash');

  React.useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = window.setTimeout(() => setPhase('settled'), 1500);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  return {
    phase,
    isSplash: phase === 'splash',
    layoutId: LOGIN_BRAND_LAYOUT_ID,
  };
}

export function LoginBrandSplash({ layoutId, visible }: { layoutId: string; visible: boolean }) {
  if (!visible) return null;

  return (
    <motion.div
      key="login-logo-splash"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-muted"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      aria-hidden
      data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
    >
      <motion.div
        layoutId={layoutId}
        initial={{ scale: 0.55, opacity: 0, rotate: -3 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <InvestoLogo height={76} glow resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE} />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(250,204,21,0.14)_0%,transparent_58%)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.55 }}
      />
    </motion.div>
  );
}

export function LoginBrandMarkSlot({
  layoutId,
  height = 48,
  visible,
}: {
  layoutId: string;
  height?: number;
  visible: boolean;
}) {
  if (!visible) {
    return <div className="h-[48px]" aria-hidden />;
  }

  return (
    <motion.div
      layoutId={layoutId}
      className="flex w-full items-center justify-center lg:justify-start"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
    >
      <InvestoLogo
        height={height}
        glow
        className="max-w-[min(100%,300px)]"
        resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
      />
    </motion.div>
  );
}

export function LoginSuccessLogoFly({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete: () => void;
}) {
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!active) return undefined;
    if (reduceMotion) {
      onComplete();
      return undefined;
    }
    const t = window.setTimeout(onComplete, 1050);
    return () => window.clearTimeout(t);
  }, [active, onComplete, reduceMotion]);

  if (!active || reduceMotion) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-surface-muted/95 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      aria-live="polite"
      data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
    >
      <motion.div
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={{
          scale: 0.4,
          x: 'calc(-50vw + 5rem)',
          y: 'calc(-50vh + 2.25rem)',
        }}
        transition={{ duration: 0.82, ease: [0.22, 1, 0.36, 1] }}
      >
        <InvestoLogo height={80} glow resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE} />
      </motion.div>
    </motion.div>
  );
}

type LoginBrandIntroProps = {
  children: React.ReactNode;
  /** Hide form column during splash */
  hidden?: boolean;
};

/** Fades in login column after splash. */
export default function LoginBrandIntro({ children, hidden = false }: LoginBrandIntroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 10 : 0 }}
      transition={{ duration: 0.4, delay: hidden ? 0 : 0.05 }}
      data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
    >
      {children}
    </motion.div>
  );
}
