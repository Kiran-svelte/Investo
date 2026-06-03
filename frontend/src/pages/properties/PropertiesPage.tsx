import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dashboardPath } from '../../config/navigation.config';
import { useAuth } from '../../context/AuthContext';
import { getRoleCapabilities } from '../../config/navigation.config';
import api from '../../services/api';
import {
  cancelPropertyImportDraft,
  listPropertyImportDrafts,
  type PropertyImportDraftSummary,
} from '../../services/propertyImport';
import RemoveCancelButton from '../../components/actions/RemoveCancelButton';
import Pagination from '../../components/common/Pagination';
import PageLoader from '../../components/ui/PageLoader';
import PageHeader from '../../components/ui/PageHeader';
import {
  Search, Plus, MapPin, Bed, IndianRupee, Building2,
  Image as ImageIcon, X, Loader2, Edit3, Trash2, Upload
} from 'lucide-react';

interface Property {
  id: string;
  name: string;
  builder: string | null;
  location_city: string | null;
  location_area: string | null;
  location_pincode: string | null;
  price_min: number | null;
  price_max: number | null;
  bedrooms: number | null;
  property_type: string | null;
  status: string;
  images: string[] | string;
  amenities: string[] | string;
  description: string | null;
  rera_number: string | null;
  brochure_url: string | null;
  floor_plan_urls: string[] | string;
  price_list_url: string | null;
  latitude: number | null;
  longitude: number | null;
}

const PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial'];
const PROPERTY_STATUSES = ['available', 'sold', 'upcoming'];

const parseArr = (val: string[] | string | null): string[] => {
  if (!val) return [];
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return val;
};

const toInputNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const PropertiesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const capabilities = getRoleCapabilities(user?.role);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [detailProperty, setDetailProperty] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [importDrafts, setImportDrafts] = useState<PropertyImportDraftSummary[]>([]);
  const [cancellingDraftId, setCancellingDraftId] = useState<string | null>(null);

  const loadImportDrafts = useCallback(async () => {
    if (!capabilities.canUploadProperties) {
      setImportDrafts([]);
      return;
    }
    try {
      setImportDrafts(await listPropertyImportDrafts());
    } catch {
      setImportDrafts([]);
    }
  }, [capabilities.canUploadProperties]);

  const loadProperties = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (typeFilter) params.append('property_type', typeFilter);
      params.append('page', String(page));
      params.append('limit', '25');
      const res = await api.get(`/properties?${params.toString()}`);
      const body = res.data as { data?: Property[]; pagination?: { pages?: number; total?: number } };
      const list = Array.isArray(body?.data) ? body.data : [];
      setProperties(list);
      setTotalPages(body.pagination?.pages || 1);
      setTotal(body.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load properties', err);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, page]);

  useEffect(() => { setPage(1); }, [search, typeFilter]);

  useEffect(() => { loadProperties(); }, [loadProperties]);
  useEffect(() => { void loadImportDrafts(); }, [loadImportDrafts]);

  const handleCancelImportDraft = async (draftId: string, draftName: string) => {
    if (!confirm(`Cancel import draft "${draftName}"? Uploaded files will be discarded.`)) return;
    setCancellingDraftId(draftId);
    try {
      await cancelPropertyImportDraft(draftId, { reason: 'Cancelled from properties list' });
      await loadImportDrafts();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax.response?.data?.error || 'Failed to cancel draft.');
    } finally {
      setCancellingDraftId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this property? This action cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.delete(`/properties/${id}`);
      await loadProperties(); // Refresh the list after deletion
    } catch (err: any) {
      console.error('Delete failed', err);
      alert(err.response?.data?.error || 'Failed to delete property.');
    } finally {
      setDeleting(null);
    }
  };

  const handleEdit = (prop: Property) => {
    setEditingProperty(prop);
    setShowModal(true);
  };

  const formatPrice = (min: number | null, max: number | null) => {
    if (!min && !max) return '-';
    const fmt = (n: number) => {
      if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
      if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
      return `${(n / 1000).toFixed(0)}K`;
    };
    if (min && max) return `₹${fmt(min)} - ₹${fmt(max)}`;
    if (min) return `₹${fmt(min)}+`;
    return `Up to ₹${fmt(max!)}`;
  };

  return (
    <PageLoader loading={loading && properties.length === 0} skeleton="property" count={6}>
    <div className="investo-page space-y-4">
      <PageHeader
        title={t('properties.title')}
        actions={capabilities.canUploadProperties ? (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate(dashboardPath('/properties/import'))}
              className="investo-btn-secondary"
            >
              <Upload className="h-4 w-4" /> Import from media
            </button>
            <button onClick={() => { setEditingProperty(null); setShowModal(true); }} className="investo-btn-primary">
              <Plus className="h-4 w-4" />{t('properties.new_property')}
            </button>
          </div>
        ) : undefined}
      />
      {capabilities.isPlatformAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Platform admin: manage tenants under <strong>Companies</strong>. Property uploads are done by each agency&apos;s <strong>Company Admin</strong>.
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input type="text" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by property type"
          className="px-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent">
          <option value="">{t('common.all_types', { defaultValue: 'All types' })}</option>
          {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {importDrafts.length > 0 && capabilities.canUploadProperties && (
        <section className="investo-card-pad border border-violet-100 bg-violet-50/40">
          <h2 className="text-sm font-semibold text-violet-900">Import drafts</h2>
          <p className="mt-1 text-xs text-violet-800">
            Unpublished brochure imports. Finish AI knowledge or publish when ready.
          </p>
          <ul className="mt-3 space-y-2">
            {importDrafts.map((draft) => {
              const knowledgeLabel = draft.knowledge_gap_count > 0
                ? `${draft.knowledge_gap_count} AI question(s) left`
                : 'AI knowledge complete';
              const statusLabel = draft.extractionStatus !== 'extracted'
                ? 'Extracting brochure…'
                : draft.knowledge_deferred
                  ? 'Finish later — knowledge pending'
                  : knowledgeLabel;
              return (
                <li key={draft.id}>
                  <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2">
                    <button
                      type="button"
                      onClick={() => navigate(dashboardPath(`/properties/import/${draft.id}`))}
                      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left text-sm hover:text-brand-800"
                    >
                      <span className="font-medium text-ink-primary">
                        {draft.name}
                        {draft.property_type ? ` · ${draft.property_type}` : ''}
                      </span>
                      <span className="text-xs text-violet-700">{statusLabel}</span>
                    </button>
                    <RemoveCancelButton
                      variant="delete"
                      label="Remove"
                      loading={cancellingDraftId === draft.id}
                      onClick={() => void handleCancelImportDraft(draft.id, draft.name)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {properties.length === 0 ? (
        <div className="investo-card-pad text-center text-ink-muted">
          {importDrafts.length > 0 && capabilities.canUploadProperties
            ? 'No published properties yet. Continue an import draft above or publish when ready.'
            : t('common.no_data')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {properties.map((property) => {
            const images = parseArr(property.images);
            const floorPlans = parseArr(property.floor_plan_urls);
            const hasRichMedia = Boolean(property.brochure_url || property.price_list_url || floorPlans.length > 0);
            return (
              <div key={property.id}
                className="investo-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setDetailProperty(property)}>
                <div className="h-40 bg-surface-subtle relative">
                  {images.length > 0 ? (
                    <img src={images[0]} alt={property.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-12 w-12 text-ink-faint" /></div>
                  )}
                  <span className={`absolute top-2 right-2 px-2 py-1 text-xs font-medium rounded-full ${
                    property.status === 'available' ? 'bg-green-100 text-green-700' :
                    property.status === 'sold' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>{property.status}</span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-ink-primary mb-1">{property.name}</h3>
                      {property.builder && <p className="text-xs text-ink-muted mb-2">by {property.builder}</p>}
                    </div>
                    {capabilities.canManageProperties && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleEdit(property)} title="Edit property" aria-label="Edit property" className="p-1.5 hover:bg-surface-subtle rounded"><Edit3 className="h-3.5 w-3.5 text-ink-muted" /></button>
                        <button onClick={() => handleDelete(property.id)} disabled={deleting === property.id}
                          title="Delete property" aria-label="Delete property" className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm text-ink-secondary">
                    {(property.location_area || property.location_city) && (
                      <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-faint" />{[property.location_area, property.location_city].filter(Boolean).join(', ')}</div>
                    )}
                    <div className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-ink-faint" />{formatPrice(property.price_min, property.price_max)}</div>
                    <div className="flex items-center gap-4">
                      {property.bedrooms !== null && property.bedrooms !== undefined && <div className="flex items-center gap-1"><Bed className="h-4 w-4 text-ink-faint" />{property.bedrooms} BHK</div>}
                      {property.property_type && <div className="flex items-center gap-1"><Building2 className="h-4 w-4 text-ink-faint" />{property.property_type}</div>}
                    </div>
                    {hasRichMedia && (
                      <div className="text-xs text-ink-muted">
                        {[property.brochure_url ? 'Brochure' : '', property.price_list_url ? 'Price list' : '', floorPlans.length > 0 ? `${floorPlans.length} floor plan${floorPlans.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' | ')}
                      </div>
                    )}
                    {(property.latitude !== null && property.latitude !== undefined && property.longitude !== null && property.longitude !== undefined) && (
                      <div className="text-xs text-ink-muted">Coords: {property.latitude}, {property.longitude}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        label="properties"
        className="mt-6"
      />

      {showModal && <PropertyModal property={editingProperty} onClose={() => { setShowModal(false); setEditingProperty(null); }} onSaved={() => { setShowModal(false); setEditingProperty(null); loadProperties(); }} />}
      {detailProperty && <PropertyDetailModal property={detailProperty} onClose={() => setDetailProperty(null)} />}
    </div>
    </PageLoader>
  );
};

/* ───── Create/Edit Property Modal ───── */
interface PropertyModalProps { property: Property | null; onClose: () => void; onSaved: () => void; }

const PropertyModal: React.FC<PropertyModalProps> = ({ property, onClose, onSaved }) => {
  const { t } = useTranslation();
  const isEdit = !!property;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: property?.name || '',
    builder: property?.builder || '',
    location_city: property?.location_city || '',
    location_area: property?.location_area || '',
    location_pincode: property?.location_pincode || '',
    price_min: toInputNumber(property?.price_min),
    price_max: toInputNumber(property?.price_max),
    bedrooms: toInputNumber(property?.bedrooms),
    property_type: property?.property_type || '',
    description: property?.description || '',
    rera_number: property?.rera_number || '',
    status: property?.status || 'available',
    brochure_url: property?.brochure_url || '',
    price_list_url: property?.price_list_url || '',
    floor_plan_urls: (() => {
      const values = parseArr(property?.floor_plan_urls || null);
      return values.length > 0 ? values : [''];
    })(),
    latitude: toInputNumber(property?.latitude),
    longitude: toInputNumber(property?.longitude),
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleFloorPlanChange = (index: number, value: string) => {
    setForm((prev) => ({
      ...prev,
      floor_plan_urls: prev.floor_plan_urls.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
    }));
  };

  const handleAddFloorPlan = () => {
    setForm((prev) => ({
      ...prev,
      floor_plan_urls: [...prev.floor_plan_urls, ''],
    }));
  };

  const handleRemoveFloorPlan = (index: number) => {
    setForm((prev) => {
      const next = prev.floor_plan_urls.filter((_, entryIndex) => entryIndex !== index);
      return {
        ...prev,
        floor_plan_urls: next.length > 0 ? next : [''],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) { setError('Property name is required'); return; }

    const brochureUrl = form.brochure_url.trim();
    const priceListUrl = form.price_list_url.trim();
    const floorPlanUrls = form.floor_plan_urls.map((url) => url.trim()).filter(Boolean);

    if (brochureUrl && !isValidHttpUrl(brochureUrl)) {
      setError('Brochure URL must be a valid http/https URL');
      return;
    }

    if (priceListUrl && !isValidHttpUrl(priceListUrl)) {
      setError('Price list URL must be a valid http/https URL');
      return;
    }

    const invalidFloorPlan = floorPlanUrls.find((url) => !isValidHttpUrl(url));
    if (invalidFloorPlan) {
      setError('Each floor plan URL must be a valid http/https URL');
      return;
    }

    const latitude = form.latitude.trim() === '' ? null : Number(form.latitude);
    if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      setError('Latitude must be a valid number between -90 and 90');
      return;
    }

    const longitude = form.longitude.trim() === '' ? null : Number(form.longitude);
    if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      setError('Longitude must be a valid number between -180 and 180');
      return;
    }

    if (!form.price_min || !form.price_max) {
      setError('Price Min and Price Max (₹) are required for each project.');
      return;
    }
    if (Number(form.price_min) > Number(form.price_max)) {
      setError('Price Min cannot be greater than Price Max.');
      return;
    }

    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      builder: form.builder || null,
      location_city: form.location_city || null,
      location_area: form.location_area || null,
      location_pincode: form.location_pincode || null,
      price_min: form.price_min ? Number(form.price_min) : null,
      price_max: form.price_max ? Number(form.price_max) : null,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
      property_type: form.property_type || null,
      description: form.description || null,
      rera_number: form.rera_number || null,
      status: form.status,
      brochure_url: brochureUrl || null,
      price_list_url: priceListUrl || null,
      floor_plan_urls: floorPlanUrls,
      latitude,
      longitude,
    };
    try {
      if (isEdit) { await api.put(`/properties/${property!.id}`, payload); }
      else { await api.post('/properties', payload); }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="investo-modal-overlay">
      <div className="investo-modal-panel sm:max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Property' : 'New Property'}</h2>
          <button onClick={onClose} disabled={saving} title="Close modal" aria-label="Close modal" className="p-1 hover:bg-surface-subtle rounded disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm" role="alert">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="name" className="block text-sm font-medium text-ink-secondary mb-1">Name *</label>
              <input id="name" name="name" aria-label="Name *" value={form.name} onChange={handleChange} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
            </div>
            <div><label htmlFor="builder" className="block text-sm font-medium text-ink-secondary mb-1">Builder</label><input id="builder" name="builder" aria-label="Builder" value={form.builder} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="property_type" className="block text-sm font-medium text-ink-secondary mb-1">Type</label>
              <select id="property_type" name="property_type" aria-label="Type" value={form.property_type} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500">
                <option value="">Select</option>{PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label htmlFor="location_city" className="block text-sm font-medium text-ink-secondary mb-1">City</label><input id="location_city" name="location_city" aria-label="City" value={form.location_city} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="location_area" className="block text-sm font-medium text-ink-secondary mb-1">Area</label><input id="location_area" name="location_area" aria-label="Area" value={form.location_area} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="location_pincode" className="block text-sm font-medium text-ink-secondary mb-1">Pincode</label><input id="location_pincode" name="location_pincode" aria-label="Pincode" value={form.location_pincode} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="bedrooms" className="block text-sm font-medium text-ink-secondary mb-1">Bedrooms</label><input id="bedrooms" name="bedrooms" aria-label="Bedrooms" type="number" value={form.bedrooms} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="price_min" className="block text-sm font-medium text-ink-secondary mb-1">Price Min (₹) *</label><input id="price_min" name="price_min" aria-label="Price Min (₹)" type="number" required value={form.price_min} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="price_max" className="block text-sm font-medium text-ink-secondary mb-1">Price Max (₹) *</label><input id="price_max" name="price_max" aria-label="Price Max (₹)" type="number" required value={form.price_max} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="rera_number" className="block text-sm font-medium text-ink-secondary mb-1">RERA Number</label><input id="rera_number" name="rera_number" aria-label="RERA Number" value={form.rera_number} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            <div><label htmlFor="status" className="block text-sm font-medium text-ink-secondary mb-1">Status</label>
              <select id="status" name="status" aria-label="Status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500">
                {PROPERTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
              <div><label htmlFor="brochure_url" className="block text-sm font-medium text-ink-secondary mb-1">Brochure URL</label><input id="brochure_url" name="brochure_url" aria-label="Brochure URL" type="url" value={form.brochure_url} onChange={handleChange} placeholder="https://example.com/brochure.pdf" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
              <div><label htmlFor="price_list_url" className="block text-sm font-medium text-ink-secondary mb-1">Price List URL</label><input id="price_list_url" name="price_list_url" aria-label="Price List URL" type="url" value={form.price_list_url} onChange={handleChange} placeholder="https://example.com/pricelist.pdf" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
              <div><label htmlFor="latitude" className="block text-sm font-medium text-ink-secondary mb-1">Latitude</label><input id="latitude" name="latitude" aria-label="Latitude" type="number" step="any" min={-90} max={90} value={form.latitude} onChange={handleChange} placeholder="12.9716" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
              <div><label htmlFor="longitude" className="block text-sm font-medium text-ink-secondary mb-1">Longitude</label><input id="longitude" name="longitude" aria-label="Longitude" type="number" step="any" min={-180} max={180} value={form.longitude} onChange={handleChange} placeholder="77.5946" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-ink-secondary">Floor Plan URLs</label>
                <button type="button" onClick={handleAddFloorPlan} className="px-2 py-1 text-xs bg-brand-50 text-brand-800 rounded hover:bg-brand-100">Add floor plan</button>
              </div>
              <div className="space-y-2">
                {form.floor_plan_urls.map((url, index) => (
                  <div key={`floor-plan-${index}`} className="flex gap-2">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => handleFloorPlanChange(index, e.target.value)}
                      placeholder="https://example.com/floor-plan.pdf"
                      aria-label={`Floor plan URL ${index + 1}`}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveFloorPlan(index)}
                      className="px-3 py-2 border rounded-lg hover:bg-surface-muted"
                      aria-label={`Remove floor plan ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div><label htmlFor="description" className="block text-sm font-medium text-ink-secondary mb-1">Description</label>
              <textarea id="description" name="description" aria-label="Description" value={form.description} onChange={handleChange} rows={3} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
            </div>
          </fieldset>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 border rounded-lg hover:bg-surface-muted disabled:opacity-50">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{isEdit ? t('common.update') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ───── Property Detail Modal ───── */
const PropertyDetailModal: React.FC<{ property: Property; onClose: () => void }> = ({ property, onClose }) => {
  const parseArr = (val: string[] | string | null): string[] => {
    if (!val) return [];
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return val;
  };
  const images = parseArr(property.images);
  const amenities = parseArr(property.amenities);
  const floorPlans = parseArr(property.floor_plan_urls);
  const fmt = (n: number | null) => {
    if (!n) return '-';
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
    return `₹${n.toLocaleString('en-IN')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="investo-modal-panel sm:max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{property.name}</h2>
          <button onClick={onClose} title="Close details" aria-label="Close details" className="p-1 hover:bg-surface-subtle rounded"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, i) => <img key={i} src={img} alt="" className="h-40 rounded-lg object-cover flex-shrink-0" />)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-ink-muted">Builder</span><p className="font-medium">{property.builder || '-'}</p></div>
            <div><span className="text-ink-muted">Type</span><p className="font-medium">{property.property_type || '-'}</p></div>
            <div><span className="text-ink-muted">Location</span><p className="font-medium">{[property.location_area, property.location_city].filter(Boolean).join(', ') || '-'}</p></div>
            <div><span className="text-ink-muted">Pincode</span><p className="font-medium">{property.location_pincode || '-'}</p></div>
            <div><span className="text-ink-muted">Price Range</span><p className="font-medium">{fmt(property.price_min)} - {fmt(property.price_max)}</p></div>
            <div><span className="text-ink-muted">Bedrooms</span><p className="font-medium">{property.bedrooms !== null && property.bedrooms !== undefined ? `${property.bedrooms} BHK` : '-'}</p></div>
            <div><span className="text-ink-muted">RERA</span><p className="font-medium">{property.rera_number || '-'}</p></div>
            <div><span className="text-ink-muted">Status</span><p className="font-medium capitalize">{property.status}</p></div>
            <div><span className="text-ink-muted">Brochure</span><p className="font-medium">{property.brochure_url ? <a href={property.brochure_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Open brochure</a> : '-'}</p></div>
            <div><span className="text-ink-muted">Price List</span><p className="font-medium">{property.price_list_url ? <a href={property.price_list_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Open price list</a> : '-'}</p></div>
            <div><span className="text-ink-muted">Latitude</span><p className="font-medium">{property.latitude !== null && property.latitude !== undefined ? property.latitude : '-'}</p></div>
            <div><span className="text-ink-muted">Longitude</span><p className="font-medium">{property.longitude !== null && property.longitude !== undefined ? property.longitude : '-'}</p></div>
          </div>
          {floorPlans.length > 0 && (
            <div>
              <p className="text-ink-muted text-sm mb-2">Floor Plans</p>
              <div className="flex flex-col gap-2">
                {floorPlans.map((url, index) => (
                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline break-all">
                    Floor plan {index + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
          {property.description && (
            <div><p className="text-ink-muted text-sm mb-1">Description</p><p className="text-sm text-ink-secondary">{property.description}</p></div>
          )}
          {amenities.length > 0 && (
            <div><p className="text-ink-muted text-sm mb-2">Amenities</p>
              <div className="flex flex-wrap gap-2">{amenities.map((a, i) => <span key={i} className="px-2 py-1 bg-surface-subtle text-ink-secondary text-xs rounded-full">{a}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PropertiesPage;
