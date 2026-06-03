import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  MessageSquare,
  Shield,
  Sparkles,
  Users,
  BarChart3,
  Clock,
  Bot,
} from 'lucide-react';

const FEATURES = [
  {
    icon: MessageSquare,
    title: 'WhatsApp AI that sells',
    body: 'Answers availability, brochures, and FAQs instantly. Hands price and negotiation to your team when it matters.',
  },
  {
    icon: Users,
    title: 'Lead pipeline your way',
    body: 'Every stage editable by agents or admins. AI updates status as conversations progress.',
  },
  {
    icon: Building2,
    title: 'Inventory in minutes',
    body: 'Upload brochures, fill knowledge gaps, publish to catalog and AI index without spreadsheets.',
  },
  {
    icon: CalendarDays,
    title: 'Visits that stick',
    body: 'Book site visits from chat, sync calendar, and nudge agents before leads go cold.',
  },
];

const ROLES = [
  { role: 'Company admin', desc: 'Properties, AI brain, billing, team setup' },
  { role: 'Sales agent', desc: 'Leads, conversations, visits, takeover' },
  { role: 'Operations', desc: 'Scheduling and field coordination' },
  { role: 'Platform admin', desc: 'Multi-tenant companies and governance' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-muted text-ink-primary">
      <header className="sticky top-0 z-50 border-b border-surface-border/80 bg-surface-base/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Investo</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-ink-muted md:flex">
            <a href="#product" className="hover:text-ink-primary transition-colors">Product</a>
            <a href="#roles" className="hover:text-ink-primary transition-colors">Teams</a>
            <a href="#trust" className="hover:text-ink-primary transition-colors">Trust</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="investo-btn-ghost hidden sm:inline-flex">
              Sign in
            </Link>
            <Link to="/login" className="investo-btn-primary">
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-surface-border bg-surface-base">
        <div
          className="pointer-events-none absolute -right-24 top-0 h-[420px] w-[420px] rounded-full bg-brand-100/40 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 md:grid-cols-[1.1fr_0.9fr] md:px-8 md:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
              <Sparkles className="h-3.5 w-3.5" />
              Real estate AI platform
            </p>
            <h1 className="mt-6 font-display text-4xl leading-[1.1] text-ink-primary md:text-5xl lg:text-[3.25rem]">
              Close more deals without hiring another call center.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-secondary md:text-lg">
              Investo runs your WhatsApp funnel 24/7 with grounded property knowledge, then routes
              price talks and bookings to humans with full CRM visibility.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="investo-btn-primary px-6 py-3 text-base">
                Start with your agency
              </Link>
              <a href="#product" className="investo-btn-secondary px-6 py-3 text-base">
                See how it works
              </a>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-surface-border pt-8">
              {[
                { label: 'Response', value: '< 30s' },
                { label: 'AI + human', value: '90 / 10' },
                { label: 'Setup', value: 'Same day' },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{item.label}</dt>
                  <dd className="mt-1 text-lg font-semibold text-ink-primary">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="investo-card relative overflow-hidden p-0 shadow-investo-lg">
            <div className="border-b border-surface-border bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs text-slate-400">Investo · Live lead</span>
              </div>
            </div>
            <div className="space-y-4 bg-surface-muted p-5">
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-brand-600 px-3 py-2 text-sm text-white">
                Is the 3BHK at Palmvilla still available this weekend?
              </div>
              <div className="max-w-[90%] rounded-lg rounded-tl-sm border border-surface-border bg-surface-base px-3 py-2 text-sm text-ink-secondary">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-brand-700">
                  <Bot className="h-3 w-3" /> Investo AI
                </span>
                Yes — 3BHK east-facing units are available. I can book a Saturday 11am visit. Shall I confirm?
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Users className="h-3.5 w-3.5" />
                Price negotiation escalated to specialist
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl text-ink-primary">Built for agency operations, not chatbot demos.</h2>
          <p className="mt-3 text-ink-muted">
            Dense dashboards, role-based access, and audit-friendly workflows — the way production CRMs should feel.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title}
                className={`investo-card-pad ${i === 0 ? 'md:col-span-2 md:flex md:gap-6' : ''}`}
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" />
                </span>
                <div className={i === 0 ? 'md:pt-1' : 'mt-4'}>
                  <h3 className="text-base font-semibold text-ink-primary">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-surface-border bg-surface-base py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-3 md:px-8">
          {[
            { icon: Clock, title: 'Night inquiries captured', text: 'AI never sleeps; your pipeline does not leak after hours.' },
            { icon: BarChart3, title: 'Conversion you can measure', text: 'Funnel by status, visits, and closed-won in one analytics view.' },
            { icon: Shield, title: 'Grounded answers only', text: 'Listings and brochures drive replies — no invented pricing.' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="text-center md:text-left">
                <Icon className="mx-auto h-8 w-8 text-brand-600 md:mx-0" />
                <h3 className="mt-4 font-semibold text-ink-primary">{item.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{item.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section id="roles" className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
        <h2 className="font-display text-3xl text-ink-primary">One platform, every role.</h2>
        <p className="mt-2 text-ink-muted">From platform admin to field agent — permissions and UI adapt automatically.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.role} className="investo-card-pad flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-ink-primary">{r.role}</p>
                <p className="mt-1 text-sm text-ink-muted">{r.desc}</p>
              </div>
              <span className="rounded-md bg-surface-subtle px-2 py-1 text-xs font-medium text-ink-muted">RBAC</span>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="bg-slate-900 py-16 text-slate-200 md:py-20">
        <div className="mx-auto max-w-6xl px-4 text-center md:px-8">
          <h2 className="font-display text-3xl text-white">Enterprise-ready from day one.</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">
            Multi-tenant isolation, audit logs, feature gates, and WhatsApp provider flexibility for growing agencies.
          </p>
          <Link
            to="/login"
            className="investo-btn-primary mt-8 inline-flex bg-brand-500 hover:bg-brand-400"
          >
            Open your workspace
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-surface-border bg-surface-base py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-ink-muted md:flex-row md:px-8">
          <span>© {new Date().getFullYear()} Investo</span>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-ink-primary">Privacy</Link>
            <Link to="/login" className="hover:text-ink-primary">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
