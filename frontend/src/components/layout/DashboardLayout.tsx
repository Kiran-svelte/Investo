import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import useCompanyFeatures from '../../hooks/useCompanyFeatures';
import {
  dashboardPath,
  getVisibleNavGroups,
  DASHBOARD_BASE,
  type NavRouteKey,
  type NavGroupKey,
} from '../../config/navigation.config';
import { ShellProvider, useShell, SIDEBAR_WIDTH_EXPANDED } from '../../context/ShellContext';
import LanguageSelector from '../common/LanguageSelector';
import KnowledgeGateBanner from './KnowledgeGateBanner';
import TenantCompanySwitcher from './TenantCompanySwitcher';
import NotificationBell from './NotificationBell';
import PageTransition from './PageTransition';
import PageErrorBoundary from '../PageErrorBoundary';
import InvestoLoading from '../loading/InvestoLoading';
import InvestoLogo from '../brand/InvestoLogo';
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
  ClipboardList,
  Bell,
  Calculator,
  CreditCard,
  LogOut,
  Mail,
  Menu,
  X,
  ChevronDown,
  User,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  AlertTriangle,
  Bot,
  Activity,
  Gauge,
  Shield,
  GitBranch,
  Scale,
  Plug,
  HeartPulse,
  LifeBuoy,
  HardDrive,
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
  platform_health: Activity,
  observability: Activity,
  message_failures: AlertTriangle,
  emi_calculator: Calculator,
  audit_logs: ClipboardList,
  error_logs: AlertTriangle,
  ai_action_logs: Bot,
  copilot: BrainCircuit,
  notifications: Bell,
  usage: Gauge,
  security: Shield,
  security_dashboard: Shield,
  branches: GitBranch,
  compliance: Scale,
  integrations: Plug,
  ai_governance: Bot,
  tenant_health: HeartPulse,
  support_tools: LifeBuoy,
  dr_status: HardDrive,
  billing: CreditCard,
  agency_invites: Mail,
  settings: Settings,
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Platform Admin',
  company_admin: 'Company Admin',
  sales_agent: 'Sales Agent',
  operations: 'Operations',
  viewer: 'Viewer',
};

const GROUP_LABEL_KEYS: Record<NavGroupKey, string> = {
  workspace: 'nav.group.workspace',
  pipeline: 'nav.group.pipeline',
  intelligence: 'nav.group.intelligence',
  admin: 'nav.group.admin',
  platform: 'nav.group.platform',
};

const SidebarNav: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isFeatureEnabled, loading } = useCompanyFeatures();
  const { collapsed, closeMobile } = useShell();
  const reduceMotion = useReducedMotion();

  const groups = getVisibleNavGroups(user?.role, isFeatureEnabled);

  const linkClasses = (isActive: boolean) =>
    `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-sidebar-accent/20 text-sidebar-active shadow-sm'
        : 'text-sidebar-text hover:bg-white/8 hover:text-sidebar-active'
    } ${collapsed ? 'justify-center px-2' : ''}`;

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-4 investo-sidebar-scroll">
      {loading && user?.role !== 'super_admin' ? (
        <div className="space-y-3 px-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-white/10" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="px-3 text-sm text-sidebar-text">{t('nav.empty', { defaultValue: 'No pages for your role.' })}</p>
      ) : (
        groups.map((group, groupIndex) => (
          <motion.div
            key={group.key}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: groupIndex * 0.04, duration: 0.25 }}
            className="mb-4"
          >
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-text/60">
                {t(GROUP_LABEL_KEYS[group.key], { defaultValue: group.key })}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.key];
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === DASHBOARD_BASE}
                      onClick={closeMobile}
                      title={collapsed ? t(`nav.${item.key}`, { defaultValue: item.labelFallback || item.key }) : undefined}
                      className={({ isActive }) => linkClasses(isActive)}
                    >
                      <Icon className="h-[1.125rem] w-[1.125rem] flex-shrink-0 opacity-90" />
                      {!collapsed && (
                        <span className="truncate">
                          {t(`nav.${item.key}`, { defaultValue: item.labelFallback || item.key })}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ))
      )}
    </nav>
  );
};

const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { collapsed, mobileOpen, toggleCollapsed, closeMobile, sidebarWidth } = useShell();
  const reduceMotion = useReducedMotion();

  const brand = (
    <div className={`flex h-16 items-center border-b border-sidebar-border ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}>
      <InvestoLogo height={collapsed ? 28 : 32} className={collapsed ? 'max-w-[2.5rem] object-left' : ''} />
      {!collapsed && user?.role && (
        <p className="min-w-0 truncate text-xs text-sidebar-text">{ROLE_LABELS[user.role] || user.role}</p>
      )}
    </div>
  );

  const footer = (
    <div className={`border-t border-sidebar-border p-2 ${collapsed ? 'flex justify-center' : ''}`}>
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-text transition-colors hover:bg-white/8 hover:text-sidebar-active"
        aria-label={collapsed ? t('nav.expand', { defaultValue: 'Expand sidebar' }) : t('nav.collapse', { defaultValue: 'Collapse sidebar' })}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        {!collapsed && <span>{t('nav.collapse', { defaultValue: 'Collapse' })}</span>}
      </button>
    </div>
  );

  const panel = (
    <aside
      className="flex h-full flex-col border-r border-sidebar-border bg-sidebar"
      style={{ width: sidebarWidth }}
    >
      {brand}
      {!collapsed && <div className="px-2 pt-3"><TenantCompanySwitcher /></div>}
      <SidebarNav />
      {footer}
    </aside>
  );

  const desktopSidebar = (
    <motion.div
      className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex"
      animate={{ width: sidebarWidth }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
    >
      {panel}
    </motion.div>
  );

  const mobileOverlay = mobileOpen ? (
    <div className="fixed inset-0 z-40 lg:hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={closeMobile}
        aria-hidden="true"
      />
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-sidebar shadow-investo-lg"
      >
        <button
          type="button"
          className="absolute right-3 top-4 rounded-lg p-1.5 text-sidebar-text hover:bg-white/10"
          onClick={closeMobile}
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close menu</span>
        </button>
        <div className="flex h-full w-full flex-col" style={{ width: SIDEBAR_WIDTH_EXPANDED }}>
          {brand}
          <SidebarNav />
          {footer}
        </div>
      </motion.aside>
    </div>
  ) : null;

  return (
    <>
      {desktopSidebar}
      {mobileOverlay}
    </>
  );
};

const Header: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { setMobileOpen } = useShell();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [userMenuOpen]);

  return (
    <>
    {signingOut ? <InvestoLoading variant="logout" /> : null}
    <header className="investo-topbar sticky top-0 z-30">
      <button
        type="button"
        className="investo-icon-btn lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">{t('nav.open_menu', { defaultValue: 'Open menu' })}</span>
      </button>

      <div className="hidden min-w-0 flex-1 lg:block">
        <p className="truncate text-sm font-medium text-ink-primary">{user?.name}</p>
        <p className="truncate text-xs text-ink-muted">
          {user?.role ? ROLE_LABELS[user.role] || user.role : ''}
        </p>
      </div>

      <div className="flex-1 lg:flex-none" />

      <div className="flex items-center gap-2">
        <NotificationBell />
        <LanguageSelector />

        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm font-medium text-ink-secondary shadow-sm transition-all hover:border-brand-200 hover:shadow-investo"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
              {user?.name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) ?? '?'}
            </div>
            <span className="hidden max-w-[120px] truncate md:block">{user?.name}</span>
            <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {userMenuOpen && (
            <div role="menu" className="investo-dropdown-panel right-0 mt-2 w-60">
              <div className="border-b border-surface-border px-4 py-3">
                <p className="text-sm font-semibold text-ink-primary">{user?.name}</p>
                <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                {user?.role && (
                  <p className="mt-1.5 text-xs font-medium text-brand-700">
                    {ROLE_LABELS[user.role] || user.role}
                  </p>
                )}
              </div>
              <Link
                to={dashboardPath('/profile')}
                role="menuitem"
                onClick={() => setUserMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-ink-secondary hover:bg-surface-subtle"
              >
                <User className="h-4 w-4" />
                {t('nav.profile', { defaultValue: 'My profile' })}
              </Link>
              <Link
                to={dashboardPath('/settings')}
                role="menuitem"
                onClick={() => setUserMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-ink-secondary hover:bg-surface-subtle"
              >
                <Settings className="h-4 w-4" />
                {t('nav.settings', { defaultValue: 'Settings' })}
              </Link>
              <Link
                to="/change-password"
                role="menuitem"
                onClick={() => setUserMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-ink-secondary hover:bg-surface-subtle"
              >
                <KeyRound className="h-4 w-4" />
                {t('nav.change_password', { defaultValue: 'Change password' })}
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  setSigningOut(true);
                  logout();
                  navigate('/', { replace: true });
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    </>
  );
};

const DashboardShell: React.FC = () => {
  const { sidebarWidth } = useShell();
  const location = useLocation();

  return (
    <div
      className="investo-app-shell bg-surface-muted"
      style={{ '--investo-sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar />
      <div className="investo-main-column min-h-[100dvh]">
        <Header />
        <KnowledgeGateBanner />
        <main className="min-h-[calc(100dvh-3.5rem)] w-full max-w-[100vw] overflow-x-hidden">
          <PageErrorBoundary resetKey={location.pathname}>
            <PageTransition />
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  );
};

const DashboardLayout: React.FC = () => (
  <ShellProvider>
    <DashboardShell />
  </ShellProvider>
);

export default DashboardLayout;
