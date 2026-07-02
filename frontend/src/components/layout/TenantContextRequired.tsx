import React from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dashboardPath } from '../../config/navigation.config';

interface TenantContextRequiredProps {
  surface: string;
  description?: string;
}

const TenantContextRequired: React.FC<TenantContextRequiredProps> = ({ surface, description }) => (
  <div className="investo-page flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4 py-10">
    <section className="w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-investo sm:p-8">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-amber-700">
        <Building2 className="h-6 w-6" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Tenant context required</p>
      <h1 className="mt-2 text-2xl font-bold text-ink-primary">Select an agency before opening {surface}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-amber-950">
        {description ||
          'This page reads agency data. Pick an agency from Tenant context so every request is scoped to the correct company.'}
      </p>
      <div className="mt-6 flex justify-center">
        <Link to={dashboardPath('/companies')} className="investo-btn-primary inline-flex items-center justify-center gap-2">
          Open companies
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  </div>
);

export default TenantContextRequired;
