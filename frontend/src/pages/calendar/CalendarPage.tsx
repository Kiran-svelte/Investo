import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, MapPin,
  Phone, CheckCircle, XCircle, AlertCircle, X, Loader2
} from 'lucide-react';

interface Visit {
  id: string;
  lead_id: string;
  customer_name: string | null;
  customer_phone: string;
  property_name: string | null;
  property_area: string | null;
  agent_name: string;
  agent_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
}

interface Lead { id: string; customer_name: string | null; phone: string; }
interface Property { id: string; name: string; }
interface Agent { id: string; name: string; }

const STATUS_ICONS: Record<string, React.ElementType> = {
  scheduled: Clock, confirmed: CheckCircle, completed: CheckCircle, cancelled: XCircle, no_show: AlertCircle,
};
const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  no_show: 'bg-orange-100 text-orange-700 border-orange-200',
};
const VISIT_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [], cancelled: [], no_show: [],
};

const CalendarPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const getDateRange = useCallback(() => {
    const from = new Date(currentDate); const to = new Date(currentDate);
    if (view === 'day') { from.setHours(0, 0, 0, 0); to.setHours(23, 59, 59, 999); }
    else if (view === 'week') { const day = from.getDay(); from.setDate(from.getDate() - day); from.setHours(0, 0, 0, 0); to.setDate(to.getDate() + (6 - to.getDay())); to.setHours(23, 59, 59, 999); }
    else { from.setDate(1); from.setHours(0, 0, 0, 0); to.setMonth(to.getMonth() + 1, 0); to.setHours(23, 59, 59, 999); }
    return { from, to };
  }, [currentDate, view]);

  const loadVisits = useCallback(async () => {
    try {
      setLoading(true);
      const { from, to } = getDateRange();
      const res = await api.get(`/visits?from=${from.toISOString()}&to=${to.toISOString()}`);
      setVisits(res.data.data);
    } catch (err) { console.error('Failed to load visits', err); }
    finally { setLoading(false); }
  }, [getDateRange]);

  useEffect(() => { loadVisits(); }, [loadVisits]);

  const navigate = (direction: 'prev' | 'next') => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() + (direction === 'next' ? 1 : -1));
    else if (view === 'week') d.setDate(d.getDate() + (direction === 'next' ? 7 : -7));
    else d.setMonth(d.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentDate(d);
  };

  const formatDateHeader = () => {
    if (view === 'day') return currentDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (view === 'week') { const { from, to } = getDateRange(); return `${from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${to.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`; }
    return currentDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  const getWeekDays = () => { const { from } = getDateRange(); const days: Date[] = []; for (let i = 0; i < 7; i++) { const d = new Date(from); d.setDate(d.getDate() + i); days.push(d); } return days; };

  const getMonthDays = () => {
    const year = currentDate.getFullYear(); const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1); const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay(); const days: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    return days;
  };

  const getVisitsForDay = (date: Date) => visits.filter(v => new Date(v.scheduled_at).toDateString() === date.toDateString());

  const updateVisitStatus = async (visitId: string, newStatus: string) => {
    setStatusUpdating(true);
    try {
      await api.patch(`/visits/${visitId}/status`, { status: newStatus });
      await loadVisits();
      setSelectedVisit(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    } finally { setStatusUpdating(false); }
  };

  const canSchedule = user?.role === 'company_admin' || user?.role === 'super_admin' || user?.role === 'sales_agent';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('visits.title')}</h1>
        {canSchedule && (
          <button onClick={() => setShowScheduleModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />{t('visits.schedule_visit')}
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('prev')} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="h-5 w-5 text-gray-600" /></button>
          <span className="font-medium text-gray-900 min-w-[200px] text-center">{formatDateHeader()}</span>
          <button onClick={() => navigate('next')} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="h-5 w-5 text-gray-600" /></button>
          <button onClick={() => setCurrentDate(new Date())} className="ml-2 px-3 py-1 text-sm border rounded-lg hover:bg-gray-50">{t('calendar.today')}</button>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['day', 'week', 'month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              {t(`calendar.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />{t('common.loading')}</div>
      ) : (
        <>
          {/* Week View */}
          {view === 'week' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {getWeekDays().map((day, idx) => {
                  const isToday = day.toDateString() === new Date().toDateString();
                  return (<div key={idx} className={`p-3 text-center border-r last:border-r-0 ${isToday ? 'bg-blue-50' : ''}`}>
                    <p className="text-xs text-gray-500">{day.toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                    <p className={`text-lg font-semibold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>{day.getDate()}</p>
                  </div>);
                })}
              </div>
              <div className="grid grid-cols-7 min-h-[400px]">
                {getWeekDays().map((day, idx) => {
                  const dayVisits = getVisitsForDay(day);
                  return (<div key={idx} className="p-2 border-r last:border-r-0 border-gray-100">
                    {dayVisits.map(visit => {
                      const StatusIcon = STATUS_ICONS[visit.status] || Clock;
                      return (<div key={visit.id} onClick={() => setSelectedVisit(visit)}
                        className={`mb-2 p-2 rounded-lg border text-xs cursor-pointer hover:opacity-80 ${STATUS_COLORS[visit.status]}`}>
                        <div className="flex items-center gap-1 font-medium"><StatusIcon className="h-3 w-3" />{new Date(visit.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                        <p className="mt-1 truncate">{visit.customer_name || visit.customer_phone}</p>
                        {visit.property_name && <p className="truncate text-gray-600">{visit.property_name}</p>}
                      </div>);
                    })}
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* Day View */}
          {view === 'day' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
              {getVisitsForDay(currentDate).length === 0 ? (
                <p className="text-center text-gray-400 py-8">No visits scheduled for this day</p>
              ) : getVisitsForDay(currentDate).map(visit => {
                const StatusIcon = STATUS_ICONS[visit.status] || Clock;
                const time = new Date(visit.scheduled_at);
                return (<div key={visit.id} onClick={() => setSelectedVisit(visit)}
                  className={`p-4 rounded-xl border cursor-pointer hover:shadow-sm transition-shadow ${STATUS_COLORS[visit.status]}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><StatusIcon className="h-5 w-5" /><span className="font-semibold">{time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span><span className="text-sm">({visit.duration_minutes}min)</span></div>
                    <span className="text-xs font-medium uppercase">{visit.status}</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2"><User className="h-4 w-4" />{visit.customer_name || 'Unknown'}</div>
                    <div className="flex items-center gap-2"><Phone className="h-4 w-4" />{visit.customer_phone}</div>
                    {visit.property_name && <div className="flex items-center gap-2"><MapPin className="h-4 w-4" />{visit.property_name}</div>}
                    <div className="text-xs text-gray-500">Agent: {visit.agent_name}</div>
                  </div>
                </div>);
              })}
            </div>
          )}

          {/* Month View */}
          {view === 'month' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-7 border-b">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="p-2 text-center text-xs font-semibold text-gray-500 border-r last:border-r-0">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getMonthDays().map((day, idx) => {
                  if (!day) return <div key={idx} className="p-2 min-h-[80px] border-r border-b border-gray-100 bg-gray-50" />;
                  const dayVisits = getVisitsForDay(day);
                  const isToday = day.toDateString() === new Date().toDateString();
                  return (<div key={idx} className={`p-1.5 min-h-[80px] border-r border-b border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}>
                    <p className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>{day.getDate()}</p>
                    {dayVisits.slice(0, 2).map(v => (
                      <div key={v.id} onClick={() => setSelectedVisit(v)}
                        className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate cursor-pointer ${STATUS_COLORS[v.status]}`}>
                        {new Date(v.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} {v.customer_name || v.customer_phone}
                      </div>
                    ))}
                    {dayVisits.length > 2 && <p className="text-[10px] text-gray-500">+{dayVisits.length - 2} more</p>}
                  </div>);
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Mobile list */}
      <div className="md:hidden space-y-3">
        {visits.map(visit => {
          const StatusIcon = STATUS_ICONS[visit.status] || Clock;
          const time = new Date(visit.scheduled_at);
          return (<div key={visit.id} onClick={() => setSelectedVisit(visit)}
            className={`bg-white rounded-xl shadow-sm border p-4 cursor-pointer ${STATUS_COLORS[visit.status]}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusIcon className="h-5 w-5" />
                <span className="font-semibold">{time.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <span className="text-xs font-medium uppercase">{visit.status}</span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2"><User className="h-4 w-4 text-gray-400" />{visit.customer_name || 'Unknown'}</div>
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-400" />{visit.customer_phone}</div>
              {visit.property_name && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />{visit.property_name}</div>}
            </div>
          </div>);
        })}
      </div>

      {/* Visit Detail/Status Modal */}
      {selectedVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedVisit(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">Visit Details</h3>
              <button onClick={() => setSelectedVisit(null)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Customer</span><p className="font-medium">{selectedVisit.customer_name || selectedVisit.customer_phone}</p></div>
                <div><span className="text-gray-500">Phone</span><p className="font-medium">{selectedVisit.customer_phone}</p></div>
                <div><span className="text-gray-500">Date & Time</span><p className="font-medium">{new Date(selectedVisit.scheduled_at).toLocaleString('en-IN')}</p></div>
                <div><span className="text-gray-500">Duration</span><p className="font-medium">{selectedVisit.duration_minutes} min</p></div>
                <div><span className="text-gray-500">Property</span><p className="font-medium">{selectedVisit.property_name || '-'}</p></div>
                <div><span className="text-gray-500">Agent</span><p className="font-medium">{selectedVisit.agent_name}</p></div>
                <div><span className="text-gray-500">Status</span><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[selectedVisit.status]}`}>{selectedVisit.status}</span></div>
              </div>
              {selectedVisit.notes && <div><span className="text-sm text-gray-500">Notes</span><p className="text-sm bg-gray-50 p-2 rounded mt-1">{selectedVisit.notes}</p></div>}
              {(VISIT_TRANSITIONS[selectedVisit.status] || []).length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium text-gray-700 mb-2">Update Status:</p>
                  <div className="flex flex-wrap gap-2">
                    {(VISIT_TRANSITIONS[selectedVisit.status] || []).map(status => (
                      <button key={status} onClick={() => updateVisitStatus(selectedVisit.id, status)} disabled={statusUpdating}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg border disabled:opacity-50 ${STATUS_COLORS[status]} hover:opacity-80`}>
                        {statusUpdating && <Loader2 className="h-3 w-3 animate-spin inline mr-1" />}{status.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && <ScheduleVisitModal onClose={() => setShowScheduleModal(false)} onCreated={() => { setShowScheduleModal(false); loadVisits(); }} />}
    </div>
  );
};

/* ───── Schedule Visit Modal ───── */
const ScheduleVisitModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState({ lead_id: '', property_id: '', agent_id: '', scheduled_at: '', duration_minutes: '60', notes: '' });

  useEffect(() => {
    Promise.all([
      api.get('/leads?limit=100&status=new').catch(() => ({ data: { data: [] } })),
      api.get('/leads?limit=100&status=contacted').catch(() => ({ data: { data: [] } })),
      api.get('/properties?limit=100').catch(() => ({ data: { data: [] } })),
      api.get('/users?role=sales_agent').catch(() => ({ data: { data: [] } })),
    ]).then(([newLeads, contactedLeads, props, ags]) => {
      setLeads([...(newLeads.data.data || []), ...(contactedLeads.data.data || [])]);
      setProperties(props.data.data || []);
      setAgents(ags.data.data || []);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lead_id || !form.agent_id || !form.scheduled_at) { setError('Lead, agent, and date/time are required'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/visits', {
        lead_id: form.lead_id,
        property_id: form.property_id || null,
        agent_id: form.agent_id,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: parseInt(form.duration_minutes) || 60,
        notes: form.notes || null,
      });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to schedule visit');
    } finally { setSaving(false); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Schedule Visit</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
            <select name="lead_id" value={form.lead_id} onChange={handleChange} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">Select lead</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.customer_name || l.phone} ({l.phone})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Property (optional)</label>
            <select name="property_id" value={form.property_id} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">Select property</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agent *</label>
            <select name="agent_id" value={form.agent_id} onChange={handleChange} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">Select agent</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time *</label>
              <input name="scheduled_at" type="datetime-local" value={form.scheduled_at} onChange={handleChange} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min)</label>
              <select name="duration_minutes" value={form.duration_minutes} onChange={handleChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="30">30 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">120 min</option>
              </select>
            </div>
          </div>
          <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('calendar.notes')}</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('calendar.schedule_visit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CalendarPage;
