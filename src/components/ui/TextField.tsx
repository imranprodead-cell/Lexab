import type { InputHTMLAttributes } from 'react';
import styles from './ui.module.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
}

/** Labelled text input with inline validation error. */
export function TextField({ label, error, id, className = '', ...rest }: TextFieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <input
        id={fieldId}
        className={`${styles.input} ${error ? styles.inputError : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <span className={styles.errorText}>{error}</span> : null}
    </div>
  );
}
