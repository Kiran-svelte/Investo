/**
 * Toast Container
 * Displays all active toasts at bottom-right
 * Place this near root of app (inside NotificationProvider)
 */

import React from 'react';
import Toast from './Toast';
import { useNotification } from '../../hooks/useNotification';
import './ToastContainer.css';

const ToastContainer: React.FC = () => {
  const { toasts, dismiss } = useNotification();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
};

export default ToastContainer;
