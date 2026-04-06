import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  CreditCard, Download, Check, Clock, AlertCircle, Zap
} from 'lucide-react';

interface SubscriptionPlan {
  id: string;
  name: string;
  maxAgents: number;
  maxLeads: number | null;
  maxProperties: number | null;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  status: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  dueDate: string;
  paidAt: string | null;
  periodStart: string;
  periodEnd: string;
}

interface CompanySubscription {
  plan_name: string | null;
  max_agents: number | null;
  price_monthly: number | null;
  status: string;
  agent_count: number;
}

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<CompanySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [plansRes, companyRes] = await Promise.all([
          api.get('/subscriptions/plans'),
          api.get('/companies'),
        ]);
        setPlans(plansRes.data.data || []);
        setCurrentSubscription(companyRes.data.data || null);

        // Try to load invoices (may not exist yet)
        try {
          const invoicesRes = await api.get('/subscriptions/invoices');
          setInvoices(invoicesRes.data.data || []);
        } catch {
          setInvoices([]);
        }
      } catch (err) {
        console.error('Failed to load billing data', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
            <Check className="h-3 w-3" /> {t('billing.paid')}
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">
            <Clock className="h-3 w-3" /> {t('billing.pending')}
          </span>
        );
      case 'overdue':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
            <AlertCircle className="h-3 w-3" /> {t('billing.overdue')}
          </span>
        );
      default:
        return null;
    }
  };

  const refreshSubscription = async () => {
    const companyRes = await api.get('/companies');
    setCurrentSubscription(companyRes.data.data || null);
  };

  const handleSelectPlan = async (planId: string) => {
    try {
      setUpdatingPlanId(planId);
      await api.post('/subscriptions/select-plan', { plan_id: planId });
      await refreshSubscription();
    } catch (err) {
      console.error('Failed to update subscription plan', err);
      alert(t('billing.update_failed') || 'Failed to update plan');
    } finally {
      setUpdatingPlanId(null);
    }
  };

  const handleDownloadInvoice = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await api.get(`/subscriptions/invoices/${invoiceId}/download`, {
        responseType: 'blob',
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download invoice', err);
      alert(t('billing.download_failed') || 'Failed to download invoice');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
        <p className="text-gray-500 text-sm">
          {t('billing.subtitle')}
        </p>
      </div>

      {/* Current Plan Card */}
      {currentSubscription && (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-blue-100 text-sm">{t('billing.current_plan')}</p>
              <h2 className="text-2xl font-bold mt-1">
                {currentSubscription.plan_name || t('common.no_data')}
              </h2>
              <p className="text-blue-100 mt-2">
                {currentSubscription.agent_count} {t('billing.agents_used')}
                {currentSubscription.max_agents && ` ${t('billing.agents_of')} ${currentSubscription.max_agents}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">
                {currentSubscription.price_monthly
                  ? formatCurrency(currentSubscription.price_monthly)
                  : '₹0'}
                <span className="text-lg font-normal text-blue-100">{t('billing.per_month')}</span>
              </p>
              {!isSuperAdmin && (
                <button
                  onClick={() => {
                    const betterPlan = plans.find((p) => p.priceMonthly > (currentSubscription?.price_monthly || 0));
                    if (betterPlan) {
                      void handleSelectPlan(betterPlan.id);
                    }
                  }}
                  disabled={updatingPlanId !== null}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors disabled:opacity-60"
                >
                  <Zap className="h-4 w-4" />
                  {t('billing.upgrade')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plans Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('billing.available_plans')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-xl shadow-sm border p-6 ${
                currentSubscription?.plan_name === plan.name
                  ? 'border-blue-500 ring-2 ring-blue-100'
                  : 'border-gray-100'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                {currentSubscription?.plan_name === plan.name && (
                  <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                    {t('billing.current')}
                  </span>
                )}
              </div>

              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">
                  {formatCurrency(plan.priceMonthly)}
                </span>
                <span className="text-gray-500">{t('billing.per_month')}</span>
              </div>

              <ul className="space-y-3 mb-6">
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" />
                  {t('billing.up_to_agents', { count: plan.maxAgents })}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" />
                  {plan.maxLeads ? t('billing.leads_per_month', { count: plan.maxLeads }) : t('billing.unlimited_leads')}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" />
                  {plan.maxProperties ? t('billing.properties_count', { count: plan.maxProperties }) : t('billing.unlimited_properties')}
                </li>
                {plan.features.slice(0, 3).map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="h-4 w-4 text-green-500" />
                    {feature.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>

              {currentSubscription?.plan_name !== plan.name && (
                <button
                  onClick={() => void handleSelectPlan(plan.id)}
                  disabled={updatingPlanId !== null}
                  className="w-full py-2 px-4 border border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors disabled:opacity-60"
                >
                  {t('billing.select_plan')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('billing.invoices')}</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <CreditCard className="h-12 w-12 mx-auto text-gray-300 mb-4" />
              <p>{t('billing.no_invoices')}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('billing.invoice')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('billing.invoice_date')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('billing.invoice_amount')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('billing.invoice_status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {invoice.invoiceNumber}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(invoice.dueDate).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {formatCurrency(invoice.amount)}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(invoice.status)}</td>
                    <td className="px-6 py-4">
                      <button 
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                        onClick={() => handleDownloadInvoice(invoice.id, invoice.invoiceNumber)}
                      >
                        <Download className="h-4 w-4" />
                        {t('billing.download')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default BillingPage;
