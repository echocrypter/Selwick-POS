'use client';

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Printer,
  RotateCcw,
  DollarSign,
  TrendingUp,
  CreditCard,
  Banknote,
  Wallet,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Eye,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Sale, StoreSettings } from '@/types/pos';
import { playSound } from '@/utils/sound';
import { PAYMENT_METHODS, paymentLabel } from '@/utils/paymentMethods';
import { PaymentMethod } from '@/types/pos';

interface SalesHistoryViewProps {
  sales: Sale[];
  settings: StoreSettings;
  onViewReceipt: (sale: Sale) => void;
  onRefundSale: (saleId: string) => void;
}

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  sales,
  settings,
  onViewReceipt,
  onRefundSale,
}) => {
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [anchorDate, setAnchorDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  });
  const [exportError, setExportError] = useState('');

  const range = useMemo(() => {
    const [y, m, d] = anchorDate.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    start.setHours(0, 0, 0, 0);
    if (period === 'weekly') {
      const weekday = (start.getDay() + 6) % 7; // Monday-start week
      start.setDate(start.getDate() - weekday);
    } else if (period === 'monthly') {
      start.setDate(1);
    } else if (period === 'yearly') {
      start.setMonth(0, 1);
    }
    const end = new Date(start);
    if (period === 'daily') end.setDate(end.getDate() + 1);
    if (period === 'weekly') end.setDate(end.getDate() + 7);
    if (period === 'monthly') end.setMonth(end.getMonth() + 1);
    if (period === 'yearly') end.setFullYear(end.getFullYear() + 1);
    const fmt = (date: Date) => date.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
    return { start, end, label: `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}` };
  }, [anchorDate, period]);

  const periodSales = useMemo(() => sales.filter(sale => {
    const time = new Date(sale.timestamp).getTime();
    return Number.isFinite(time) && time >= range.start.getTime() && time < range.end.getTime();
  }), [sales, range]);

  const shiftPeriod = (direction: number) => {
    const [y,m,d] = anchorDate.split('-').map(Number);
    const date = new Date(y,m-1,d);
    if (period === 'daily') date.setDate(date.getDate()+direction);
    if (period === 'weekly') date.setDate(date.getDate()+direction*7);
    if (period === 'monthly') date.setMonth(date.getMonth()+direction);
    if (period === 'yearly') date.setFullYear(date.getFullYear()+direction);
    setAnchorDate(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
  };

  const exportSales = async () => {
    setExportError('');
    try {
      const XLSX = await import('xlsx');
      const rows = filteredSales.flatMap(sale => sale.items.length
        ? sale.items.map(item => ({
            Invoice: sale.invoiceNumber,
            'Date / Time': new Date(sale.timestamp).toLocaleString(),
            Customer: sale.customerName,
            Phone: sale.customerPhone ?? '',
            Product: item.product.name,
            SKU: item.product.sku,
            Quantity: item.quantity,
            'Unit Price': item.customPrice ?? item.product.price,
            'Item Discount': item.discount,
            'Invoice Discount': sale.discount,
            Tax: sale.tax,
            'Invoice Total': sale.total,
            Payment: paymentLabel(sale.paymentMethod),
            Status: sale.status,
            'Terminal ID': sale.terminalId,
          }))
        : [{Invoice: sale.invoiceNumber, 'Date / Time': new Date(sale.timestamp).toLocaleString(),
            Customer: sale.customerName, 'Invoice Total': sale.total, Payment: paymentLabel(sale.paymentMethod), Status: sale.status}]);
      const summary = [
        {Metric:'Period', Value:range.label},
        {Metric:'Period type', Value:period},
        {Metric:'Orders (completed)', Value:completedSales.length},
        {Metric:'Net sales', Value:totalRevenue},
        {Metric:'Estimated profit', Value:estimatedProfit},
        {Metric:'Cash revenue', Value:cashTotal},
        {Metric:'Card revenue', Value:cardTotal},
        {Metric:'Wallet revenue', Value:walletTotal},
        {Metric:'Exported transactions', Value:filteredSales.length},
        {Metric:'Currency', Value:settings.currencySymbol},
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Summary');
      const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{Message:'No sales for selected filters and period'}]);
      sheet['!cols'] = Array.from({length:15}, (_,i) => ({wch: i === 1 ? 23 : 19}));
      XLSX.utils.book_append_sheet(workbook, sheet, 'Sales Details');
      XLSX.writeFile(workbook, `selwick-sales-${period}-${range.start.getFullYear()}-${String(range.start.getMonth()+1).padStart(2,'0')}-${String(range.start.getDate()).padStart(2,'0')}.xlsx`);
    } catch {
      setExportError('Excel export failed. Please try again.');
    }
  };
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');

  // Day Book Metrics (Completed Sales)
  const completedSales = useMemo(() => periodSales.filter((s) => s.status === 'completed'), [periodSales]);
  const totalRevenue = useMemo(() => completedSales.reduce((sum, s) => sum + s.total, 0), [completedSales]);

  const totalCost = useMemo(() => {
    return completedSales.reduce((sum, s) => {
      const saleCost = s.items.reduce((costSum, item) => costSum + item.product.costPrice * item.quantity, 0);
      return sum + saleCost;
    }, 0);
  }, [completedSales]);

  const estimatedProfit = Math.max(0, totalRevenue - totalCost);

  const cashTotal = useMemo(
    () => completedSales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0),
    [completedSales]
  );
  const cardTotal = useMemo(
    () => completedSales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0),
    [completedSales]
  );
  const walletTotal = useMemo(
    () => completedSales.filter((s) => !['cash', 'card'].includes(s.paymentMethod)).reduce((sum, s) => sum + s.total, 0),
    [completedSales]
  );

  const filteredSales = useMemo(() => {
    return periodSales.filter((s) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q) ||
        (s.customerPhone && s.customerPhone.includes(q));

      const matchesMethod = methodFilter === 'all' || s.paymentMethod === methodFilter;
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;

      return matchesSearch && matchesMethod && matchesStatus;
    });
  }, [periodSales, search, methodFilter, statusFilter]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-6 space-y-5">
      {/* Period navigation and Excel export */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Sales History</h2>
            <p className="text-xs text-slate-600">Browse historical sales and export Excel reports</p>
          </div>
          <button type="button" onClick={exportSales} className="inline-flex items-center gap-2 rounded-xl bg-[#7357E8] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#6045D2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7357E8]">
            <Download className="h-4 w-4" /> Export XLSX
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['daily','weekly','monthly','yearly'] as const).map(option => (
            <button key={option} type="button" onClick={() => setPeriod(option)} aria-pressed={period === option}
              className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize transition-colors ${period === option ? 'bg-[#7357E8] text-white' : 'bg-[#F0ECFF] text-[#342A56] hover:bg-[#E3DAFF]'}`}>
              {option}
            </button>
          ))}
          <div className="flex items-center gap-2 sm:ml-auto">
            <button type="button" onClick={() => shiftPeriod(-1)} aria-label="Previous period" className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100"><ChevronLeft className="h-4 w-4"/></button>
            <input type="date" aria-label="Select date within period" value={anchorDate} onChange={e => e.target.value && setAnchorDate(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"/>
            <button type="button" onClick={() => shiftPeriod(1)} aria-label="Next period" className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100"><ChevronRight className="h-4 w-4"/></button>
          </div>
        </div>
        <p className="text-sm font-medium text-slate-700">{range.label} · {periodSales.length} transactions (including refunds)</p>
        {exportError && <p role="alert" className="text-sm font-medium text-red-700">{exportError}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Total Net Sales</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {settings.currencySymbol} {totalRevenue.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">{completedSales.length} total orders completed</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Est. Gross Margin / Profit</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            {settings.currencySymbol} {estimatedProfit.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Cost base: {settings.currencySymbol} {totalCost.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Cash Revenue</span>
            <Banknote className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {settings.currencySymbol} {cashTotal.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">Physical drawer receipts</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Card & Digital Wallets</span>
            <Wallet className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-cyan-400">
            {settings.currencySymbol} {(cardTotal + walletTotal).toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">Card: {cardTotal} | Wallet: {walletTotal}</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by invoice # or customer..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Payment Method Filter */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as typeof methodFilter)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
            >
              <option value="all" className="bg-slate-900">All Payment Methods</option>
              {PAYMENT_METHODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
            >
              <option value="all" className="bg-slate-900">All Statuses</option>
              <option value="completed" className="bg-slate-900">Completed</option>
              <option value="refunded" className="bg-slate-900">Refunded</option>
            </select>
          </div>
        </div>

        {/* Sales Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Invoice #</th>
                <th className="p-3.5">Date & Time</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Items Summary</th>
                <th className="p-3.5">Payment</th>
                <th className="p-3.5">Total Amount</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => {
                  const itemCount = sale.items.reduce((sum, i) => sum + i.quantity, 0);
                  const isRefunded = sale.status === 'refunded';

                  return (
                    <tr key={sale.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-blue-400">
                        {sale.invoiceNumber}
                      </td>
                      <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                        {sale.dateStr}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-200">{sale.customerName}</div>
                        {sale.customerPhone && (
                          <div className="text-[10px] text-slate-500 font-mono">{sale.customerPhone}</div>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-400 max-w-xs truncate">
                        <span className="font-semibold text-slate-300">{itemCount} items: </span>
                        {sale.items.map((i) => `${i.quantity}x ${i.product.name}`).join(', ')}
                      </td>
                      <td className="p-3.5">
                        <span className="uppercase text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {paymentLabel(sale.paymentMethod)}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono font-bold text-white text-sm">
                        {settings.currencySymbol} {sale.total.toLocaleString()}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isRefunded
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {isRefunded ? 'Refunded' : 'Completed'}
                        </span>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              onViewReceipt(sale);
                              playSound('click', settings.soundEnabled);
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition-colors"
                            title="View / Print Receipt"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!isRefunded && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Are you sure you want to refund Invoice ${sale.invoiceNumber}? Stock will be restored.`
                                  )
                                ) {
                                  onRefundSale(sale.id);
                                  playSound('hold', settings.soundEnabled);
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                              title="Refund Transaction"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
