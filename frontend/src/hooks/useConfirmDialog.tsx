/**
 * useConfirmDialog Hook
 * Provides confirm dialog functionality
 * 
 * Usage:
 * const { confirm } = useConfirmDialog();
 * const confirmed = await confirm('Delete?', 'Cannot be undone');
 */

import { useState } from 'react';
import ConfirmDialog, { ConfirmVariant } from '../components/notifications/ConfirmDialog';

export interface UseConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dialogState, setDialogState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant: ConfirmVariant;
    resolve?: (value: boolean) => void;
  }>({
    title: '',
    message: '',
    variant: 'danger',
  });

  const confirm = (
    title: string,
    message: string,
    options: Omit<UseConfirmDialogOptions, 'title' | 'message'> = {}
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        title,
        message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        variant: options.variant || 'danger',
        resolve,
      });
      setIsOpen(true);
    });
  };

  const handleConfirm = () => {
    setIsLoading(true);
    setTimeout(() => {
      dialogState.resolve?.(true);
      setIsOpen(false);
      setIsLoading(false);
    }, 300);
  };

  const handleCancel = () => {
    dialogState.resolve?.(false);
    setIsOpen(false);
  };

  const Dialog = (
    <ConfirmDialog
      isOpen={isOpen}
      title={dialogState.title}
      message={dialogState.message}
      confirmLabel={dialogState.confirmLabel}
      cancelLabel={dialogState.cancelLabel}
      variant={dialogState.variant}
      isLoading={isLoading}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, Dialog };
}

export default useConfirmDialog;
