import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, UserRole } from '../../context/AuthContext';
import useCompanyFeatures from '../../hooks/useCompanyFeatures';
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

// ──────────────────────────────────────────────
// Navigation configuration
// ──────────────────────────────────────────────

interface NavItem {
  label: string; // i18n key under "nav"
  labelText?: string;
  path: string;
  icon: LucideIcon;
  roles: UserRole[]; // which roles can see this item
  featureKey?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'dashboard',
    path: '/',
    icon: LayoutDashboard,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
  },
  {
    label: 'leads',
    path: '/leads',
    icon: Users,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
    featureKey: 'lead_automation',
  },
  {
    label: 'properties',
    path: '/properties',
    icon: Building,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
    featureKey: 'property_management',
  },
  {
    label: 'conversations',
    path: '/conversations',
    icon: MessageSquare,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
    featureKey: 'conversation_center',
  },
  {
    label: 'calendar',
    path: '/calendar',
    icon: CalendarDays,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
    featureKey: 'visit_scheduling',
  },
  {
    label: 'agents',
    path: '/agents',
    icon: UserCog,
    roles: ['super_admin', 'company_admin'],
    featureKey: 'agent_management',
  },
  {
    label: 'analytics',
    path: '/analytics',
    icon: BarChart3,
    roles: ['super_admin', 'company_admin'],
    featureKey: 'analytics',
  },
  {
    label: 'ai_settings',
    path: '/ai-settings',
    icon: BrainCircuit,
    roles: ['super_admin', 'company_admin'],
    featureKey: 'ai_bot',
  },
  {
    label: 'companies',
    path: '/companies',
    icon: Building2,
    roles: ['super_admin'],
  },
  {
    label: 'billing',
    path: '/billing',
    icon: CreditCard,
    roles: ['super_admin', 'company_admin'],
  },
  {
    label: 'emi_calculator',
    labelText: 'EMI Calculator',
    path: '/emi-calculator',
    icon: Calculator,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
  },
  {
    label: 'audit_logs',
    path: '/audit-logs',
    icon: ClipboardList,
    roles: ['super_admin'],
    featureKey: 'audit_logs',
  },
  {
    label: 'notifications',
    path: '/notifications',
    icon: Bell,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
    featureKey: 'notifications',
  },
  {
    label: 'settings',
    path: '/settings',
    icon: Settings,
    roles: ['super_admin', 'company_admin', 'sales_agent'],
  },
];

// ──────────────────────────────────────────────
// Sidebar component
// ──────────────────────────────────────────────

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isFeatureEnabled, loading } = useCompanyFeatures();

  const visibleItems = NAV_ITEMS.filter((item) =>
    user ? item.roles.includes(user.role) && isFeatureEnabled(item.featureKey) : false,
  );

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
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Building2 className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-gray-900">Investo</span>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onClose}
            className={({ isActive }) => linkClasses(isActive)}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {t(`nav.${item.label}`, { defaultValue: item.labelText || item.label })}
          </NavLink>
        ))}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col border-r border-gray-200 bg-white">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white shadow-xl">
            {/* Close button */}
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

// ──────────────────────────────────────────────
// Header component
// ──────────────────────────────────────────────

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
      {/* Hamburger (mobile) */}
      <button
        type="button"
        className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Open sidebar</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right-hand controls */}
      <div className="flex items-center gap-3">
        <LanguageSelector />

        {/* User menu */}
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
            <span className="hidden sm:block">{user?.name}</span>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setUserMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg bg-white py-1 shadow-lg ring-1 ring-gray-200">
                <div className="border-b border-gray-100 px-4 py-2">
                  <p className="text-sm font-medium text-gray-900">
                    {user?.name}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {user?.email}
                  </p>
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

// ──────────────────────────────────────────────
// DashboardLayout
// ──────────────────────────────────────────────

const DashboardLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area – offset for the desktop sidebar */}
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
