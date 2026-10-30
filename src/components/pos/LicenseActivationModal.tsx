'use client';

import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, CheckCircle2, AlertTriangle, XCircle, RefreshCw, X, Laptop } from 'lucide-react';
import { type PosLicenseState } from '@/lib/licensing/types';

interface LicenseActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LicenseActivationModal({ isOpen, onClose }: LicenseActivationModalProps) {
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [licenseState, setLicenseState] = useState<PosLicenseState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/pos/license/status');
      const data = await res.json();
      if (data.ok && data.state) {
        setLicenseState(data.state);
      }
    } catch {
      // Offline fallback
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;

    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/pos/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: keyInput.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setLicenseState(data.state);
        setMessage('License activated successfully! Full commercial features unlocked.');
        setKeyInput('');
      } else {
        setError(data.error || 'Activation failed. Please check the key.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reach activation service.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            <CheckCircle2 size={14} /> Activated
          </span>
        );
      case 'grace_period':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            <AlertTriangle size={14} /> Offline Grace Period
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            <XCircle size={14} /> Expired
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
            <ShieldCheck size={14} /> Unlicensed
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <KeyRound size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Commercial License</h3>
              <p className="text-xs text-slate-500">Selwick POS Terminal Activation</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Current Status Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">License Status</span>
              {getStatusBadge(licenseState?.status)}
            </div>

            {licenseState?.isValid && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 text-xs">
                <div>
                  <span className="text-slate-500">Customer:</span>
                  <p className="font-semibold text-slate-800 truncate">{licenseState.customerName || 'Standard'}</p>
                </div>
                <div>
                  <span className="text-slate-500">Plan:</span>
                  <p className="font-semibold text-slate-800 capitalize">{licenseState.plan || 'Commercial'}</p>
                </div>
                <div>
                  <span className="text-slate-500">Valid Until:</span>
                  <p className="font-semibold text-slate-800">
                    {licenseState.expiresAt ? new Date(licenseState.expiresAt).toLocaleDateString() : 'Lifetime (Permanent)'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Device ID:</span>
                  <p className="font-mono text-[11px] text-slate-600 truncate">{licenseState.deviceId}</p>
                </div>
              </div>
            )}

            {licenseState?.isGracePeriod && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>Offline grace period: {licenseState.graceDaysRemaining} day(s) remaining. POS operates normally.</span>
              </div>
            )}
          </div>

          {/* Key Input Form */}
          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <label htmlFor="licenseKeyInput" className="block text-xs font-semibold text-slate-700 mb-1.5">
                License Key
              </label>
              <div className="relative">
                <input
                  id="licenseKeyInput"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="SELW-PRO-XXXX-XXXX-XXXX-XXXX"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm uppercase tracking-wider text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
                <XCircle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {message && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !keyInput.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 px-4 font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-hidden disabled:opacity-50 transition cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Verifying License...
                </>
              ) : (
                'Activate Terminal'
              )}
            </button>
          </form>

          <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="flex items-center gap-1">
              <Laptop size={13} /> Offline-First Verified Ed25519
            </span>
            <span>Selwick Softwares</span>
          </div>
        </div>
      </div>
    </div>
  );
}

