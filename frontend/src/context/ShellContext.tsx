import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'investo_sidebar_collapsed';

export const SIDEBAR_WIDTH_EXPANDED = 260;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

interface ShellContextValue {
  collapsed: boolean;
  mobileOpen: boolean;
  sidebarWidth: number;
  setMobileOpen: (open: boolean) => void;
  toggleCollapsed: () => void;
  closeMobile: () => void;
}

const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export const ShellProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const value = useMemo<ShellContextValue>(
    () => ({
      collapsed,
      mobileOpen,
      sidebarWidth: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
      setMobileOpen,
      toggleCollapsed,
      closeMobile,
    }),
    [collapsed, mobileOpen, toggleCollapsed, closeMobile],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell must be used within ShellProvider');
  }
  return ctx;
}
