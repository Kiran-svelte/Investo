import React from 'react';
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
      <div className={`investo-page ${className}`.trim()}>
        <div className="investo-skeleton-grid">
          <SkeletonLoader type={skeleton} count={count} animated />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
