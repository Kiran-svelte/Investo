/**
 * Skeleton Loader Component
 * Shows shape of content that's loading (never blank screens)
 * 
 * Usage:
 * <SkeletonLoader type="lead" count={3} />
 * <SkeletonLoader type="card" />
 */

import React from 'react';
import './SkeletonLoader.css';

export type SkeletonType = 'lead' | 'property' | 'conversation' | 'card' | 'line' | 'table-row';

export interface SkeletonLoaderProps {
  type: SkeletonType;
  count?: number;
  animated?: boolean;
  className?: string;
}

const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type,
  count = 1,
  animated = true,
  className = '',
}) => {
  const skeletons = Array.from({ length: count }, (_, i) => (
    <div key={i} className={`skeleton skeleton--${type} ${animated ? 'skeleton--animated' : ''}`}>
      {renderSkeleton(type)}
    </div>
  ));

  return <div className={`skeleton-container ${className}`}>{skeletons}</div>;
};

function renderSkeleton(type: SkeletonType): React.ReactNode {
  switch (type) {
    case 'lead':
      return (
        <div className="skeleton-content">
          <div className="skeleton-line skeleton-line--avatar"></div>
          <div className="skeleton-text">
            <div className="skeleton-line skeleton-line--short"></div>
            <div className="skeleton-line skeleton-line--medium"></div>
          </div>
        </div>
      );

    case 'property':
      return (
        <div className="skeleton-content">
          <div className="skeleton-line skeleton-line--image"></div>
          <div className="skeleton-text">
            <div className="skeleton-line skeleton-line--short"></div>
            <div className="skeleton-line skeleton-line--medium"></div>
            <div className="skeleton-line skeleton-line--short"></div>
          </div>
        </div>
      );

    case 'conversation':
      return (
        <div className="skeleton-content">
          <div className="skeleton-line skeleton-line--message skeleton-line--left"></div>
          <div className="skeleton-line skeleton-line--message skeleton-line--right"></div>
          <div className="skeleton-line skeleton-line--message skeleton-line--left"></div>
        </div>
      );

    case 'card':
      return (
        <div className="skeleton-content">
          <div className="skeleton-line skeleton-line--short"></div>
          <div className="skeleton-line"></div>
          <div className="skeleton-line"></div>
        </div>
      );

    case 'table-row':
      return (
        <div className="skeleton-content skeleton-content--row">
          <div className="skeleton-line skeleton-line--short"></div>
          <div className="skeleton-line skeleton-line--medium"></div>
          <div className="skeleton-line skeleton-line--short"></div>
          <div className="skeleton-line skeleton-line--short"></div>
        </div>
      );

    default:
      return <div className="skeleton-line"></div>;
  }
}

export default SkeletonLoader;
