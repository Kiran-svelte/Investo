/**
 * Toast Component
 * Individual notification message with auto-dismiss
 */

import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Toast as ToastItem, ToastType } from '../../context/NotificationContext';
import './Toast.css';

interface ToastComponentProps extends ToastItem {
  onDismiss: (id: string) => void;
}

const ToastComponent: React.FC<ToastComponentProps> = ({
  id,
  message,
  type,
  onDismiss,
}) => {
  const getIcon = (toastType: ToastType) => {
    const iconProps = { className: 'toast__icon', 'aria-hidden': true } as const;
    switch (toastType) {
      case 'success':
        return <CheckCircle {...iconProps} />;
      case 'error':
        return <AlertCircle {...iconProps} />;
      case 'warning':
        return <AlertTriangle {...iconProps} />;
      case 'info':
        return <Info {...iconProps} />;
    }
  };

  return (
    <div className={`toast toast--${type}`} role="alert" aria-live="polite">
      {getIcon(type)}
      <span className="toast__message">{message}</span>
      <button
        className="toast__close"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        <X className="toast__close-icon" aria-hidden="true" />
      </button>
    </div>
  );
};

export default ToastComponent;
