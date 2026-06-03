import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  label?: string;
  content: React.ReactNode;
  className?: string;
}

/** Accessible info icon — explains fields on hover/focus (e.g. persuasion level). */
const InfoTooltip: React.FC<InfoTooltipProps> = ({ label = 'More information', content, className = '' }) => {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:text-brand-800 focus:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-surface-border bg-ink-primary px-3 py-2 text-xs font-normal leading-relaxed text-surface-base shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  );
};

export default InfoTooltip;
