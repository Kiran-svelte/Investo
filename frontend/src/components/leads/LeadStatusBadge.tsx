import React from 'react';
import { formatLeadStatus, leadStatusStyle } from '../../config/leadStatus.config';

interface LeadStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}

export default function LeadStatusBadge({ status, size = 'sm', className = '' }: LeadStatusBadgeProps) {
  const sizeClass = size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full border ${sizeClass} ${leadStatusStyle(status)} ${className}`}
    >
      {formatLeadStatus(status)}
    </span>
  );
}
