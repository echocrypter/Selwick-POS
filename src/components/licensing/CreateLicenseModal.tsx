'use strict';
'use client';

import React, { useState } from 'react';
import { X, Key, ShieldCheck, Check, Sparkles, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { LicensePlan, FeatureFlag, LicenseRecord } from '@/lib/licensing/types';
import { getDefaultFeaturesForPlan } from '@/lib/licensing/licenseService';

interface CreateLicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (license: LicenseRecord) => void;
}

export const CreateLicenseModal: React.FC<CreateLicenseModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<LicensePlan>('yearly');
  const [maxDevices, setMaxDevices] = useState(2);
  const [selectedFeatures, setSelectedFeatures] = useState<FeatureFlag[]>(
    getDefaultFeaturesForPlan('yearly')
  );

  // Optional Payment / Notes Fields
  const [showPaymentFields, setShowPaymentFields] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentProvider, setPaymentProvider] = useState('Cash');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid' | 'waived'>('paid');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePlanChange = (newPlan: LicensePlan) => {
    setPlan(newPlan);
    setSelectedFeatures(getDefaultFeaturesForPlan(newPlan));
    if (newPlan === 'trial') setMaxDevices(1);
    else if (newPlan === 'monthly') setMaxDevices(2);
    else if (newPlan === 'yearly') setMaxDevices(3);
    else if (newPlan === 'lifetime') setMaxDevices(5);
  };

  const toggleFeature = (feat: FeatureFlag) => {
    if (selectedFeatures.includes(feat)) {
      setSelectedFeatures(selectedFeatures.filter((f) => f !== feat));
    } else {
      setSelectedFeatures([...selectedFeatures, feat]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !email.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/license/admin/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          email: email.trim(),
          plan,
          maxDevices: Number(maxDevices) || 1,
          features: selectedFeatures,
          paymentReference: paymentReference.trim() || undefined,
          paymentProvider: paymentProvider.trim() || undefined,
          paymentStatus: paymentStatus || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to generate license.');
      }

      onCreated(data.license);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating license.');
    } finally {
      setLoading(false);
    }
  };

  const allFeatures: { id: FeatureFlag; label: string; desc: string }[] = [
    { id: 'inventory', label: 'Inventory & Products', desc: 'Stock control & alerts' },
    { id: 'khata', label: 'Khata Ledger', desc: 'Customer debt & settlements' },
    { id: 'advanced_reports', label: 'Financial Analytics', desc: 'Detailed reporting & export' },
    { id: 'multi_user', label: 'Staff Roles & PINs', desc: 'Cashier & manager permissions' },
    { id: 'cloud_backup', label: 'Encrypted Cloud Backup', desc: 'Disaster recovery sync' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950 px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Generate Commercial License</h2>
              <p className="text-xs text-slate-400">Issue a cryptographically signed license for a merchant</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Customer Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Customer / Business Name *
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Al-Madina Superstore"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Contact Email / Phone *
              </label>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. owner@almadina.com"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Section 2: Commercial Plan */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Select Commercial Plan Tier *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { id: 'trial', label: 'Trial', duration: '14 Days', desc: 'Prospect evaluation' },
                { id: 'monthly', label: 'Monthly', duration: '30 Days', desc: 'Recurring subscription' },
                { id: 'yearly', label: 'Yearly', duration: '365 Days', desc: 'Annual prepaid tier' },
                { id: 'lifetime', label: 'Lifetime', duration: 'No Expiry', desc: 'Perpetual commercial' },
              ].map((p) => {
                const selected = plan === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePlanChange(p.id as LicensePlan)}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      selected
                        ? 'border-emerald-500 bg-emerald-500/10 text-white shadow-sm'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs uppercase">{p.label}</span>
                        {selected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono mt-0.5 block">
                        {p.duration}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-2 block">{p.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Device Limit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Maximum Device Quota (Terminals)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={maxDevices}
                onChange={(e) => setMaxDevices(parseInt(e.target.value) || 1)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Number of physical POS computers allowed to activate simultaneously.
              </p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-400">
              <span className="font-bold text-slate-300 block mb-0.5">Calculated Entitlement:</span>
              <span>
                {plan === 'lifetime'
                  ? 'Perpetual lifetime validity (expiry is null)'
                  : plan === 'yearly'
                  ? 'Valid for 365 days from activation'
                  : plan === 'monthly'
                  ? 'Valid for 30 days from activation'
                  : 'Valid for 14 days evaluation'}
              </span>
            </div>
          </div>

          {/* Section 4: Feature Flags */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Enabled Feature Flags
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allFeatures.map((f) => {
                const checked = selectedFeatures.includes(f.id);
                return (
                  <label
                    key={f.id}
                    onClick={() => toggleFeature(f.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition ${
                      checked
                        ? 'bg-slate-800/80 border-emerald-500/40 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-xs font-bold">{f.label}</div>
                      <div className="text-[11px] text-slate-500">{f.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section 5: Payment Metadata Preparation (Collapsible) */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
            <button
              type="button"
              onClick={() => setShowPaymentFields(!showPaymentFields)}
              className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-bold text-slate-400 hover:text-white transition"
            >
              <span>Payment & Audit Information (Optional)</span>
              {showPaymentFields ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showPaymentFields && (
              <div className="p-4 border-t border-slate-800/80 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-400 mb-1">Payment Reference</label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="e.g. INV-9801"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-400 mb-1">Provider / Method</label>
                    <input
                      type="text"
                      value={paymentProvider}
                      onChange={(e) => setPaymentProvider(e.target.value)}
                      placeholder="Cash, JazzCash, Stripe..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-400 mb-1">Payment Status</label>
                    <select
                      value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white"
                    >
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid / Invoiced</option>
                      <option value="waived">Waived / Complimentary</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-400 mb-1">Administrative Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal reference notes, referral source, etc."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-950/50"
            >
              {loading ? (
                <span>Generating Cryptographic Key...</span>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Create Commercial License</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

