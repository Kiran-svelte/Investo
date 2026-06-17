/**
 * AgencyInvitesPage
 *
 * Super Admin page for managing all agency invitations and their billing status.
 * Features:
 *   - Overview of all company billing statuses (trial, active, past_due, suspended)
 *   - Create new agency invite with custom price negotiation
 *   - Copy invite link
 *   - Per-company actions: suspend, reactivate, update price
 *
 * Only accessible to users with role='super_admin'.
 * Mounted at /dashboard/agency-invites
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  Ban,
  Play,
  DollarSign,
  X,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Users,
} from 'lucide-react';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

interface AgencyInvite {
  id: string;
  agencyName: string;
  adminEmail: string;
  expiresAt: string;
  acceptedAt: string | null;
  companyId: string | null;
  negotiatedMonthlyPrice: number | null;
  inviteUrl: string;
}

interface CompanyBillingOverview {
  companyId: string;
  companyName: string;
  companySlug: string;
  companyStatus: string;
  userCount: number;
  createdAt: string;
  billingStatus: string;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  monthlyTotal: number | null;
  nextBillingDate: string | null;
  paymentMethod: string | null;
  negotiatedMonthlyPrice: number | null;
  basePriceMonthly: number | null;
  seatCount: number | null;
}

/** Formats INR amount. */
function formatCurrency(amount: number | null): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Formats ISO date string. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const BILLING_STATUS_BADGE: Record<string, React.ReactElement> = {
  trialing: (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Clock className="h-3 w-3" /> Trial
    </span>
  ),
  active: (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      <CheckCircle className="h-3 w-3" /> Active
    </span>
  ),
  past_due: (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
      <AlertTriangle className="h-3 w-3" /> Past Due
    </span>
  ),
  suspended: (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      <XCircle className="h-3 w-3" /> Suspended
    </span>
  ),
  no_subscription: (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      — No Sub
    </span>
  ),
};

/** Create invite modal state. */
interface CreateInviteForm {
  agencyName: string;
  adminEmail: string;
  negotiatedMonthlyPrice: string;
  notes: string;
}

const DEFAULT_INVITE_FORM: CreateInviteForm = {
  agencyName: '',
  adminEmail: '',
  negotiatedMonthlyPrice: '',
  notes: '',
};

const AgencyInvitesPage: React.FC = () => {
  const [invites, setInvites] = useState<AgencyInvite[]>([]);
  const [billing, setBilling] = useState<CompanyBillingOverview[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create invite modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateInviteForm>(DEFAULT_INVITE_FORM);
  const [createFormErrors, setCreateFormErrors] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreatedInviteUrl, setLastCreatedInviteUrl] = useState<string | null>(null);

  // Update price modal
  const [updatingPriceFor, setUpdatingPriceFor] = useState<CompanyBillingOverview | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);

  // Action loading states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await api.get<{ data: AgencyInvite[] }>('/agency-invites');
      setInvites(res.data.data ?? []);
    } catch (err) {
      setPageError(getApiErrorMessage(err, 'Failed to load invites.'));
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  const loadBilling = useCallback(async () => {
    setLoadingBilling(true);
    try {
      const res = await api.get<{ data: CompanyBillingOverview[] }>('/billing-admin/overview');
      setBilling(res.data.data ?? []);
    } catch (err) {
      setPageError(getApiErrorMessage(err, 'Failed to load billing overview.'));
    } finally {
      setLoadingBilling(false);
    }
  }, []);

  useEffect(() => {
    void loadInvites();
    void loadBilling();
  }, [loadInvites, loadBilling]);

  const handleCopyInviteUrl = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const validateCreateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!createForm.agencyName.trim() || createForm.agencyName.trim().length < 2) {
      errors.agencyName = 'Agency name must be at least 2 characters.';
    }
    if (!createForm.adminEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.adminEmail)) {
      errors.adminEmail = 'Enter a valid email address.';
    }
    if (createForm.negotiatedMonthlyPrice) {
      const price = parseFloat(createForm.negotiatedMonthlyPrice);
      if (isNaN(price) || price <= 0) {
        errors.negotiatedMonthlyPrice = 'Enter a valid positive price.';
      }
    }
    setCreateFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateInvite = async () => {
    if (!validateCreateForm()) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const payload: Record<string, unknown> = {
        agency_name: createForm.agencyName.trim(),
        admin_email: createForm.adminEmail.trim().toLowerCase(),
      };
      if (createForm.negotiatedMonthlyPrice) {
        payload.negotiated_monthly_price = parseFloat(createForm.negotiatedMonthlyPrice);
      }
      if (createForm.notes.trim()) {
        payload.notes = createForm.notes.trim();
      }

      const res = await api.post<{ data: { inviteUrl: string } }>('/agency-invites', payload);
      setLastCreatedInviteUrl(res.data.data.inviteUrl);
      setCreateForm(DEFAULT_INVITE_FORM);
      void loadInvites();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Failed to create invite.'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSuspend = async (companyId: string) => {
    setActionLoadingId(companyId);
    try {
      await api.post(`/billing-admin/companies/${companyId}/suspend`);
      void loadBilling();
    } catch (err) {
      setPageError(getApiErrorMessage(err, 'Failed to suspend company.'));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReactivate = async (companyId: string) => {
    setActionLoadingId(companyId);
    try {
      await api.post(`/billing-admin/companies/${companyId}/reactivate`);
      void loadBilling();
    } catch (err) {
      setPageError(getApiErrorMessage(err, 'Failed to reactivate company.'));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleUpdatePrice = async () => {
    if (!updatingPriceFor) return;
    const price = parseFloat(newPrice);
    if (isNaN(price) || price <= 0) {
      setPriceUpdateError('Enter a valid price greater than 0.');
      return;
    }
    setIsUpdatingPrice(true);
    setPriceUpdateError(null);
    try {
      await api.patch(`/billing-admin/companies/${updatingPriceFor.companyId}/price`, {
        negotiated_monthly_price: price,
      });
      setUpdatingPriceFor(null);
      setNewPrice('');
      void loadBilling();
    } catch (err) {
      setPriceUpdateError(getApiErrorMessage(err, 'Failed to update price.'));
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  // Stats summary
  const stats = {
    total: billing.length,
    trialing: billing.filter((b) => b.billingStatus === 'trialing').length,
    active: billing.filter((b) => b.billingStatus === 'active').length,
    pastDue: billing.filter((b) => b.billingStatus === 'past_due').length,
    suspended: billing.filter((b) => b.billingStatus === 'suspended').length,
  };

  return (
    <div className="investo-page space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">Agency Invites &amp; Billing</h1>
          <p className="text-ink-muted text-sm mt-1">
            Manage agency onboarding, pricing, and subscription status.
          </p>
        </div>
        <button
          type="button"
          id="create-invite-btn"
          onClick={() => {
            setShowCreateModal(true);
            setLastCreatedInviteUrl(null);
            setCreateError(null);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Create Invite
        </button>
      </div>

      {pageError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {pageError}
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Agencies', value: stats.total, color: 'text-gray-700', bg: 'bg-gray-50' },
          { label: 'Trialing', value: stats.trialing, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'Active', value: stats.active, color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Past Due', value: stats.pastDue, color: 'text-orange-700', bg: 'bg-orange-50' },
          { label: 'Suspended', value: stats.suspended, color: 'text-red-700', bg: 'bg-red-50' },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl ${stat.bg} border border-transparent p-4 text-center`}
          >
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ─── Billing Overview Table ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink-primary">All Agencies</h2>
          <button
            type="button"
            id="refresh-billing-btn"
            onClick={() => void loadBilling()}
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-primary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingBilling ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="investo-table-wrap">
          {loadingBilling ? (
            <div className="flex items-center justify-center py-10 gap-2 text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : billing.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-ink-muted gap-2">
              <Building2 className="h-10 w-10 text-ink-faint" />
              <p className="text-sm">No agencies yet. Create an invite to get started.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="investo-table-head border-b border-surface-border">
                <tr>
                  {['Agency', 'Status', 'Users', 'Price/mo', 'Trial / Next Billing', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {billing.map((row) => {
                  const isActioning = actionLoadingId === row.companyId;
                  return (
                    <tr key={row.companyId} className="hover:bg-surface-muted">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink-primary text-sm">{row.companyName}</p>
                        <p className="text-xs text-ink-muted">{row.companySlug}</p>
                      </td>
                      <td className="px-4 py-3">
                        {BILLING_STATUS_BADGE[row.billingStatus] ?? (
                          <span className="text-xs text-gray-400">{row.billingStatus}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-sm text-ink-secondary">
                          <Users className="h-3.5 w-3.5" />
                          {row.seatCount ?? row.userCount}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-primary">
                        {row.negotiatedMonthlyPrice != null ? (
                          <span title="Custom negotiated price">
                            {formatCurrency(row.negotiatedMonthlyPrice)}{' '}
                            <span className="text-xs text-blue-500">*</span>
                          </span>
                        ) : (
                          formatCurrency(row.monthlyTotal)
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-secondary">
                        {row.billingStatus === 'trialing' ? (
                          <span>
                            {row.trialDaysRemaining ?? 0}d left
                            <span className="block text-ink-faint">{formatDate(row.trialEndsAt)}</span>
                          </span>
                        ) : (
                          formatDate(row.nextBillingDate)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {/* Update price */}
                          <button
                            type="button"
                            id={`update-price-${row.companyId}`}
                            title="Update negotiated price"
                            onClick={() => {
                              setUpdatingPriceFor(row);
                              setNewPrice(
                                row.negotiatedMonthlyPrice?.toString() ??
                                  row.monthlyTotal?.toString() ??
                                  '',
                              );
                              setPriceUpdateError(null);
                            }}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <DollarSign className="h-3.5 w-3.5" />
                          </button>

                          {/* Suspend / Reactivate */}
                          {row.billingStatus !== 'suspended' ? (
                            <button
                              type="button"
                              id={`suspend-${row.companyId}`}
                              title="Suspend account"
                              disabled={isActioning}
                              onClick={() => void handleSuspend(row.companyId)}
                              className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                            >
                              {isActioning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              id={`reactivate-${row.companyId}`}
                              title="Reactivate account"
                              disabled={isActioning}
                              onClick={() => void handleReactivate(row.companyId)}
                              className="rounded-lg p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40"
                            >
                              {isActioning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── Pending Invites Table ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-ink-primary mb-3">Pending Invites</h2>
        <div className="investo-table-wrap">
          {loadingInvites ? (
            <div className="flex items-center justify-center py-8 gap-2 text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading invites…
            </div>
          ) : invites.filter((i) => !i.acceptedAt).length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-muted">
              No pending invites. Create one above.
            </div>
          ) : (
            <table className="w-full">
              <thead className="investo-table-head border-b border-surface-border">
                <tr>
                  {['Agency', 'Email', 'Negotiated Price', 'Expires', 'Invite Link'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {invites
                  .filter((i) => !i.acceptedAt)
                  .map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3 font-medium text-ink-primary text-sm">
                        {inv.agencyName}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-secondary">{inv.adminEmail}</td>
                      <td className="px-4 py-3 text-sm text-ink-secondary">
                        {formatCurrency(inv.negotiatedMonthlyPrice)}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-secondary">
                        {formatDate(inv.expiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <a
                            href={inv.inviteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            id={`invite-link-${inv.id}`}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </a>
                          <button
                            type="button"
                            id={`copy-invite-${inv.id}`}
                            onClick={() => void handleCopyInviteUrl(inv.id, inv.inviteUrl)}
                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            {copiedId === inv.id ? (
                              <><Check className="h-3 w-3 text-green-500" /> Copied</>
                            ) : (
                              <><Copy className="h-3 w-3" /> Copy</>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── Create Invite Modal ────────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-invite-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 id="create-invite-modal-title" className="text-lg font-bold text-gray-900">
                Create Agency Invite
              </h2>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); setLastCreatedInviteUrl(null); }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {lastCreatedInviteUrl ? (
              <div className="text-center py-4">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="font-semibold text-gray-800">Invite created!</p>
                <p className="text-sm text-gray-500 mt-1 mb-4">
                  An invite email has been sent. Share this link directly:
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 break-all">
                  <span className="flex-1">{lastCreatedInviteUrl}</span>
                  <button
                    type="button"
                    id="copy-new-invite-url-btn"
                    onClick={() => void navigator.clipboard.writeText(lastCreatedInviteUrl)}
                    className="flex-shrink-0 text-blue-600 hover:text-blue-700"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  id="create-invite-done-btn"
                  onClick={() => { setShowCreateModal(false); setLastCreatedInviteUrl(null); }}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Agency name */}
                <div>
                  <label htmlFor="invite-agency-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Agency name *
                  </label>
                  <input
                    id="invite-agency-name"
                    type="text"
                    value={createForm.agencyName}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, agencyName: e.target.value }))
                    }
                    placeholder="e.g. Sunrise Realty"
                    className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors ${
                      createFormErrors.agencyName
                        ? 'border-red-300'
                        : 'border-gray-300 focus:border-blue-400'
                    }`}
                  />
                  {createFormErrors.agencyName && (
                    <p className="text-xs text-red-500 mt-1">{createFormErrors.agencyName}</p>
                  )}
                </div>

                {/* Admin email */}
                <div>
                  <label htmlFor="invite-admin-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Admin email *
                  </label>
                  <input
                    id="invite-admin-email"
                    type="email"
                    value={createForm.adminEmail}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, adminEmail: e.target.value }))
                    }
                    placeholder="admin@agency.com"
                    className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors ${
                      createFormErrors.adminEmail
                        ? 'border-red-300'
                        : 'border-gray-300 focus:border-blue-400'
                    }`}
                  />
                  {createFormErrors.adminEmail && (
                    <p className="text-xs text-red-500 mt-1">{createFormErrors.adminEmail}</p>
                  )}
                </div>

                {/* Negotiated price */}
                <div>
                  <label htmlFor="invite-price" className="block text-sm font-medium text-gray-700 mb-1">
                    Negotiated price/month{' '}
                    <span className="text-xs text-gray-400">(optional — defaults to ₹12,999)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                    <input
                      id="invite-price"
                      type="number"
                      min="1"
                      step="1"
                      value={createForm.negotiatedMonthlyPrice}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, negotiatedMonthlyPrice: e.target.value }))
                      }
                      placeholder="12999"
                      className={`w-full rounded-xl border pl-7 pr-4 py-2.5 text-sm outline-none transition-colors ${
                        createFormErrors.negotiatedMonthlyPrice
                          ? 'border-red-300'
                          : 'border-gray-300 focus:border-blue-400'
                      }`}
                    />
                  </div>
                  {createFormErrors.negotiatedMonthlyPrice && (
                    <p className="text-xs text-red-500 mt-1">
                      {createFormErrors.negotiatedMonthlyPrice}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    Includes 5 users. Additional users at ₹499/user/month.
                  </p>
                </div>

                {/* Notes */}
                <div>
                  <label htmlFor="invite-notes" className="block text-sm font-medium text-gray-700 mb-1">
                    Internal notes{' '}
                    <span className="text-xs text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    id="invite-notes"
                    rows={2}
                    value={createForm.notes}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    placeholder="Negotiation context, referral source, etc."
                    className="w-full rounded-xl border border-gray-300 focus:border-blue-400 px-4 py-2.5 text-sm outline-none resize-none transition-colors"
                  />
                </div>

                {createError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    {createError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    id="create-invite-cancel-btn"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="create-invite-submit-btn"
                    disabled={isCreating}
                    onClick={() => void handleCreateInvite()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {isCreating ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
                    ) : (
                      'Create Invite'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Update Price Modal ─────────────────────────────────────────────── */}
      {updatingPriceFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-price-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 id="update-price-modal-title" className="text-base font-bold text-gray-900">
                Update Price
              </h2>
              <button
                type="button"
                onClick={() => setUpdatingPriceFor(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Setting a negotiated price for{' '}
              <strong className="text-gray-700">{updatingPriceFor.companyName}</strong>.
            </p>
            <div className="relative mb-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
              <input
                id="update-price-input"
                type="number"
                min="1"
                value={newPrice}
                onChange={(e) => { setNewPrice(e.target.value); setPriceUpdateError(null); }}
                className="w-full rounded-xl border border-gray-300 focus:border-blue-400 pl-7 pr-4 py-2.5 text-sm outline-none"
              />
            </div>
            {priceUpdateError && (
              <p className="text-xs text-red-500 mb-3">{priceUpdateError}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setUpdatingPriceFor(null)}
                className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                id="update-price-submit-btn"
                disabled={isUpdatingPrice}
                onClick={() => void handleUpdatePrice()}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isUpdatingPrice ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgencyInvitesPage;
