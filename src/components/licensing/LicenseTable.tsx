'use strict';
'use client';

import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  RotateCcw,
  Share2,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Clock,
  Laptop,
} from 'lucide-react';
import { LicenseRecord } from '@/lib/licensing/types';

interface LicenseTableProps {
  licenses: Array<LicenseRecord & { activeDevices: number }>;
  loading: boolean;
  onSelectLicense: (id: string) => void;
  onOpenCustomerDelivery: (lic: LicenseRecord) => void;
  onQuickRenew: (id: string) => void;
}

export const LicenseTable: React.FC<LicenseTableProps> = ({
  licenses,
  loading,
  onSelectLicense,
  onOpenCustomerDelivery,
  onQuickRenew,
}) => {
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKeys, setCopiedKeys] = useState<Record<string, boolean>>({});

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeys((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedKeys((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
        <div className="inline-block animate-spin mr-2">↻</div>
        Loading commercial licenses...
      </div>
    );
  }

  if (licenses.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
        <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-white">No licenses found</p>
        <p className="text-xs text-slate-500 mt-1">
          Adjust your search or filter criteria, or generate a new commercial license above.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-3.5 px-4">Merchant / Customer</th>
              <th className="py-3.5 px-4">License Key</th>
              <th className="py-3.5 px-4">Plan Tier</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4">Devices</th>
              <th className="py-3.5 px-4">Expiry Date</th>
              <th className="py-3.5 px-4">Created</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {licenses.map((lic) => {
              const isRevealed = revealedKeys[lic.id] || false;
              const isCopied = copiedKeys[lic.id] || false;

              const isExpired =
                lic.status === 'expired' ||
                (lic.expiresAt && new Date(lic.expiresAt).getTime() < Date.now());

              const formattedExpiry = lic.expiresAt
                ? new Date(lic.expiresAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'Never (Lifetime)';

              const formattedCreated = new Date(lic.createdAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });

              return (
                <tr
                  key={lic.id}
                  className="hover:bg-slate-850/50 transition group cursor-pointer"
                  onClick={() => onSelectLicense(lic.id)}
                >
                  {/* Customer */}
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-white group-hover:text-emerald-400 transition">
                      {lic.customerName}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate max-w-[200px]">
                      {lic.email}
                    </div>
                  </td>

                  {/* License Key */}
                  <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="text-slate-200">
                        {isRevealed
                          ? lic.licenseKey
                          : lic.licenseKey.substring(0, 9) + '••••-••••-••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleReveal(lic.id)}
                        className="p-1 text-slate-500 hover:text-white transition"
                        title={isRevealed ? 'Mask' : 'Reveal'}
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyKey(lic.id, lic.licenseKey)}
                        className="p-1 text-slate-500 hover:text-emerald-400 transition"
                        title="Copy Key"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>

                  {/* Plan */}
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        lic.plan === 'lifetime'
                          ? 'bg-purple-500/10 text-purple-300 border border-purple-500/30'
                          : lic.plan === 'yearly'
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                          : lic.plan === 'monthly'
                          ? 'bg-sky-500/10 text-sky-300 border border-sky-500/30'
                          : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {lic.plan}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        lic.status === 'active' && !isExpired
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : lic.status === 'suspended'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : lic.status === 'revoked'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isExpired && lic.status === 'active' ? 'Expired' : lic.status}
                    </span>
                  </td>

                  {/* Devices */}
                  <td className="py-3.5 px-4 font-mono">
                    <span
                      className={
                        lic.activeDevices >= lic.maxDevices ? 'text-amber-400 font-bold' : 'text-slate-300'
                      }
                    >
                      {lic.activeDevices}
                    </span>
                    <span className="text-slate-500"> / {lic.maxDevices}</span>
                  </td>

                  {/* Expiry */}
                  <td className="py-3.5 px-4">
                    <span className={isExpired ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                      {formattedExpiry}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                    {formattedCreated}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenCustomerDelivery(lic)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
                        title="Customer Onboarding Message"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onQuickRenew(lic.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
                        title="Renew License"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectLicense(lic.id)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] transition inline-flex items-center gap-1"
                      >
                        <span>Details</span>
                        <ChevronRight className="w-3 h-3 text-slate-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

