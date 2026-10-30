'use strict';
'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  Laptop,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Ban,
  RotateCcw,
  History,
  Trash2,
  Share2,
} from 'lucide-react';
import { LicenseDetailRecord } from '@/lib/licensing/types';

interface LicenseDetailModalProps {
  licenseId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRefreshList: () => void;
  onOpenCustomerDelivery: (lic: LicenseDetailRecord) => void;
}

export const LicenseDetailModal: React.FC<LicenseDetailModalProps> = ({
  licenseId,
  isOpen,
  onClose,
  onRefreshList,
  onOpenCustomerDelivery,
}) => {
  const [license, setLicense] = useState<LicenseDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const fetchDetails = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/license/admin/licenses/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load license details.');
      }
      setLicense(data.license);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching license.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && licenseId) {
      fetchDetails(licenseId);
      setShowKey(false);
    } else {
      setLicense(null);
    }
  }, [isOpen, licenseId]);

  if (!isOpen) return null;

  const handleCopyKey = () => {
    if (!license) return;
    navigator.clipboard.writeText(license.licenseKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleDeactivateDevice = async (activationId: string) => {
    if (!confirm('Are you sure you want to deactivate this device? This will free the device slot.')) {
      return;
    }
    setActionBusy(true);
    try {
      const res = await fetch(`/api/license/admin/activations/${encodeURIComponent(activationId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to deactivate device.');
      }
      if (licenseId) await fetchDetails(licenseId);
      onRefreshList();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error deactivating device.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRenew = async () => {
    if (!license) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/license/admin/licenses/${encodeURIComponent(license.id)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to renew license.');
      }
      await fetchDetails(license.id);
      onRefreshList();
      alert(`License renewed successfully! New expiry: ${data.expiresAt || 'Lifetime'}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error renewing license.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSetStatus = async (status: 'active' | 'suspended' | 'revoked') => {
    if (!license) return;
    const confirmMsg =
      status === 'revoked'
        ? 'Are you sure you want to REVOKE this license? Terminals will lose access after verification.'
        : status === 'suspended'
        ? 'Suspend this license? Terminals will temporarily pause access.'
        : 'Reactivate this license?';

    if (!confirm(confirmMsg)) return;

    setActionBusy(true);
    try {
      const res = await fetch(`/api/license/admin/licenses/${encodeURIComponent(license.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_status', status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to update status.');
      }
      await fetchDetails(license.id);
      onRefreshList();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating status.');
    } finally {
      setActionBusy(false);
    }
  };

  const formattedExpiry = license?.expiresAt
    ? new Date(license.expiresAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Never (Lifetime)';

  const formattedIssued = license?.issuedAt
    ? new Date(license.issuedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950 px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white">
                  {license?.customerName || 'License Details'}
                </h2>
                {license && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      license.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : license.status === 'suspended'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : license.status === 'revoked'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {license.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">License ID: {license?.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Loading license details...</div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          ) : license ? (
            <>
              {/* Key & Overview Bar */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    License Key
                  </span>
                  <div className="flex items-center gap-2 font-mono text-base font-bold text-white">
                    <span>
                      {showKey
                        ? license.licenseKey
                        : license.licenseKey.substring(0, 9) + '••••-••••-••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="p-1 text-slate-400 hover:text-white transition"
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="p-1 text-slate-400 hover:text-emerald-400 transition"
                      title="Copy Key"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Primary Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onOpenCustomerDelivery(license)}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition flex items-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Customer Message</span>
                  </button>

                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={handleRenew}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-lg transition flex items-center gap-1.5 border border-slate-700"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Renew Plan</span>
                  </button>

                  {license.status === 'suspended' ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleSetStatus('active')}
                      className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold text-xs rounded-lg transition"
                    >
                      Reactivate
                    </button>
                  ) : license.status === 'active' ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleSetStatus('suspended')}
                      className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold text-xs rounded-lg transition"
                    >
                      Suspend
                    </button>
                  ) : null}

                  {license.status !== 'revoked' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleSetStatus('revoked')}
                      className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold text-xs rounded-lg transition"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Plan</span>
                  <span className="text-sm font-bold text-white capitalize">{license.plan}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Terminals</span>
                  <span className="text-sm font-bold text-white">
                    {license.activeDevices} / {license.maxDevices} active
                  </span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Issued</span>
                  <span className="text-sm font-bold text-white">{formattedIssued}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Expires</span>
                  <span className="text-sm font-bold text-emerald-400">{formattedExpiry}</span>
                </div>
              </div>

              {/* Activated Devices Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-slate-400" />
                    Paired POS Hardware Terminals ({license.activations.length})
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {license.maxDevices - license.activeDevices} slots available
                  </span>
                </div>

                {license.activations.length === 0 ? (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-center text-xs text-slate-500">
                    No hardware devices have activated with this license key yet.
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-850">
                    {license.activations.map((a) => (
                      <div
                        key={a.id}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{a.deviceName || 'POS Register'}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                a.status === 'active'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-slate-800 text-slate-400 line-through'
                              }`}
                            >
                              {a.status}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                            Device ID: {a.deviceId}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Activated: {new Date(a.activatedAt).toLocaleString()} • Last Heartbeat:{' '}
                            {new Date(a.lastSeenAt).toLocaleString()}
                          </div>
                        </div>

                        {a.status === 'active' && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleDeactivateDevice(a.id)}
                            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-bold transition flex items-center gap-1 self-start sm:self-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Deactivate Device</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Audit Log Trail */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 mb-3">
                  <History className="w-4 h-4 text-slate-400" />
                  Administrative Audit History ({license.auditLogs.length})
                </h3>

                {license.auditLogs.length === 0 ? (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-xs text-slate-500">
                    No administrative audit records logged yet.
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-850 max-h-48 overflow-y-auto">
                    {license.auditLogs.map((log) => (
                      <div key={log.id} className="p-3 text-xs flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200 capitalize">
                              {log.action.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">by {log.actor}</span>
                          </div>
                          {log.details && (
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5 break-all">
                              {log.details}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 px-6 py-4 border-t border-slate-800 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

