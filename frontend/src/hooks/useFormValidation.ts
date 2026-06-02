/**
 * useFormValidation Hook
 * Handles form state, validation on blur, and submission
 * 
 * Usage:
 * const { values, errors, touched, handleChange, handleBlur, handleSubmit } = useFormValidation({
 *   initialValues: { email: '', password: '' },
 *   validate: (values) => {
 *     const errors: Record<string, string> = {};
 *     if (!values.email) errors.email = 'Required';
 *     if (!values.password) errors.password = 'Required';
 *     return errors;
 *   },
 *   onSubmit: async (values) => {
 *     await api.login(values);
 *   }
 * });
 */

import { useState, useCallback } from 'react';

export interface UseFormValidationOptions<T> {
  initialValues: T;
  validate?: (values: T) => Record<string, string>;
  onSubmit: (values: T) => Promise<void> | void;
}

export interface UseFormValidationReturn<T> {
  values: T;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isSubmitting: boolean;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  handleSubmit: (e?: React.FormEvent<HTMLFormElement>) => Promise<void>;
  setFieldValue: (name: keyof T, value: any) => void;
  resetForm: () => void;
}

export function useFormValidation<T extends Record<string, any>>(
  options: UseFormValidationOptions<T>
): UseFormValidationReturn<T> {
  const [values, setValues] = useState<T>(options.initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateForm = useCallback(
    (formValues: T) => {
      if (!options.validate) {
        return {};
      }
      return options.validate(formValues);
    },
    [options]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value, type } = e.target;
      const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;

      setValues((prev) => ({
        ...prev,
        [name]: newValue,
      }));

      // Validate on change if field was already touched
      if (touched[name]) {
        const newErrors = validateForm({
          ...values,
          [name]: newValue,
        });
        setErrors(newErrors);
      }
    },
    [values, touched, validateForm]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const { name } = e.target;

      setTouched((prev) => ({
        ...prev,
        [name]: true,
      }));

      // Validate on blur
      const newErrors = validateForm(values);
      setErrors(newErrors);
    },
    [values, validateForm]
  );

  const handleSubmit = useCallback(
    async (e?: React.FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
      }

      // Mark all fields as touched
      const allTouched = Object.keys(values).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {} as Record<string, boolean>
      );
      setTouched(allTouched);

      // Validate form
      const newErrors = validateForm(values);
      setErrors(newErrors);

      // Don't submit if there are errors
      if (Object.keys(newErrors).length > 0) {
        return;
      }

      // Submit
      setIsSubmitting(true);
      try {
        await options.onSubmit(values);
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, validateForm, options]
  );

  const setFieldValue = useCallback((name: keyof T, value: any) => {
    setValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const resetForm = useCallback(() => {
    setValues(options.initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [options.initialValues]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    setFieldValue,
    resetForm,
  };
}

export default useFormValidation;
