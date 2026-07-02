import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from '../../lib/motion';
import InvestoLogo from './InvestoLogo';
import './AuthSignInLoader.css';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

const STATUS_LINES = [
  'Signing you in',
  'Verifying credentials',
  'Syncing your workspace',
] as const;

const SPRING = { type: 'spring' as const, stiffness: 100, damping: 20 };

type AuthSignInLoaderProps = {
  active: boolean;
  message?: string;
};

const OrbitRing = React.memo(function OrbitRing({
  radius,
  duration,
  delay = 0,
  dotClassName = 'bg-amber-400/90',
}: {
  radius: number;
  duration: number;
  delay?: number;
  dotClassName?: string;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-1/2"
      style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius }}
      animate={{ rotate: 360 }}
      transition={{ duration, repeat: Infinity, ease: 'linear', delay }}
    >
      <span
        className={`absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] ${dotClassName}`}
        aria-hidden
      />
    </motion.div>
  );
});

const MeshBackdrop = React.memo(function MeshBackdrop() {
  return (
    <>
      <div className="auth-signin-loader__mesh-a pointer-events-none absolute -left-[18%] top-[12%] h-[52vmin] w-[52vmin] rounded-full blur-3xl" />
      <div className="auth-signin-loader__mesh-b pointer-events-none absolute -right-[12%] bottom-[8%] h-[48vmin] w-[48vmin] rounded-full blur-3xl" />
    </>
  );
});

const LogoRipples = React.memo(function LogoRipples() {
  return (
    <>
      <span className="auth-signin-loader__ripple pointer-events-none absolute inset-0 rounded-full" aria-hidden />
      <span
        className="auth-signin-loader__ripple auth-signin-loader__ripple--delay pointer-events-none absolute inset-0 rounded-full"
        aria-hidden
      />
    </>
  );
});

const ProgressRing = React.memo(function ProgressRing({ size }: { size: number }) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <svg
      className="auth-signin-loader__ring-svg pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      width={size}
      height={size}
      aria-hidden
    >
      <circle className="auth-signin-loader__ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
      <circle
        className="auth-signin-loader__ring-progress"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.72}
      />
    </svg>
  );
});

export default function AuthSignInLoader({ active, message }: AuthSignInLoaderProps) {
  const reduceMotion = useReducedMotion();
  const [lineIndex, setLineIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [active]);

  React.useEffect(() => {
    if (!active || reduceMotion) return undefined;
    const id = window.setInterval(() => {
      setLineIndex((current) => (current + 1) % STATUS_LINES.length);
    }, 2400);
    return () => window.clearInterval(id);
  }, [active, reduceMotion]);

  React.useEffect(() => {
    if (!active) setLineIndex(0);
  }, [active]);

  const statusText = message?.trim() || STATUS_LINES[lineIndex];
  const logoHeight = 88;
  const ringSize = 220;

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          key="auth-signin-loader"
          className="fixed inset-0 z-[105] touch-none overscroll-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-busy="true"
          aria-label={statusText}
          data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
        >
          <motion.div
            className="auth-signin-loader__curtain pointer-events-auto absolute inset-0 min-h-[100dvh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {!reduceMotion ? <MeshBackdrop /> : null}

          <motion.div
            className="auth-signin-loader__grain pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
          />

          {!reduceMotion ? (
            <>
              <motion.div
                className="pointer-events-none absolute inset-y-0 left-0 w-[52%] bg-slate-950/80"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.div
                className="pointer-events-none absolute inset-y-0 right-0 w-[52%] bg-slate-950/80"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              />
            </>
          ) : null}

          <div className="pointer-events-none absolute inset-0 flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-16 pt-10 md:px-10">
            <motion.div
              className="relative flex w-full max-w-xl flex-col items-center md:items-start"
              initial={reduceMotion ? false : { opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: 0.18 }}
            >
              <div
                className="relative mx-auto flex items-center justify-center md:mx-0 md:translate-x-2"
                style={{ width: ringSize, height: ringSize }}
              >
                {!reduceMotion ? (
                  <>
                    <ProgressRing size={ringSize} />
                    <OrbitRing radius={92} duration={3.2} />
                    <OrbitRing radius={108} duration={4.1} delay={0.2} dotClassName="bg-amber-300/80" />
                    <OrbitRing radius={124} duration={5.4} delay={0.35} dotClassName="bg-teal-400/70" />
                    <LogoRipples />
                    <motion.div
                      className="pointer-events-none absolute inset-10 rounded-full border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                      animate={{ scale: [1, 1.05, 1], opacity: [0.35, 0.7, 0.35] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </>
                ) : null}

                <motion.div
                  className="relative z-10"
                  initial={reduceMotion ? false : { scale: 0.82, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...SPRING, delay: 0.28 }}
                >
                  <motion.div
                    animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-sm">
                      <InvestoLogo
                        height={logoHeight}
                        glow
                        onDark
                        className="relative z-10"
                        resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
                      />
                      {!reduceMotion ? (
                        <div className="auth-signin-loader__shimmer pointer-events-none absolute inset-0 z-20 mix-blend-screen" aria-hidden />
                      ) : null}
                    </div>
                  </motion.div>
                </motion.div>
              </div>

              <div className="mt-10 w-full text-center md:pl-4 md:text-left">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={statusText}
                    className="font-display text-2xl font-semibold tracking-tight text-white md:text-3xl"
                    initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
                    transition={{ duration: 0.26 }}
                  >
                    {statusText}
                  </motion.p>
                </AnimatePresence>

                <motion.p
                  className="mt-2 text-sm text-slate-400"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 }}
                >
                  Securing your session - please wait
                </motion.p>

                <motion.div
                  className="mx-auto mt-8 h-px w-full max-w-xs overflow-hidden bg-white/10 md:mx-0"
                  initial={{ opacity: 0, scaleX: 0.6 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ delay: 0.4, duration: 0.5 }}
                >
                  {!reduceMotion ? (
                    <motion.span
                      className="block h-full w-2/5 bg-gradient-to-r from-transparent via-amber-400/90 to-transparent"
                      animate={{ x: ['-120%', '280%'] }}
                      transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  ) : (
                    <span className="block h-full w-1/3 bg-amber-400/70" />
                  )}
                </motion.div>
              </div>
            </motion.div>
          </div>

          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
