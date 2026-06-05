import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Menu,
  MessageSquare,
  Shield,
  Sparkles,
  Users,
  BarChart3,
  Clock,
  Bot,
  X,
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
  { role: 'Company admin', desc: 'Properties, AI brain, analytics, team setup' },
  { role: 'Sales agent', desc: 'Leads, conversations, visits, takeover' },
  { role: 'Operations', desc: 'Scheduling and field coordination' },
  { role: 'Platform admin', desc: 'Multi-tenant companies and governance' },
];

const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#roles', label: 'Teams' },
  { href: '#trust', label: 'Trust' },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-surface-muted text-ink-primary">
      <header className="sticky top-0 z-50 border-b border-surface-border/80 bg-surface-base/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-3 sm:h-16 sm:px-6 md:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="truncate text-base font-semibold tracking-tight sm:text-lg">Investo</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted lg:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-ink-primary">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link to="/login" className="investo-btn-ghost hidden px-2 sm:inline-flex">
              Sign in
            </Link>
            <Link to="/login" className="investo-btn-primary whitespace-nowrap px-3 text-xs sm:px-4 sm:text-sm">
              <span className="hidden xs:inline">Get started</span>
              <span className="xs:hidden">Start</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              className="investo-touch-target rounded-lg p-2 text-ink-muted hover:bg-surface-subtle lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} aria-hidden />
            <div className="absolute right-0 top-0 flex h-full w-[min(100%,280px)] flex-col bg-surface-base shadow-investo-lg">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <span className="font-semibold text-ink-primary">Menu</span>
                <button type="button" onClick={() => setMenuOpen(false)} className="investo-touch-target rounded-lg p-2">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 p-3">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-3 py-3 text-sm font-medium text-ink-secondary hover:bg-surface-subtle"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="investo-btn-primary mt-2 w-full justify-center"
                >
                  Sign in
                </Link>
              </nav>
            </div>
          </div>
        )}
      </header>

      <section className="relative overflow-hidden border-b border-surface-border bg-surface-base">
        <div
          className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-brand-100/50 blur-3xl sm:h-[420px] sm:w-[420px]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-3 py-10 sm:px-6 sm:py-16 md:grid-cols-[1.05fr_0.95fr] md:gap-12 md:px-8 md:py-20">
          <div className="min-w-0">
            <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
              Real estate AI platform
            </p>
            <h1 className="mt-5 font-display text-[1.75rem] leading-[1.12] text-ink-primary sm:mt-6 sm:text-4xl md:text-5xl lg:text-[3.15rem]">
              Close more deals without another call center.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-secondary sm:mt-5 sm:text-base md:text-lg">
              WhatsApp AI with grounded property knowledge. Price and booking hand off to your team with full CRM visibility.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3">
              <Link to="/login" className="investo-btn-primary w-full justify-center px-6 py-3 text-base sm:w-auto">
                Start with your agency
              </Link>
              <a href="#product" className="investo-btn-secondary w-full justify-center px-6 py-3 text-base sm:w-auto">
                See how it works
              </a>
            </div>
            <dl className="mt-8 grid grid-cols-3 gap-2 border-t border-surface-border pt-6 sm:gap-4 sm:pt-8">
              {[
                { label: 'Response', value: '< 30s' },
                { label: 'AI + human', value: '90 / 10' },
                { label: 'Setup', value: 'Same day' },
              ].map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-ink-faint sm:text-xs">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-ink-primary sm:mt-1 sm:text-lg">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="investo-card min-w-0 overflow-hidden p-0 shadow-investo-lg">
            <div className="border-b border-surface-border bg-slate-900 px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-1 truncate text-xs text-slate-400">Investo · Live lead</span>
              </div>
            </div>
            <div className="space-y-3 bg-surface-muted p-4 sm:space-y-4 sm:p-5">
              <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-sm bg-brand-600 px-3 py-2 text-xs text-white sm:text-sm">
                Is the 3BHK at Palmvilla still available this weekend?
              </div>
              <div className="max-w-[95%] rounded-lg rounded-tl-sm border border-surface-border bg-surface-base px-3 py-2 text-xs text-ink-secondary sm:text-sm">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-brand-700">
                  <Bot className="h-3 w-3" /> Investo AI
                </span>
                Yes — 3BHK east-facing units are available. I can book a Saturday 11am visit. Shall I confirm?
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 sm:text-xs">
                <Users className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                Price negotiation escalated to specialist
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-6xl px-3 py-12 sm:px-6 sm:py-16 md:px-8 md:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl text-ink-primary sm:text-3xl">Built for agency operations, not chatbot demos.</h2>
          <p className="mt-3 text-sm text-ink-muted sm:text-base">
            Dense dashboards, role-based access, and audit-friendly workflows.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title}
                className={`investo-card-pad ${i === 0 ? 'md:col-span-2 md:flex md:gap-6' : 'flex flex-col sm:block'}`}
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" />
                </span>
                <div className={i === 0 ? 'mt-4 md:mt-0 md:pt-1' : 'mt-4'}>
                  <h3 className="text-base font-semibold text-ink-primary">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-surface-border bg-surface-base py-12 sm:py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-3 sm:grid-cols-3 sm:px-6 md:px-8">
          {[
            { icon: Clock, title: 'Night inquiries captured', text: 'AI never sleeps; your pipeline does not leak after hours.' },
            { icon: BarChart3, title: 'Conversion you can measure', text: 'Funnel by status, visits, and closed-won in one view.' },
            { icon: Shield, title: 'Grounded answers only', text: 'Listings and brochures drive replies. No invented pricing.' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="text-left sm:text-center md:text-left">
                <Icon className="h-8 w-8 text-brand-600" />
                <h3 className="mt-3 font-semibold text-ink-primary sm:mt-4">{item.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{item.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section id="roles" className="mx-auto max-w-6xl px-3 py-12 sm:px-6 sm:py-16 md:px-8 md:py-20">
        <h2 className="font-display text-2xl text-ink-primary sm:text-3xl">One platform, every role.</h2>
        <p className="mt-2 text-sm text-ink-muted sm:text-base">Permissions and UI adapt from platform admin to field agent.</p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.role} className="investo-card-pad flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-ink-primary">{r.role}</p>
                <p className="mt-1 text-sm text-ink-muted">{r.desc}</p>
              </div>
              <span className="w-fit rounded-md bg-surface-subtle px-2 py-1 text-xs font-medium text-ink-muted">RBAC</span>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="bg-slate-900 py-12 text-slate-200 sm:py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-3 text-center sm:px-6 md:px-8">
          <h2 className="font-display text-2xl text-white sm:text-3xl">Enterprise-ready from day one.</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-slate-400 sm:text-base">
            Multi-tenant isolation, audit logs, feature gates, and WhatsApp flexibility for growing agencies.
          </p>
          <Link
            to="/login"
            className="investo-btn-primary mt-6 inline-flex w-full max-w-xs justify-center bg-brand-500 hover:bg-brand-400 sm:mt-8 sm:w-auto"
          >
            Open your workspace
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-surface-border bg-surface-base py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-3 text-sm text-ink-muted sm:flex-row sm:px-6 md:px-8">
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
