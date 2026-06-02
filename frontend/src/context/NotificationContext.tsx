/**
 * Notification Context
 * Manages toast notifications globally
 * Provides hook: useNotification()
 */

import React, { createContext, useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface NotificationContextType {
  toasts: Toast[];
  notify: (message: string, type: ToastType, duration?: number) => string;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, type: ToastType, duration = 4000): string => {
    const id = `toast_${Date.now()}_${Math.random()}`;

    const newToast: Toast = {
      id,
      message,
      type,
      duration,
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const success = useCallback((message: string, duration?: number) => {
    notify(message, 'success', duration);
  }, [notify]);

  const error = useCallback((message: string, duration?: number) => {
    notify(message, 'error', duration);
  }, [notify]);

  const warning = useCallback((message: string, duration?: number) => {
    notify(message, 'warning', duration);
  }, [notify]);

  const info = useCallback((message: string, duration?: number) => {
    notify(message, 'info', duration);
  }, [notify]);

  const value: NotificationContextType = {
    toasts,
    notify,
    success,
    error,
    warning,
    info,
    dismiss,
    clear,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
