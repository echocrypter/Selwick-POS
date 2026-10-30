'use strict';
'use client';

import React, { useState } from 'react';
import { Copy, Check, X, ShieldCheck, Download, Share2, Sparkles } from 'lucide-react';
import { LicenseRecord } from '@/lib/licensing/types';
import { generateCustomerMessage } from '@/lib/licensing/licenseService';

interface CustomerDeliveryModalProps {
  license: LicenseRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerDeliveryModal: React.FC<CustomerDeliveryModalProps> = ({
  license,
  isOpen,
  onClose,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  if (!isOpen || !license) return null;

  const formattedExpiry = license.expiresAt
    ? new Date(license.expiresAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Never (Lifetime)';

  const customerMessage = generateCustomerMessage(license);

  const handleCopyKey = () => {
    navigator.clipboard.writeText(license.licenseKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(customerMessage);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 border-b border-emerald-500/20 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Commercial License Delivery</h2>
              <p className="text-xs text-slate-400">Share these activation credentials with the merchant</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Summary Grid */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-slate-500 font-bold uppercase tracking-wider block text-[10px]">Merchant</span>
              <span className="font-bold text-white text-sm">{license.customerName}</span>
              <span className="text-slate-400 block text-[11px] truncate">{license.email}</span>
            </div>
            <div>
              <span className="text-slate-500 font-bold uppercase tracking-wider block text-[10px]">Tier & Quota</span>
              <span className="font-bold text-emerald-400 uppercase text-sm">
                {license.plan} • {license.maxDevices} {license.maxDevices === 1 ? 'Terminal' : 'Terminals'}
              </span>
              <span className="text-slate-400 block text-[11px]">Valid Until: {formattedExpiry}</span>
            </div>
          </div>

          {/* License Key Callout */}
          <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 text-center">
            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest block mb-1">
              Active Commercial License Key
            </span>
            <div className="font-mono text-xl sm:text-2xl font-black text-white tracking-widest selection:bg-emerald-500 selection:text-black py-1">
              {license.licenseKey}
            </div>
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={handleCopyKey}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition shadow-md"
              >
                {copiedKey ? <Check className="w-4 h-4 text-emerald-200" /> : <Copy className="w-4 h-4" />}
                {copiedKey ? 'License Key Copied!' : 'Copy License Key'}
              </button>
            </div>
          </div>

          {/* Formatted Customer Message Box */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5 text-slate-400" />
                Customer Onboarding Message
              </span>
              <button
                type="button"
                onClick={handleCopyMessage}
                className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                {copiedMsg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMsg ? 'Message Copied!' : 'Copy Formatted Message'}
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto selection:bg-slate-800">
              {customerMessage}
            </pre>
            <p className="text-[11px] text-slate-500 mt-2">
              Send this copyable text via WhatsApp, Email, or SMS directly to the customer.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-950/80 border-t border-slate-800 px-6 py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

