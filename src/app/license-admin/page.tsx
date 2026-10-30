'use strict';
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  Search,
  Filter,
  LogOut,
  Key,
} from 'lucide-react';
import { LicenseRecord, LicenseDashboardMetrics } from '@/lib/licensing/types';
import { AdminLoginView } from '@/components/licensing/AdminLoginView';
import { OverviewCards } from '@/components/licensing/OverviewCards';
import { LicenseTable } from '@/components/licensing/LicenseTable';
import { CreateLicenseModal } from '@/components/licensing/CreateLicenseModal';
import { CustomerDeliveryModal } from '@/components/licensing/CustomerDeliveryModal';
import { LicenseDetailModal } from '@/components/licensing/LicenseDetailModal';

export default function LicenseAdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [licenses, setLicenses] = useState<Array<LicenseRecord & { activeDevices: number }>>([]);
  const [metrics, setMetrics] = useState<LicenseDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryLicense, setDeliveryLicense] = useState<LicenseRecord | null>(null);
  const [detailLicenseId, setDetailLicenseId] = useState<string | null>(null);

  // Check auth session on mount
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/license/admin/auth/session');
      const data = await res.json();
      setIsAuthenticated(Boolean(data?.authenticated));
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Fetch licenses and overview metrics
  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (planFilter !== 'all') params.set('plan', planFilter);
      if (sortBy) params.set('sortBy', sortBy);

      const [licRes, metRes] = await Promise.all([
        fetch(`/api/license/admin/licenses?${params.toString()}`),
        fetch('/api/license/admin/overview'),
      ]);

      if (licRes.status === 401 || metRes.status === 401) {
        setIsAuthenticated(false);
        return;
      }

      const licData = await licRes.json();
      const metData = await metRes.json();

      if (licData.ok) setLicenses(licData.licenses || []);
      if (metData.ok) setMetrics(metData.metrics || null);
    } catch (err) {
      console.error('Failed to load license dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, searchTerm, statusFilter, planFilter, sortBy]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, fetchData]);

  const handleLogout = async () => {
    try {
      await fetch('/api/license/admin/auth/logout', { method: 'POST' });
    } catch {}
    setIsAuthenticated(false);
  };

  const handleQuickRenew = async (id: string) => {
    try {
      const res = await fetch(`/api/license/admin/licenses/${encodeURIComponent(id)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.ok) {
        fetchData();
        alert(`License renewed successfully! New expiry: ${data.expiresAt || 'Lifetime'}`);
      } else {
        alert(data.error || 'Failed to renew license.');
      }
    } catch (err) {
      alert('Network error while renewing license.');
    }
  };

  // If checking session
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 font-mono text-xs">
        Verifying administrator session...
      </div>
    );
  }

  // If not authenticated, render login view
  if (!isAuthenticated) {
    return (
      <AdminLoginView
        onLoginSuccess={() => {
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-white text-base tracking-tight">Selwick POS</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                  License Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Commercial Key Issuance & Device Control</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>Issue License</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            <button
              type="button"
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Metric Cards */}
        <OverviewCards metrics={metrics} loading={loading} />

        {/* Toolbar & Filters */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 mb-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search customer, email, or license key..."
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>

            {/* Plan Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-500">Plan:</span>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="all">All Plans</option>
                <option value="trial">Trial</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="lifetime">Lifetime</option>
              </select>
            </div>

            {/* Sort Order */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-500">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="created_at">Newest First</option>
                <option value="expires_at">Expiration Date</option>
                <option value="customer_name">Customer Name</option>
              </select>
            </div>
          </div>
        </div>

        {/* License Table */}
        <LicenseTable
          licenses={licenses}
          loading={loading}
          onSelectLicense={(id) => setDetailLicenseId(id)}
          onOpenCustomerDelivery={(lic) => {
            setDeliveryLicense(lic);
            setDeliveryModalOpen(true);
          }}
          onQuickRenew={handleQuickRenew}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 py-4 text-center text-xs text-slate-500 font-mono">
        Selwick Systems Commercial Licensing Subsystem • Zero-Trust Public/Private Ed25519 Signing
      </footer>

      {/* Modals */}
      <CreateLicenseModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newLic) => {
          fetchData();
          setDeliveryLicense(newLic);
          setDeliveryModalOpen(true);
        }}
      />

      <CustomerDeliveryModal
        isOpen={deliveryModalOpen}
        license={deliveryLicense}
        onClose={() => {
          setDeliveryModalOpen(false);
          setDeliveryLicense(null);
        }}
      />

      <LicenseDetailModal
        licenseId={detailLicenseId}
        isOpen={Boolean(detailLicenseId)}
        onClose={() => setDetailLicenseId(null)}
        onRefreshList={fetchData}
        onOpenCustomerDelivery={(lic) => {
          setDeliveryLicense(lic);
          setDeliveryModalOpen(true);
        }}
      />
    </div>
  );
}

