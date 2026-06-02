import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import useCompanyFeatures from '../../hooks/useCompanyFeatures';
import { getVisibleNavItems } from '../../config/navigation.config';
import type { NavRouteKey } from '../../config/navigation.config';
import LanguageSelector from '../common/LanguageSelector';
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

  if (loading && user?.role !== 'super_admin') {
    return (
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col border-r border-gray-200 bg-white" />
    );
  }

  const linkClasses = (isActive: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 text-blue-700'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="text-lg font-bold text-gray-900">Investo</span>
          {user?.role && (
            <p className="truncate text-xs text-gray-500">{ROLE_LABELS[user.role] || user.role}</p>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.length === 0 ? (
          <p className="px-3 text-sm text-gray-500">No pages available for your role.</p>
        ) : (
          visibleItems.map((item) => {
            const Icon = NAV_ICONS[item.key];
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={onClose}
                className={({ isActive }) => linkClasses(isActive)}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {t(`nav.${item.key}`, { defaultValue: item.labelFallback || item.key })}
              </NavLink>
            );
          })
        )}
      </nav>
    </>
  );

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col border-r border-gray-200 bg-white">
        {sidebarContent}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-4 rounded-md p-1 text-gray-400 hover:text-gray-600"
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

interface HeaderProps {
  onMenuClick: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 sm:px-6">
      <button
        type="button"
        className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Open sidebar</span>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <LanguageSelector />

        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
              {user?.name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) ?? '?'}
            </div>
            <span className="hidden sm:block max-w-[140px] truncate">{user?.name}</span>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setUserMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg bg-white py-1 shadow-lg ring-1 ring-gray-200">
                <div className="border-b border-gray-100 px-4 py-2">
                  <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                  <p className="truncate text-xs text-gray-500">{user?.email}</p>
                  {user?.role && (
                    <p className="mt-1 text-xs font-medium text-blue-600">
                      {ROLE_LABELS[user.role] || user.role}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
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
    <div className="min-h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
