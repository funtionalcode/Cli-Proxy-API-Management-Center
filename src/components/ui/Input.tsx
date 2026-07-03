import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  rightElement?: ReactNode;
}

export function Input({ label, hint, error, rightElement, className = '', id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [rest['aria-describedby'], errorId, hintId].filter(Boolean).join(' ') || undefined;
  const inputClassName = [
    'input',
    rightElement ? 'input-with-right-element' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="form-group">
      {label && <label htmlFor={inputId}>{label}</label>}
      <div className="input-wrapper">
        <input
          id={inputId}
          className={inputClassName}
          aria-invalid={Boolean(error) || rest['aria-invalid']}
          aria-describedby={describedBy}
          {...rest}
        />
        {rightElement && <div className="input-right-element">{rightElement}</div>}
      </div>
      {hint && (
        <div id={hintId} className="hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="error-box">
          {error}
        </div>
      )}
    </div>
  );
}
