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

function optionsForStatus(current: string, canForceAnyStatus: boolean): LeadStatusValue[] {
  if (canForceAnyStatus) {
    return [...LEAD_STATUS_ORDER];
  }
  const allowed = LEAD_TRANSITIONS[current as LeadStatusValue] ?? [];
  const reopen: LeadStatusValue[] = current === 'closed_lost' ? ['contacted'] : [];
  const merged = [...new Set([current as LeadStatusValue, ...allowed, ...reopen])];
  return merged.filter((s) => LEAD_STATUS_ORDER.includes(s));
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
        className={`appearance-none cursor-pointer rounded-lg border pl-3 pr-8 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${leadStatusStyle(value)}`}
        title={canForceAnyStatus ? 'Set any pipeline status' : 'Change lead status'}
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {formatLeadStatus(status)}
          </option>
        ))}
      </select>
      {loading ? (
        <Loader2 className="absolute right-2 h-3.5 w-3.5 animate-spin text-gray-500 pointer-events-none" />
      ) : null}
    </div>
  );
}
