/**
 * useNotification Hook
 * Access notification system from anywhere in the component tree
 * 
 * Usage:
 * const { success, error } = useNotification();
 * success('Lead created!');
 * error('Failed to update lead');
 */

import { useContext } from 'react';
import { NotificationContext, NotificationContextType } from '../context/NotificationContext';

export function useNotification(): NotificationContextType {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }

  return context;
}

export default useNotification;
