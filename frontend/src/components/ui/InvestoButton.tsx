import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface InvestoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'investo-btn-primary',
  secondary: 'investo-btn-secondary',
  danger:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50',
};

const InvestoButton = React.forwardRef<HTMLButtonElement, InvestoButtonProps>(
  (
    {
      variant = 'primary',
      loading = false,
      loadingLabel,
      fullWidth = false,
      className = '',
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const label =
      loadingLabel
      ?? (variant === 'primary' ? t('loading.button_saving', { defaultValue: 'Saving…' }) : t('loading.button_loading', { defaultValue: 'Please wait…' }));

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`${variantClass[variant]} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
        {...rest}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{label}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);

InvestoButton.displayName = 'InvestoButton';

export default InvestoButton;
