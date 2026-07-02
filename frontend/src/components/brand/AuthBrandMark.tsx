import { motion, useReducedMotion } from 'motion/react';
import InvestoLogo from './InvestoLogo';

type AuthBrandMarkProps = {
  height?: number;
  className?: string;
  align?: 'center' | 'start';
};

export default function AuthBrandMark({
  height = 52,
  className = '',
  align = 'center',
}: AuthBrandMarkProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={`flex w-full ${align === 'center' ? 'justify-center' : 'justify-center lg:justify-start'} ${className}`.trim()}
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative inline-flex rounded-2xl bg-black p-1.5 shadow-[0_18px_45px_rgba(14,165,233,0.22)] ring-1 ring-cyan-200/25"
      >
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl bg-cyan-300/15 blur-md"
          animate={reduceMotion ? undefined : { opacity: [0.18, 0.5, 0.18], scale: [0.98, 1.03, 0.98] }}
          transition={reduceMotion ? undefined : { duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <InvestoLogo height={height} className="relative rounded-xl" />
      </motion.div>
    </div>
  );
}
