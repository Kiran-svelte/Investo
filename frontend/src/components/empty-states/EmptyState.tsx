/**
 * Empty State Component
 * Generic wrapper for displaying empty, error, or no-results states
 * Shows icon, title, description, and optional action
 * 
 * Usage:
 * <EmptyState
 *   icon={<Database />}
 *   title="No leads yet"
 *   description="Start by connecting your CRM or importing data"
 *   action={{ label: 'Import leads', onClick: handleImport }}
 * />
 */

import React from 'react';
import Button from '../ui/Button';
import './EmptyState.css';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}) => {
  return (
    <div className={`empty-state ${className}`}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h2 className="empty-state__title">{title}</h2>
      {description && <p className="empty-state__description">{description}</p>}

      {(action || secondaryAction) && (
        <div className="empty-state__actions">
          {action && (
            <Button
              onClick={action.onClick}
              loading={action.loading}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outline"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
