'use client';

import { paymentLabel } from '@/utils/paymentMethods';


import React, { useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  Package,
  Users,
  ShoppingCart,
  FileText,
  AlertTriangle,
  ArrowRight,
  CreditCard,
  Banknote,
  Wallet,
  Receipt,
  Store,
  Clock,
  Layers,
} from 'lucide-react';
import { Product, Sale, Customer, StoreSettings } from '@/types/pos';
import { ActiveTab } from '@/components/pos/Header';

interface DashboardViewProps {
  products: Product[];
  sales: Sale[];
  customers: Customer[];
  settings: StoreSettings;
  onNavigate: (tab: ActiveTab) => void;
  onViewReceipt: (sale: Sale) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  products,
  sales,
  customers,
  settings,
  onNavigate,
  onViewReceipt,
}) => {
  // Completed sales
  const completedSales = useMemo(
    () => sales.filter((s) => s.status === 'completed'),
    [sales]
  );

  // Total sales revenue
  const totalRevenue = useMemo(
    () => completedSales.reduce((sum, s) => sum + s.total, 0),
    [completedSales]
  );

  // Today's date string
  const todayStr = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  // Today's sales
  const todaySales = useMemo(() => {
    return completedSales.filter((s) => {
      if (!s.dateStr) return false;
      return s.dateStr.toLowerCase().includes(todayStr.toLowerCase()) ||
        new Date(s.timestamp).toDateString() === new Date().toDateString();
    });
  }, [completedSales, todayStr]);

  const todayRevenue = useMemo(
    () => todaySales.reduce((sum, s) => sum + s.total, 0),
    [todaySales]
  );

  // Profit / Margin calculation
  const totalCost = useMemo(() => {
    return completedSales.reduce((sum, s) => {
      const saleCost = s.items.reduce(
        (costSum, item) => costSum + item.product.costPrice * item.quantity,
        0
      );
      return sum + saleCost;
    }, 0);
  }, [completedSales]);

  const estimatedProfit = Math.max(0, totalRevenue - totalCost);

  // Inventory stats
  const totalStockUnits = useMemo(
    () => products.reduce((sum, p) => sum + p.stock, 0),
    [products]
  );

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.stock <= p.minStockAlert).slice(0, 6),
    [products]
  );

  // Customer Khata balances
  const totalKhataBalance = useMemo(
    () => customers.reduce((sum, c) => sum + (c.balance || 0), 0),
    [customers]
  );

  // Payment Breakdown
  const paymentStats = useMemo(() => {
    const cash = completedSales
      .filter((s) => s.paymentMethod === 'cash')
      .reduce((sum, s) => sum + s.total, 0);
    const card = completedSales
      .filter((s) => s.paymentMethod === 'card')
      .reduce((sum, s) => sum + s.total, 0);
    const wallet = completedSales
      .filter((s) => !['cash', 'card'].includes(s.paymentMethod))
      .reduce((sum, s) => sum + s.total, 0);

    const total = cash + card + wallet || 1;
    return {
      cash,
      card,
      wallet,
      cashPct: Math.round((cash / total) * 100),
      cardPct: Math.round((card / total) * 100),
      walletPct: Math.round((wallet / total) * 100),
    };
  }, [completedSales]);

  // Recent 5 sales
  const recentSales = useMemo(() => {
    return [...sales].slice(0, 5);
  }, [sales]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-6 space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-900/40 via-indigo-900/20 to-slate-900/60 p-5 shadow-lg backdrop-blur">
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-blue-300">
                POS Dashboard
              </span>
              <span className="text-xs text-slate-400">Terminal {settings.terminalId}</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white lg:text-2xl">
              {settings.storeName || 'Your Business'} Overview
            </h2>
            <p className="text-xs text-slate-300">
              Welcome back. Here is your live business performance summary and inventory status.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('register')}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-600/30 transition-all hover:bg-blue-500 hover:shadow-blue-500/40"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>Open Register</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-bold text-slate-200 transition-all hover:bg-slate-700 hover:text-white"
            >
              <Package className="h-4 w-4" />
              <span>Catalog</span>
            </button>
          </div>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Net Sales */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Total Revenue</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {settings.currencySymbol} {totalRevenue.toLocaleString()}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>{completedSales.length} total orders</span>
            {todayRevenue > 0 && (
              <span className="text-emerald-400 font-medium">
                +{settings.currencySymbol}{todayRevenue.toLocaleString()} today
              </span>
            )}
          </div>
        </div>

        {/* Estimated Profit */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Gross Profit (Est.)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {settings.currencySymbol} {estimatedProfit.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Cost of goods: {settings.currencySymbol} {totalCost.toLocaleString()}
          </div>
        </div>

        {/* Product Catalog */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Inventory Items</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {products.length} Items
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>{totalStockUnits} units in stock</span>
            {lowStockProducts.length > 0 && (
              <span className="text-amber-400 font-semibold">
                {lowStockProducts.length} low stock
              </span>
            )}
          </div>
        </div>

        {/* Customers / Khata */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Customers</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {customers.length} Accounts
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Khata Receivable: {settings.currencySymbol} {totalKhataBalance.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Two Column Layout: Recent Sales & Low Stock Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Transactions (2 cols on lg) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-400" />
              <h3 className="text-base font-bold text-white">Recent Transactions</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="flex items-center gap-1 text-xs font-semibold text-blue-400 transition-colors hover:text-blue-300"
            >
              <span>View all sales</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentSales.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-10 text-center">
              <FileText className="h-8 w-8 text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-300">No sales recorded yet</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Completed orders will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="pb-3 pl-2">Invoice #</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Method</th>
                    <th className="pb-3 text-right">Total</th>
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3 pr-2 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {recentSales.map((sale) => (
                    <tr key={sale.id} className="transition-colors hover:bg-slate-800/40">
                      <td className="py-3 pl-2 font-mono font-bold text-blue-400">
                        {sale.invoiceNumber}
                      </td>
                      <td className="py-3 text-slate-200">
                        {sale.customerName || 'Walk-in Sale'}
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-300">
                          {sale.paymentMethod === 'cash' && <Banknote className="h-3 w-3 text-emerald-400" />}
                          {sale.paymentMethod === 'card' && <CreditCard className="h-3 w-3 text-blue-400" />}
                          {!['cash', 'card'].includes(sale.paymentMethod) && <Wallet className="h-3 w-3 text-purple-400" />}
                          {paymentLabel(sale.paymentMethod)}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-white">
                        {settings.currencySymbol} {sale.total.toLocaleString()}
                      </td>
                      <td className="py-3 text-center">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            sale.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {sale.status}
                        </span>
                      </td>
                      <td className="py-3 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(sale)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Payment Methods & Inventory Alerts */}
        <div className="space-y-6">
          {/* Payment Method Split */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-white">Payment Method Share</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Banknote className="h-3.5 w-3.5 text-emerald-400" />
                    Cash
                  </span>
                  <span className="font-mono text-slate-400">
                    {settings.currencySymbol} {paymentStats.cash.toLocaleString()} ({paymentStats.cashPct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${paymentStats.cashPct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <CreditCard className="h-3.5 w-3.5 text-blue-400" />
                    Card
                  </span>
                  <span className="font-mono text-slate-400">
                    {settings.currencySymbol} {paymentStats.card.toLocaleString()} ({paymentStats.cardPct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${paymentStats.cardPct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Wallet className="h-3.5 w-3.5 text-purple-400" />
                    Digital Wallet
                  </span>
                  <span className="font-mono text-slate-400">
                    {settings.currencySymbol} {paymentStats.wallet.toLocaleString()} ({paymentStats.walletPct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-500"
                    style={{ width: `${paymentStats.walletPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Low Stock Watch */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Low Stock Watch</h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300"
              >
                Manage
              </button>
            </div>

            {lowStockProducts.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">All catalog inventory levels are healthy.</p>
            ) : (
              <div className="space-y-2">
                {lowStockProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2 text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="truncate font-semibold text-slate-200">{p.name}</p>
                      <p className="text-[10px] font-mono text-slate-500">SKU: {p.sku}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                        p.stock <= 0
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {p.stock <= 0 ? 'Out of stock' : `${p.stock} remaining`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
