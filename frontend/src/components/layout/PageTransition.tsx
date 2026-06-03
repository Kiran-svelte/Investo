import { motion, useReducedMotion } from 'motion/react';
import { useLocation, Outlet } from 'react-router-dom';

/** Animates route content inside the dashboard shell (all roles). */
export default function PageTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <Outlet />;
  }

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="investo-page-enter"
    >
      <Outlet />
    </motion.div>
  );
}
