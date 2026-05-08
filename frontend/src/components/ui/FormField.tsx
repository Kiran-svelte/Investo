/**
 * Form Field Component
 * Wrapper for input fields with inline validation and error display
 * Validates on blur, shows errors only for touched fields
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import './FormField.css';

export interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  value: string;
  error?: string;
  touched?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
}

const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      label,
      name,
      type = 'text',
      value,
      error,
      touched = false,
      onChange,
      onBlur,
      required = false,
      hint,
      disabled = false,
      placeholder,
      autoComplete,
    },
    ref
  ) => {
    const hasError = Boolean(touched && error);
    const errorId = `${name}-error`;
    const hintId = `${name}-hint`;

    return (
      <div className="form-field">
        <label htmlFor={name} className="form-field__label">
          {label}
          {required && <span className="form-field__required" aria-label="required">*</span>}
        </label>

        <input
          ref={ref}
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={hasError ? 'true' : 'false'}
          aria-describedby={hasError ? errorId : hint ? hintId : undefined}
          className={`form-field__input ${hasError ? 'form-field__input--error' : ''}`}
        />

        {hint && !hasError && (
          <div id={hintId} className="form-field__hint">
            {hint}
          </div>
        )}

        {hasError && (
          <div id={errorId} className="form-field__error" role="alert">
            <AlertCircle className="form-field__error-icon" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }
);

FormField.displayName = 'FormField';

export default FormField;
