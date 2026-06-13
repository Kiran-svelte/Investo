import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import Pagination from '../../components/common/Pagination';
import {
  Building2, Plus, Search, Users, Check, X,
  Edit2, Power, PowerOff, UserPlus, Trash2, Loader2,
} from 'lucide-react';
import { deleteCompany } from '../../services/resourceDelete';
import { useAuth } from '../../context/AuthContext';
import { useTenantContext } from '../../context/TenantContext';
import useConfirmDialog from '../../hooks/useConfirmDialog';

interface Company {
  id: string;
  name: string;
  slug: string;
  whatsappPhone: string | null;
  status: 'active' | 'inactive';
  planId: string | null;
  plan_name: string | null;
  max_agents: number | null;
  price_monthly: number | null;
  agent_count: number;
  createdAt: string;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  maxAgents: number;
  priceMonthly: number;
}

const CompaniesPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { setTargetCompany } = useTenantContext();
  const { confirm, Dialog } = useConfirmDialog();
  const isPlatformAdmin = user?.role === 'super_admin';
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    whatsapp_phone: '',
    plan_id: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteCompany, setInviteCompany] = useState<Company | null>(null);
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    password: '',
    must_change_password: true,
  });
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleteSlug, setDeleteSlug] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadData = async () => {
    try {
      setPageError(null);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', '25');

      const companiesRes = await api.get(`/companies?${params.toString()}`);
      setCompanies(companiesRes.data.data || []);
      setTotalPages(companiesRes.data.pagination?.pages || 1);
      setTotal(companiesRes.data.pagination?.total || 0);

      // Plans endpoint returns 410 when billing is disabled — silently skip.
      try {
        const plansRes = await api.get('/subscriptions/plans');
        setPlans(plansRes.data.data || []);
      } catch {
        // Billing disabled or unavailable — plans list stays empty.
        setPlans([]);
      }
    } catch (err) {
      setPageError('Could not load companies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Clean up form data - send null instead of empty strings for optional fields
      const submitData = {
        name: formData.name,
        slug: formData.slug,
        whatsapp_phone: formData.whatsapp_phone || null,
        plan_id: formData.plan_id || null,
      };

      if (editingCompany) {
        await api.put(`/companies/${editingCompany.id}`, submitData);
        setShowModal(false);
        setEditingCompany(null);
        setFormData({ name: '', slug: '', whatsapp_phone: '', plan_id: '' });
        await loadData();
      } else {
        const createRes = await api.post('/companies', submitData);
        const created = createRes.data.data as Company;
        const warning = createRes.data?.warning as string | undefined;
        setShowModal(false);
        setEditingCompany(null);
        setFormData({ name: '', slug: '', whatsapp_phone: '', plan_id: '' });
        setInviteCompany({
          ...created,
          whatsappPhone: created.whatsappPhone ?? submitData.whatsapp_phone ?? null,
          plan_name: plans.find((p) => p.id === created.planId)?.name ?? null,
          agent_count: 0,
        });
        setTargetCompany(created.id, created.name);
        setInviteError('');
        setInviteSuccess(
          warning
            ? `${warning} Create the company admin account below.`
            : 'Company created. Now create the company admin account below.',
        );
        void loadData().catch(() => {
          /* List refresh can fail on cold backend; company was still created */
        });
      }
    } catch (err: any) {
      const status = err.response?.status;
      if (!editingCompany && status === 409) {
        setError(getApiErrorMessage(err, 'This slug or WhatsApp number is already in use.'));
      } else {
        setError(getApiErrorMessage(err, 'Failed to save company'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      slug: company.slug,
      whatsapp_phone: company.whatsappPhone || '',
      plan_id: company.planId || '',
    });
    setShowModal(true);
  };

  const handleInviteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCompany) return;
    setInviteSubmitting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      await api.post('/users', {
        name: inviteForm.name,
        email: inviteForm.email,
        password: inviteForm.password,
        role: 'company_admin',
        target_company_id: inviteCompany.id,
        must_change_password: inviteForm.must_change_password,
      });
      setInviteSuccess(
        `Company admin created. They should log in and complete the 6-step onboarding wizard.`,
      );
      setInviteForm({ name: '', email: '', password: '', must_change_password: true });
    } catch (err: any) {
      setInviteError(getApiErrorMessage(err, 'Failed to create company admin'));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleDeleteCompany = async (company: Company) => {
    setDeleteTarget(company);
    setDeleteSlug('');
    setDeleteError('');
  };

  const confirmDeleteCompany = async () => {
    if (!deleteTarget || deleteSlug !== deleteTarget.slug) return;
    setDeleteSubmitting(true);
    setDeleteError('');
    try {
      await deleteCompany(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setDeleteError(getApiErrorMessage(ax, 'Failed to delete company'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleToggleStatus = async (company: Company) => {
    const nextAction = company.status === 'active' ? 'deactivate' : 'activate';
    const confirmed = await confirm(
      `${nextAction === 'deactivate' ? 'Deactivate' : 'Activate'} company?`,
      `${company.name} will be ${nextAction === 'deactivate' ? 'blocked from tenant operations' : 'restored for tenant operations'}.`,
      { variant: nextAction === 'deactivate' ? 'warning' : 'info', confirmLabel: nextAction === 'deactivate' ? 'Deactivate' : 'Activate' },
    );
    if (!confirmed) return;
    try {
      if (company.status === 'active') {
        await api.patch(`/companies/${company.id}/deactivate`);
      } else {
        await api.patch(`/companies/${company.id}/activate`);
      }
      loadData();
    } catch {
      setPageError('Could not update company status.');
    }
  };

  const filteredCompanies = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.slug.toLowerCase().includes(search.toLowerCase())
  );

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="investo-page space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('companies.title')}</h1>
          <p className="text-ink-muted text-sm">
            Create agencies, assign a plan, then invite each company&apos;s admin to onboard their team.
          </p>
          <ol className="mt-2 text-sm text-brand-900 bg-brand-50 border border-brand-100 rounded-lg px-4 py-3 list-decimal list-inside space-y-1">
            <li>Click <strong>New company</strong>, fill the form, and save.</li>
            <li>In the table <strong>Actions</strong> column, click <strong>Invite admin</strong> (person + icon).</li>
            <li>Enter admin name, email, and temporary password — they log in and complete the 6-step onboarding.</li>
          </ol>
        </div>
        <button
          onClick={() => {
            setEditingCompany(null);
            setFormData({
              name: '',
              slug: '',
              whatsapp_phone: '',
              plan_id: plans[0]?.id || '',
            });
            setShowModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 investo-btn-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('companies.new_company')}
        </button>
      </div>

      {pageError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {pageError}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
      </div>

      {/* Companies Table */}
      <div className="investo-table-wrap investo-scroll-x">
          <div className="investo-table-inner min-w-[48rem] sm:min-w-0">
          <table className="w-full">
            <thead className="investo-table-head border-b border-surface-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                  {t('companies.name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                  {t('companies.plan')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                  {t('companies.agents')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                  {t('companies.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-ink-muted">
                    {t('common.no_data')}
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((company) => (
                  <tr key={company.id} className="hover:bg-surface-muted">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-brand-700" />
                        </div>
                        <div>
                          <p className="font-medium text-ink-primary">{company.name}</p>
                          <p className="text-sm text-ink-muted">{company.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-sm font-medium bg-purple-100 text-purple-700 rounded">
                        {company.plan_name || 'No Plan'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-ink-secondary">
                        <Users className="h-4 w-4" />
                        <span>
                          {company.agent_count}
                          {company.max_agents && ` / ${company.max_agents}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                          company.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {company.status === 'active' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {company.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {isPlatformAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setInviteCompany(company);
                              setTargetCompany(company.id, company.name);
                              setInviteError('');
                              setInviteSuccess('');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors"
                            title="Invite company admin"
                          >
                            <UserPlus className="h-4 w-4 shrink-0" />
                            <span className="hidden sm:inline">Invite admin</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(company)}
                          className="p-2 text-ink-faint hover:text-brand-800 hover:bg-brand-50 rounded-lg transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(company)}
                          className={`p-2 rounded-lg transition-colors ${
                            company.status === 'active'
                              ? 'text-ink-faint hover:text-red-600 hover:bg-red-50'
                              : 'text-ink-faint hover:text-green-600 hover:bg-green-50'
                          }`}
                          title={company.status === 'active' ? t('companies.deactivate') : t('companies.activate')}
                        >
                          {company.status === 'active' ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </button>
                        {isPlatformAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteCompany(company)}
                            className="p-2 text-ink-faint hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                            title="Permanently delete company"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        label="companies"
        className="mt-4"
      />

      {inviteCompany && (
        <div className="investo-modal-overlay" onClick={() => setInviteCompany(null)}>
          <div className="investo-modal-panel sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink-primary mb-1">Invite company admin</h2>
            <p className="text-sm text-ink-muted mb-4">{inviteCompany.name}</p>
            {inviteError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{inviteError}</div>
            )}
            {inviteSuccess && (
              <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{inviteSuccess}</div>
            )}
            <form onSubmit={handleInviteAdmin} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Admin name *</label>
                <input
                  required
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Temporary password *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                  value={inviteForm.password}
                  onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-border-strong rounded-lg"
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    Create a unique temporary password. The admin will be asked to change it on first login.
                  </p>
                </div>
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={inviteForm.must_change_password}
                  onChange={(e) => setInviteForm({ ...inviteForm, must_change_password: e.target.checked })}
                />
                Require password change on first login
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setInviteCompany(null)} className="px-4 py-2 text-ink-secondary hover:bg-surface-subtle rounded-lg">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={inviteSubmitting} className="px-4 py-2 investo-btn-primary disabled:opacity-50">
                  {inviteSubmitting ? t('common.loading') : 'Create admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="investo-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="investo-modal-panel sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-700">Delete company permanently</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              This deletes {deleteTarget.name} and all tenant data. Type the slug below to continue.
            </p>
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              {deleteTarget.slug}
            </div>
            {deleteError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {deleteError}
              </div>
            )}
            <label className="mt-4 block text-sm font-medium text-ink-secondary">
              Confirm slug
              <input
                value={deleteSlug}
                onChange={(e) => setDeleteSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 focus:border-brand-500 focus:ring-2 focus:ring-brand-500"
                autoFocus
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteSubmitting}
                className="px-4 py-2 text-ink-secondary hover:bg-surface-subtle rounded-lg disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteCompany()}
                disabled={deleteSlug !== deleteTarget.slug || deleteSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete company
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="investo-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="investo-modal-panel sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink-primary mb-4">
              {editingCompany ? t('companies.edit') : t('companies.new_company')}
            </h2>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('companies.name')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      name: e.target.value,
                      slug: editingCompany ? formData.slug : generateSlug(e.target.value),
                    });
                  }}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('companies.slug')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={!!editingCompany}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('companies.whatsapp_phone')}
                </label>
                <input
                  type="text"
                  value={formData.whatsapp_phone}
                  onChange={(e) => setFormData({ ...formData, whatsapp_phone: e.target.value })}
                  placeholder="+919876543210"
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              {plans.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('companies.plan')}
                </label>
                <select
                  value={formData.plan_id}
                  onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                >
                  <option value="">No plan assigned</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} - ₹{plan.priceMonthly}/mo ({plan.maxAgents} agents)
                    </option>
                  ))}
                </select>
              </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-ink-secondary hover:bg-surface-subtle rounded-lg transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 investo-btn-primary transition-colors disabled:opacity-50"
                >
                  {submitting ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {Dialog}
    </div>
  );
};

export default CompaniesPage;
