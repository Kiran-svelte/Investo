import React from 'react';
import { motion } from '../../lib/motion';
import SkeletonLoader, { type SkeletonType } from '../loading/SkeletonLoader';

interface PageLoaderProps {
  loading: boolean;
  children: React.ReactNode;
  skeleton?: SkeletonType;
  count?: number;
  className?: string;
}

/**
 * Global loading wrapper — use on data pages instead of bare spinners.
 */
export default function PageLoader({
  loading,
  children,
  skeleton = 'card',
  count = 4,
  className = '',
}: PageLoaderProps) {
  if (loading) {
    return (
      <motion.div
        className={`investo-page ${className}`.trim()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <div className="investo-skeleton-grid">
          <SkeletonLoader type={skeleton} count={count} animated />
        </div>
      </motion.div>
    );
  }

  return <>{children}</>;
}
