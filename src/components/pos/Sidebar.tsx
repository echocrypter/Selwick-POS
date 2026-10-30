'use client';

import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  FileText,
  ChartNoAxesCombined,
  Settings,
  Store,
  ChevronLeft,
  ChevronRight,
  X,
  UserCog,
  Terminal,
} from 'lucide-react';
import { StoreSettings } from '@/types/pos';
import { ActiveTab } from '@/components/pos/Header';

interface SidebarProps {
  settings: StoreSettings;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  cartCount: number;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  showUsers?: boolean;
  cashierMode?: boolean;
  showExpenses?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  settings,
  activeTab,
  onTabChange,
  cartCount,
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
  showUsers = false,
  cashierMode = false,
  showExpenses = true,
}) => {
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    shortcut?: string;
  }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      shortcut: 'F5',
    },
    {
      id: 'register',
      label: 'POS Register',
      icon: ShoppingCart,
      badge: cartCount > 0 ? cartCount : undefined,
      shortcut: 'F1',
    },
    {
      id: 'inventory',
      label: 'Products',
      icon: Package,
      shortcut: 'F3',
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: Users,
      shortcut: 'F6',
    },
    {
      id: 'sales',
      label: 'Sale History',
      icon: FileText,
      shortcut: 'F7',
    },
    ...(showExpenses ? [{ id: 'expenses' as ActiveTab, label: 'Expenses & Reports', icon: ChartNoAxesCombined }] : []),
    ...(showUsers ? [{ id: 'users' as ActiveTab, label: 'Users', icon: UserCog }] : []),
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      shortcut: 'F10',
    },
  ];
  const visibleNavItems = navItems.filter(item => !cashierMode || ['register', 'customers', 'users'].includes(item.id));

  const handleNavClick = (tab: ActiveTab) => {
    onTabChange(tab);
    onClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close navigation menu"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
              onClose();
            }
          }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-800 selwick-sidebar text-white transition-all duration-300 ease-in-out lg:static lg:z-30 lg:translate-x-0 ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } ${isCollapsed ? 'lg:w-20' : 'w-64 lg:w-64'}`}
      >
        {/* Brand / Logo Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 px-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src="/selwick-logo.png" alt="Selwick POS" className="h-10 w-10 shrink-0 rounded-xl object-cover" />

            {(!isCollapsed || isOpen) && (
              <div className="min-w-0 transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-bold tracking-tight text-white">
                    Selwick POS
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate-400">
                  Smart Business Management
                </p>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:flex"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav
          aria-label="Sidebar navigation"
          className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4"
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? item.label : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                } ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 transition-colors ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />

                {(!isCollapsed || isOpen) && (
                  <span className="truncate">{item.label}</span>
                )}

                {/* Badge for cart count */}
                {item.badge !== undefined && (
                  <span
                    className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${
                      isActive
                        ? 'bg-white text-blue-700'
                        : 'bg-amber-500 text-slate-950'
                    } ${isCollapsed ? 'lg:absolute lg:-top-1 lg:-right-1' : ''}`}
                  >
                    {item.badge}
                  </span>
                )}

                {/* Keyboard shortcut indicator */}
                {(!isCollapsed || isOpen) && item.shortcut && item.badge === undefined && (
                  <span
                    className={`ml-auto font-mono text-[10px] rounded px-1.5 py-0.5 ${
                      isActive
                        ? 'bg-blue-700/60 text-blue-100'
                        : 'bg-slate-900/60 text-slate-500'
                    }`}
                  >
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer Area: User Card & Brand Status */}
        <div className="shrink-0 space-y-2 border-t border-slate-800/80 p-3">
          {/* Powered by Card */}
          {(!isCollapsed || isOpen) && (
            <div className="rounded-xl border border-slate-900 bg-slate-950/80 p-2 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                POWERED BY
              </p>
              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-300">
                <Terminal className="h-3 w-3 text-blue-400" />
                <span>Selwick POS</span>
                <span className="rounded bg-blue-500/10 px-1 py-0.2 text-[9px] text-blue-300">
                  {settings.version}
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
