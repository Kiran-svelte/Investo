import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
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
}

const PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial', 'farmland'];
const PROPERTY_STATUSES = ['available', 'sold', 'upcoming'];

const PropertiesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [detailProperty, setDetailProperty] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadProperties = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (typeFilter) params.append('property_type', typeFilter);
      const res = await api.get(`/properties?${params.toString()}`);
      setProperties(res.data.data);
    } catch (err) {
      console.error('Failed to load properties', err);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => { loadProperties(); }, [loadProperties]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this property? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.delete(`/properties/${id}`);
      loadProperties();
    } catch (err) {
      console.error('Delete failed', err);
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

  const parseArr = (val: string[] | string | null): string[] => {
    if (!val) return [];
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return val;
  };

  const isAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('properties.title')}</h1>
        {isAdmin && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/properties/import')}
              className="inline-flex items-center gap-2 px-4 py-2 border border-blue-200 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Upload className="h-4 w-4" /> Import from media
            </button>
            <button onClick={() => { setEditingProperty(null); setShowModal(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Plus className="h-4 w-4" />{t('properties.new_property')}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option value="">{t('common.all_types')}</option>
          {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />{t('common.loading')}</div>
      ) : properties.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('common.no_data')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {properties.map((property) => {
            const images = parseArr(property.images);
            return (
              <div key={property.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setDetailProperty(property)}>
                <div className="h-40 bg-gray-100 relative">
                  {images.length > 0 ? (
                    <img src={images[0]} alt={property.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-12 w-12 text-gray-300" /></div>
                  )}
                  <span className={`absolute top-2 right-2 px-2 py-1 text-xs font-medium rounded-full ${
                    property.status === 'available' ? 'bg-green-100 text-green-700' :
                    property.status === 'sold' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>{property.status}</span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">{property.name}</h3>
                      {property.builder && <p className="text-xs text-gray-500 mb-2">by {property.builder}</p>}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleEdit(property)} className="p-1.5 hover:bg-gray-100 rounded"><Edit3 className="h-3.5 w-3.5 text-gray-500" /></button>
                        <button onClick={() => handleDelete(property.id)} disabled={deleting === property.id}
                          className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    {(property.location_area || property.location_city) && (
                      <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />{[property.location_area, property.location_city].filter(Boolean).join(', ')}</div>
                    )}
                    <div className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-gray-400" />{formatPrice(property.price_min, property.price_max)}</div>
                    <div className="flex items-center gap-4">
                      {property.bedrooms && <div className="flex items-center gap-1"><Bed className="h-4 w-4 text-gray-400" />{property.bedrooms} BHK</div>}
                      {property.property_type && <div className="flex items-center gap-1"><Building2 className="h-4 w-4 text-gray-400" />{property.property_type}</div>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && <PropertyModal property={editingProperty} onClose={() => { setShowModal(false); setEditingProperty(null); }} onSaved={() => { setShowModal(false); setEditingProperty(null); loadProperties(); }} />}
      {detailProperty && <PropertyDetailModal property={detailProperty} onClose={() => setDetailProperty(null)} />}
    </div>
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
    price_min: property?.price_min ? String(property.price_min) : '',
    price_max: property?.price_max ? String(property.price_max) : '',
    bedrooms: property?.bedrooms ? String(property.bedrooms) : '',
    property_type: property?.property_type || '',
    description: property?.description || '',
    rera_number: property?.rera_number || '',
    status: property?.status || 'available',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Property name is required'); return; }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Property' : 'New Property'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input name="name" value={form.name} onChange={handleChange} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Builder</label><input name="builder" value={form.builder} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select name="property_type" value={form.property_type} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">Select</option>{PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><input name="location_city" value={form.location_city} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Area</label><input name="location_area" value={form.location_area} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label><input name="location_pincode" value={form.location_pincode} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Bedrooms</label><input name="bedrooms" type="number" value={form.bedrooms} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Price Min (₹)</label><input name="price_min" type="number" value={form.price_min} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Price Max (₹)</label><input name="price_max" type="number" value={form.price_max} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">RERA Number</label><input name="rera_number" value={form.rera_number} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select name="status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                {PROPERTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={3} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
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
  const fmt = (n: number | null) => {
    if (!n) return '-';
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
    return `₹${n.toLocaleString('en-IN')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{property.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, i) => <img key={i} src={img} alt="" className="h-40 rounded-lg object-cover flex-shrink-0" />)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Builder</span><p className="font-medium">{property.builder || '-'}</p></div>
            <div><span className="text-gray-500">Type</span><p className="font-medium">{property.property_type || '-'}</p></div>
            <div><span className="text-gray-500">Location</span><p className="font-medium">{[property.location_area, property.location_city].filter(Boolean).join(', ') || '-'}</p></div>
            <div><span className="text-gray-500">Pincode</span><p className="font-medium">{property.location_pincode || '-'}</p></div>
            <div><span className="text-gray-500">Price Range</span><p className="font-medium">{fmt(property.price_min)} - {fmt(property.price_max)}</p></div>
            <div><span className="text-gray-500">Bedrooms</span><p className="font-medium">{property.bedrooms ? `${property.bedrooms} BHK` : '-'}</p></div>
            <div><span className="text-gray-500">RERA</span><p className="font-medium">{property.rera_number || '-'}</p></div>
            <div><span className="text-gray-500">Status</span><p className="font-medium capitalize">{property.status}</p></div>
          </div>
          {property.description && (
            <div><p className="text-gray-500 text-sm mb-1">Description</p><p className="text-sm text-gray-700">{property.description}</p></div>
          )}
          {amenities.length > 0 && (
            <div><p className="text-gray-500 text-sm mb-2">Amenities</p>
              <div className="flex flex-wrap gap-2">{amenities.map((a, i) => <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">{a}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PropertiesPage;
