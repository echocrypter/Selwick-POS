'use client';

import React, { useState, useEffect } from 'react';
import {
  Menu,
  Clock,
  Volume2,
  VolumeX,
  HelpCircle,
  Pause,
  Printer,
  Wifi,
} from 'lucide-react';
import { StoreSettings } from '@/types/pos';
import { ActiveTab } from '@/components/pos/Header';

interface TopBarProps {
  settings: StoreSettings;
  activeTab: ActiveTab;
  heldCount: number;
  onOpenHeld: () => void;
  onOpenShortcuts: () => void;
  onToggleSound: () => void;
  onToggleMobileSidebar: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  settings,
  activeTab,
  heldCount,
  onOpenHeld,
  onOpenShortcuts,
  onToggleSound,
  onToggleMobileSidebar,
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

  const getPageInfo = (): { title: string; subtitle: string } => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Dashboard',
          subtitle: 'Business overview, revenue metrics and quick sales actions',
        };
      case 'register':
        return {
          title: 'POS Register',
          subtitle: 'Point of sale billing, barcode scanning and cart checkout',
        };
      case 'inventory':
        return {
          title: 'Products',
          subtitle: 'Manage your product catalogue and inventory',
        };
      case 'customers':
        return {
          title: 'Customers',
          subtitle: 'Customer directory, purchase history and khata balances',
        };
      case 'expenses':
        return { title: 'Expenses & Reports', subtitle: 'Monthly and yearly profit after business expenses' };
      case 'sales':
        return {
          title: 'Sale History',
          subtitle: 'Sales invoices, transaction receipts, audit and refunds',
        };
      case 'users':
        return { title: 'Users', subtitle: 'Manage staff roles and business access' };
      case 'settings':
        return {
          title: 'Settings',
          subtitle: 'Store profile, thermal printer, tax, backup and cloud sync',
        };
      default:
        return {
          title: 'Selwick POS',
          subtitle: settings.tagline || 'Point of Sale System',
        };
    }
  };

  const { title, subtitle } = getPageInfo();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-800 selwick-topbar px-4 lg:px-6 backdrop-blur">
      {/* Left: Mobile hamburger & Active page title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          aria-label="Open sidebar navigation"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-base lg:text-lg font-bold tracking-tight text-white">
            {title}
          </h1>
          <p className="hidden sm:block truncate text-xs text-slate-400">
            {subtitle}
          </p>
        </div>
      </div>

      {/* Right: Status indicators & action controls */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Terminal status */}
        <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800/80 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 xl:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          <span>Terminal {settings.terminalId}</span>
        </div>

        {/* Thermal printer indicator */}
        <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800/80 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 2xl:flex">
          <Printer className="h-3.5 w-3.5 text-blue-400" />
          <span>Thermal Ready ({settings.printerPaperWidth})</span>
        </div>

        {/* Clock */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-mono text-xs text-slate-200">
          <Clock className="h-3.5 w-3.5 text-blue-400" />
          <span>{currentTime || 'Loading...'}</span>
        </div>

        {/* Held Carts Button */}
        <button
          type="button"
          onClick={onOpenHeld}
          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all ${
            heldCount > 0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          <Pause className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Held</span>
          <span
            className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
              heldCount > 0
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {heldCount}
          </span>
        </button>

        {/* Sound Toggle */}
        <button
          type="button"
          onClick={onToggleSound}
          title={settings.soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
          aria-label={settings.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          {settings.soundEnabled ? (
            <Volume2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <VolumeX className="h-4 w-4 text-rose-400" />
          )}
        </button>

        {/* Shortcuts Modal Trigger */}
        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts (F1 - F10)"
          aria-label="Open keyboard shortcuts"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <HelpCircle className="h-4 w-4 text-cyan-400" />
        </button>
      </div>
    </header>
  );
};
