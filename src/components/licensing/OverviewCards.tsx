'use strict';
'use client';

import React from 'react';
import { ShieldCheck, Laptop, Clock, AlertTriangle, Ban, Key, Sparkles } from 'lucide-react';
import { LicenseDashboardMetrics } from '@/lib/licensing/types';

interface OverviewCardsProps {
  metrics: LicenseDashboardMetrics | null;
  loading: boolean;
}

export const OverviewCards: React.FC<OverviewCardsProps> = ({ metrics, loading }) => {
  const cards = [
    {
      title: 'Total Licenses',
      value: metrics?.totalLicenses ?? 0,
      icon: Key,
      textColor: 'text-white',
      badgeBg: 'bg-slate-800 text-slate-300',
      description: 'All issued keys',
    },
    {
      title: 'Active Commercial',
      value: metrics?.activeLicenses ?? 0,
      icon: ShieldCheck,
      textColor: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      description: 'Operational in market',
    },
    {
      title: 'Trial Licenses',
      value: metrics?.trialLicenses ?? 0,
      icon: Sparkles,
      textColor: 'text-sky-400',
      badgeBg: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
      description: '14-day prospect trials',
    },
    {
      title: 'Active Terminals',
      value: metrics?.activeDevices ?? 0,
      icon: Laptop,
      textColor: 'text-indigo-400',
      badgeBg: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
      description: 'Currently paired POS PCs',
    },
    {
      title: 'Expiring Soon',
      value: metrics?.expiringSoon ?? 0,
      icon: Clock,
      textColor: metrics?.expiringSoon ? 'text-amber-400' : 'text-slate-400',
      badgeBg: metrics?.expiringSoon
        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
        : 'bg-slate-800 text-slate-400',
      description: 'Expiring within 7 days',
    },
    {
      title: 'Expired / Inactive',
      value: metrics?.expiredLicenses ?? 0,
      icon: AlertTriangle,
      textColor: 'text-rose-400',
      badgeBg: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
      description: 'Past due entitlements',
    },
    {
      title: 'Suspended / Revoked',
      value: (metrics?.suspendedLicenses ?? 0) + (metrics?.revokedLicenses ?? 0),
      icon: Ban,
      textColor: 'text-orange-400',
      badgeBg: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
      description: 'Admin blocked licenses',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <div
            key={i}
            className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {c.title}
              </span>
              <div className={`p-1.5 rounded-lg ${c.badgeBg}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className={`text-2xl font-black ${c.textColor}`}>
                {loading ? '—' : c.value.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-medium truncate">
                {c.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

