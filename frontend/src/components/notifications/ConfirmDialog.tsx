/**
 * Confirm Dialog Component
 * Modal for confirming dangerous or important actions
 * 
 * Usage:
 * const { confirm } = useConfirmDialog();
 * if (await confirm('Delete lead?', 'Cannot be undone')) {
 *   await deleteLead();
 * }
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Button, { ButtonVariant } from '../ui/Button';
import './ConfirmDialog.css';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) {
    return null;
  }

  const getVariantDetails = (v: ConfirmVariant) => {
    switch (v) {
      case 'danger':
        return { color: 'danger', icon: AlertTriangle };
      case 'warning':
        return { color: 'warning', icon: AlertTriangle };
      default:
        return { color: 'info', icon: AlertTriangle };
    }
  };

  const details = getVariantDetails(variant);
  const buttonVariant: ButtonVariant = variant === 'danger' ? 'danger' : 'primary';

  return (
    <div className="confirm-dialog-overlay" onClick={onCancel} role="presentation">
      <div
        className={`confirm-dialog confirm-dialog--${variant}`}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        <div className="confirm-dialog__header">
          <details.icon className="confirm-dialog__icon" aria-hidden="true" />
          <h2 id="dialog-title" className="confirm-dialog__title">
            {title}
          </h2>
        </div>

        <p id="dialog-description" className="confirm-dialog__message">
          {message}
        </p>

        <div className="confirm-dialog__actions">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={buttonVariant}
            onClick={onConfirm}
            loading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
