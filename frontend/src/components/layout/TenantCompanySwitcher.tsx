import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown, X } from 'lucide-react';
import api from '../../services/api';
import { useTenantContext } from '../../context/TenantContext';

type CompanyOption = {
  id: string;
  name: string;
};

const TenantCompanySwitcher: React.FC = () => {
  const { targetCompanyId, targetCompanyName, setTargetCompany, clearTargetCompany, isPlatformAdmin } = useTenantContext();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    setLoading(true);
    api.get('/companies', { params: { limit: 200 } })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        setCompanies(
          rows
            .filter((row: { slug?: string | null }) => (row.slug || '').trim() !== 'investo-platform')
            .map((row: { id: string; name: string }) => ({ id: row.id, name: row.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-200">
        <Building2 className="h-4 w-4" />
        Tenant context
      </div>
      <p className="mt-1 text-xs text-amber-100/80">
        Platform admin: pick an agency before viewing leads, notifications, or analytics.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <select
            className="w-full appearance-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 pr-8 text-sm text-white"
            value={targetCompanyId || ''}
            disabled={loading}
            onChange={(e) => {
              const nextId = e.target.value || null;
              const match = companies.find((c) => c.id === nextId);
              setTargetCompany(nextId, match?.name ?? null);
            }}
          >
            <option value="">Select agency…</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
        </div>
        {targetCompanyId && (
          <button
            type="button"
            onClick={clearTargetCompany}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>
      {targetCompanyId && (
        <p className="mt-2 text-xs text-emerald-200">
          Active tenant: <span className="font-medium">{targetCompanyName || targetCompanyId}</span>
        </p>
      )}
    </div>
  );
};

export default TenantCompanySwitcher;
