/**
 * Button Component
 * With loading state, disabled state, hover, and keyboard support
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      fullWidth = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const baseClasses = 'button button-transition';
    const variantClasses = `button--${variant}`;
    const sizeClasses = `button--${size}`;
    const widthClasses = fullWidth ? 'button--full-width' : '';
    const stateClasses = isDisabled ? 'button--disabled' : '';

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses} ${sizeClasses} ${widthClasses} ${stateClasses} ${className}`}
        disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading && <Loader2 className="button__loader" aria-hidden="true" />}
        <span className="button__content">{children}</span>
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
