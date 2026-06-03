import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
  className?: string;
}

const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  total,
  onPageChange,
  label = 'items',
  className = '',
}) => {
  if (totalPages <= 1 && total === 0) return null;

  const safeTotalPages = Math.max(1, totalPages);

  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <p className="text-sm text-ink-muted">
        Page {page} of {safeTotalPages} ({total} {label})
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-elevated px-3 py-1.5 text-sm text-ink-secondary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-surface-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, page + 1))}
          disabled={page >= safeTotalPages}
          className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-elevated px-3 py-1.5 text-sm text-ink-secondary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-surface-muted"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
