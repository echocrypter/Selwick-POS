
'use client';

import React, { useState, useEffect } from 'react';
import {
  Store,
  ShoppingCart,
  Package,
  Users,
  FileText,
  Settings,
  Clock,
  Volume2,
  VolumeX,
  HelpCircle,
  Pause,
  Printer,
  Wifi,
  Sparkles,
} from 'lucide-react';
import { StoreSettings } from '@/types/pos';

export type ActiveTab =
  | 'dashboard'
  | 'register'
  | 'inventory'
  | 'customers'
  | 'sales'
  | 'expenses'
  | 'settings'
  | 'users';

interface HeaderProps {
  settings: StoreSettings;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  heldCount: number;
  onOpenHeld: () => void;
  onOpenShortcuts: () => void;
  onToggleSound: () => void;
  cartCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  activeTab,
  onTabChange,
  heldCount,
  onOpenHeld,
  onOpenShortcuts,
  onToggleSound,
  cartCount,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      setCurrentTime(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }) +
          ' ' +
          now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })
      );
    };

    updateTime();

    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []);

  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    shortcut: string;
  }[] = [
    {
      id: 'register',
      label: 'POS Register',
      icon: ShoppingCart,
      badge: cartCount > 0 ? cartCount : undefined,
      shortcut: 'F1',
    },
    {
      id: 'inventory',
      label: 'Stock & Items',
      icon: Package,
      shortcut: 'F3',
    },
    {
      id: 'customers',
      label: 'Customers & Khata',
      icon: Users,
      shortcut: 'F6',
    },
    {
      id: 'sales',
      label: 'Sales History',
      icon: FileText,
      shortcut: 'F7',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      shortcut: 'F10',
    },
  ];

  return (
    <header className="sticky top-0 z-30 select-none border-b border-slate-800 bg-slate-900 text-white shadow-lg">
      {/* Top status bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60 px-4 py-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1.5 font-medium text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <Wifi className="h-3.5 w-3.5" />
            <span>Terminal {settings.terminalId}</span>
          </div>

          <span className="hidden text-slate-600 sm:inline">|</span>

          <div className="hidden items-center gap-1.5 text-slate-300 sm:flex">
            <Printer className="h-3.5 w-3.5 text-blue-400" />
            <span>
              Thermal Ready ({settings.printerPaperWidth})
            </span>
          </div>

          <span className="hidden text-slate-600 lg:inline">|</span>

          <div className="hidden items-center gap-1.5 text-blue-300 md:flex">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Selwick POS {settings.version}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-slate-200 sm:px-2.5 sm:py-0.5">
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            <span>{currentTime || 'Loading clock...'}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleSound}
              title={settings.soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
              aria-label={
                settings.soundEnabled ? 'Mute sounds' : 'Unmute sounds'
              }
              className="rounded p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {settings.soundEnabled ? (
                <Volume2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-rose-400" />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenShortcuts}
              title="Keyboard Shortcuts (F1 - F10)"
              aria-label="Open keyboard shortcuts"
              className="rounded p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <HelpCircle className="h-4 w-4 text-cyan-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
        {/* Selwick product branding */}
        <div className="flex items-center gap-3">
          <img src="/selwick-logo.png" alt="Selwick POS" className="h-10 w-10 shrink-0 rounded-xl object-cover" />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">
                Selwick
              </h1>

              <span className="rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                POS
              </span>
            </div>

            {/* Fixed: display the tagline, not the store name */}
            <p className="text-xs text-slate-400">
              {settings.tagline || 'Smart Business Management'}
            </p>
          </div>
        </div>

        {/* Navigation tabs */}
        <nav
          aria-label="Main navigation"
          className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-800/80 bg-slate-950/80 p-1 shadow-inner"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all sm:px-3.5 ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? 'text-white' : 'text-slate-400'
                  }`}
                />

                <span>{item.label}</span>

                <span className="hidden rounded bg-black/30 px-1 py-0.5 font-mono text-[9px] text-slate-300 lg:inline">
                  {item.shortcut}
                </span>

                {item.badge !== undefined && (
                  <span className="ml-0.5 animate-pulse rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Held carts */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenHeld}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
              heldCount > 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Pause className="h-3.5 w-3.5" />

            <span>Held Carts</span>

            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                heldCount > 0
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              {heldCount}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
