import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  LEAD_STATUS_ORDER,
  LEAD_TRANSITIONS,
  formatLeadStatus,
  leadStatusStyle,
  type LeadStatusValue,
} from '../../config/leadStatus.config';

interface LeadStatusSelectProps {
  value: string;
  disabled?: boolean;
  loading?: boolean;
  canForceAnyStatus?: boolean;
  onChange: (status: string) => void;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

function optionsForStatus(current: string, canForceAnyStatus: boolean): string[] {
  const normalizedCurrent = String(current || '').trim() || 'new';

  if (canForceAnyStatus) {
    if (LEAD_STATUS_ORDER.includes(normalizedCurrent as LeadStatusValue)) {
      return [...LEAD_STATUS_ORDER];
    }
    return [...LEAD_STATUS_ORDER, normalizedCurrent];
  }

  const allowed = LEAD_TRANSITIONS[normalizedCurrent as LeadStatusValue] ?? [];
  const reopen: LeadStatusValue[] = normalizedCurrent === 'closed_lost' ? ['contacted'] : [];
  const merged = new Set<string>([normalizedCurrent, ...allowed, ...reopen]);
  const options = [...merged].filter(
    (s) => LEAD_STATUS_ORDER.includes(s as LeadStatusValue) || s === normalizedCurrent,
  );
  return options.length > 0 ? options : [normalizedCurrent];
}

export default function LeadStatusSelect({
  value,
  disabled,
  loading,
  canForceAnyStatus = false,
  onChange,
  onClick,
  className = '',
}: LeadStatusSelectProps) {
  const options = optionsForStatus(value, canForceAnyStatus);

  return (
    <div className={`relative inline-flex items-center ${className}`} onClick={onClick}>
      <select
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className={`appearance-none cursor-pointer rounded-lg border pl-3 pr-8 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-brand-500 disabled:opacity-50 ${leadStatusStyle(value)}`}
        title={canForceAnyStatus ? 'Set any pipeline status' : 'Change lead status'}
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {formatLeadStatus(status)}
          </option>
        ))}
      </select>
      {loading ? (
        <Loader2 className="absolute right-2 h-3.5 w-3.5 animate-spin text-ink-muted pointer-events-none" />
      ) : null}
    </div>
  );
}
