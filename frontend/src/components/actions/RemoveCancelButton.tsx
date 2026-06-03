import { Loader2, Trash2, X } from 'lucide-react';

type Variant = 'cancel' | 'delete';

interface RemoveCancelButtonProps {
  variant?: Variant;
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * Consistent cancel/delete control for user-created resources (drafts, uploads, etc.).
 */
export default function RemoveCancelButton({
  variant = 'cancel',
  label,
  loading = false,
  disabled = false,
  onClick,
  className = '',
}: RemoveCancelButtonProps) {
  const text = label ?? (variant === 'delete' ? 'Delete' : 'Cancel');
  const Icon = variant === 'delete' ? Trash2 : X;
  const color =
    variant === 'delete'
      ? 'text-red-700 border-red-200 hover:bg-red-50'
      : 'text-ink-secondary border-surface-border hover:bg-surface-muted';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50 ${color} ${className}`}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {text}
    </button>
  );
}
