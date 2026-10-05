import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
};

export function Button({ variant = 'secondary', size = 'md', loading, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  group,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /**
   * 选项组（单选/多选按钮组）必须用 group 而不是 label：
   * 把 role="radio" 包进 <label> 会让浏览器把字段标题算成第一个选项的可访问名。
   */
  group?: boolean;
  children: ReactNode;
}) {
  const labelNode = (
    <span className="field__label">
      {label}
      {required ? <span className="field__required">*</span> : null}
    </span>
  );
  const tail = (
    <>
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );

  if (group) {
    return (
      <div className="field" role="group" aria-label={label}>
        {labelNode}
        {children}
        {tail}
      </div>
    );
  }

  return (
    <label className="field">
      {labelNode}
      {children}
      {tail}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={['input', props.className].filter(Boolean).join(' ')} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={['input', 'input--area', props.className].filter(Boolean).join(' ')} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={['input', 'input--select', props.className].filter(Boolean).join(' ')} />;
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon" aria-hidden="true">{icon}</div> : null}
      <h3 className="empty__title">{title}</h3>
      {description ? <p className="empty__desc">{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: Math.max(12, size * 0.4) }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function Tag({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warn' | 'success' | 'muted' }) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`segmented__item${value === opt.value ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <span aria-hidden="true">{opt.icon}</span> : null}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
