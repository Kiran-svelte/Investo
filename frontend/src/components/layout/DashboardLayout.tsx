import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import useCompanyFeatures from '../../hooks/useCompanyFeatures';
import { getVisibleNavItems } from '../../config/navigation.config';
import type { NavRouteKey } from '../../config/navigation.config';
import LanguageSelector from '../common/LanguageSelector';
import KnowledgeGateBanner from './KnowledgeGateBanner';
import {
  LayoutDashboard,
  Users,
  Building,
  MessageSquare,
  CalendarDays,
  UserCog,
  BarChart3,
  Settings,
  BrainCircuit,
  Building2,
  CreditCard,
  ClipboardList,
  Bell,
  Calculator,
  LogOut,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const NAV_ICONS: Record<NavRouteKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: Users,
  properties: Building,
  conversations: MessageSquare,
  calendar: CalendarDays,
  agents: UserCog,
  analytics: BarChart3,
  ai_settings: BrainCircuit,
  companies: Building2,
  billing: CreditCard,
  emi_calculator: Calculator,
  audit_logs: ClipboardList,
  notifications: Bell,
  settings: Settings,
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Platform Admin',
  company_admin: 'Company Admin',
  sales_agent: 'Sales Agent',
  operations: 'Operations',
  viewer: 'Viewer',
};

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isFeatureEnabled, loading } = useCompanyFeatures();

  const visibleItems = getVisibleNavItems(user?.role, isFeatureEnabled);

  const linkClasses = (isActive: boolean) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-sidebar-accent/15 text-sidebar-active'
        : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-active'
    }`;

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="text-base font-semibold tracking-tight text-sidebar-active">Investo</span>
          {user?.role && (
            <p className="truncate text-xs text-sidebar-text">{ROLE_LABELS[user.role] || user.role}</p>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {loading && user?.role !== 'super_admin' ? (
          <div className="space-y-2 px-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-3 text-sm text-sidebar-text">No pages available for your role.</p>
        ) : (
          visibleItems.map((item) => {
            const Icon = NAV_ICONS[item.key];
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/dashboard'}
                onClick={onClose}
                className={({ isActive }) => linkClasses(isActive)}
              >
                <Icon className={`h-[1.125rem] w-[1.125rem] flex-shrink-0 ${'opacity-80'}`} />
                {t(`nav.${item.key}`, { defaultValue: item.labelFallback || item.key })}
              </NavLink>
            );
          })
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <p className="px-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-text/70">
          Enterprise CRM
        </p>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-[260px] lg:flex-col border-r border-sidebar-border bg-sidebar">
        {sidebarContent}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-sidebar shadow-investo-lg">
            <button
              type="button"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-sidebar-text hover:bg-white/10 hover:text-sidebar-active"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close sidebar</span>
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};

const Header: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-surface-border bg-surface-base/95 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        className="rounded-lg p-2 text-ink-muted hover:bg-surface-subtle hover:text-ink-primary lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Open sidebar</span>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <LanguageSelector />

        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-lg border border-surface-border px-2 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-subtle"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-800">
              {user?.name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) ?? '?'}
            </div>
            <span className="hidden max-w-[140px] truncate sm:block">{user?.name}</span>
            <ChevronDown className="h-4 w-4 text-ink-faint" />
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-surface-border bg-surface-elevated py-1 shadow-investo">
                <div className="border-b border-surface-border px-4 py-3">
                  <p className="text-sm font-semibold text-ink-primary">{user?.name}</p>
                  <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                  {user?.role && (
                    <p className="mt-1.5 text-xs font-medium text-brand-700">
                      {ROLE_LABELS[user.role] || user.role}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate('/', { replace: true });
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" />
                  {t('nav.logout')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

const DashboardLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="investo-app-shell bg-surface-muted">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-[260px]">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <KnowledgeGateBanner />
        <main className="min-h-[calc(100dvh-3.5rem)] w-full max-w-[100vw] overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
