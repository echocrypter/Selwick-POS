'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Download, Pencil, Trash2, TrendingUp, Wallet, ReceiptText, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Sale, StoreSettings } from '@/types/pos';

export interface BusinessExpense {
  id: string;
  date: string; // local YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  createdAt: string;
}

export const isBusinessExpense = (item: unknown): item is BusinessExpense => {
  if (!item || typeof item !== 'object') return false;
  const e = item as Partial<BusinessExpense>;
  return typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') &&
    typeof e.category === 'string' && typeof e.description === 'string' &&
    typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount >= 0;
};

const categories = ['Rent', 'Electricity', 'Salaries', 'Internet', 'Transport', 'Maintenance', 'Marketing', 'Utilities', 'Other'];
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const money = (value: number, symbol: string) => `${symbol} ${value.toLocaleString('en-PK', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const card = 'rounded-2xl border border-[#E8E3F3] bg-white p-5 shadow-sm';
const field = 'w-full rounded-xl border border-[#DCD6ED] bg-white px-3 py-2.5 text-sm text-[#211D35] outline-none focus:border-[#7357E8] focus:ring-2 focus:ring-[#7357E8]/15';

interface Props {
  sales: Sale[];
  expenses: BusinessExpense[];
  settings: StoreSettings;
  onAdd: (expense: BusinessExpense) => void;
  onUpdate: (expense: BusinessExpense) => void;
  onDelete: (id: string) => void;
}

export function ExpensesReportsView({ sales, expenses, settings, onAdd, onUpdate, onDelete }: Props) {
  const now = new Date();
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(localDate(now));
  const [category, setCategory] = useState('Rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const currency = settings.currencySymbol || 'Rs';
  const inPeriod = (dateStr: string) => dateStr.startsWith(String(year) + '-') &&
    (period === 'yearly' || dateStr.slice(5, 7) === String(month).padStart(2, '0'));
  const report = useMemo(() => {
    const selectedSales = sales.filter(s => s.status === 'completed' && Number.isFinite(Date.parse(s.timestamp)) && inPeriod(localDate(new Date(s.timestamp))));
    const selectedExpenses = expenses.filter(e => inPeriod(e.date));
    const revenue = selectedSales.reduce((sum, s) => sum + (Number.isFinite(s.total) ? s.total : 0), 0);
    let missingCosts = 0;
    const cogs = selectedSales.reduce((sum, s) => sum + s.items.reduce((cost, item) => {
      const price = item.product?.costPrice;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) missingCosts++;
      return cost + (typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : 0) * item.quantity;
    }, 0), 0);
    const expenseTotal = selectedExpenses.reduce((sum, e) => sum + e.amount, 0);
    return { selectedSales, selectedExpenses, revenue, cogs, expenseTotal, gross: revenue - cogs, net: revenue - cogs - expenseTotal, missingCosts };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, expenses, year, month, period]);

  function clearForm() {
    setEditingId(null); setDate(localDate(new Date())); setCategory('Rent'); setDescription(''); setAmount(''); setError(''); setShowForm(false);
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00')) || !description.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid date, description and an amount greater than zero.'); return;
    }
    const old = expenses.find(e => e.id === editingId);
    const item: BusinessExpense = { id: old?.id ?? crypto.randomUUID(), createdAt: old?.createdAt ?? new Date().toISOString(), date, category, description: description.trim(), amount: numericAmount };
    if (old) onUpdate(item); else onAdd(item);
    clearForm();
  }
  function edit(item: BusinessExpense) {
    setEditingId(item.id); setDate(item.date); setCategory(item.category); setDescription(item.description); setAmount(String(item.amount)); setError(''); setShowForm(true);
  }
  function exportXlsx() {
    const wb = XLSX.utils.book_new();
    const summary = [
      ['Selwick POS — Financial Report'], ['Period', period === 'monthly' ? `${year}-${String(month).padStart(2, '0')}` : String(year)],
      ['Total Sales', report.revenue], ['Cost of Goods Sold', report.cogs], ['Gross Profit', report.gross],
      ['Business Expenses', report.expenseTotal], ['Net Profit (estimated)', report.net],
      ['Sales Count', report.selectedSales.length], ['Expense Count', report.selectedExpenses.length],
      ['Line Items Missing/Zero Cost', report.missingCosts],
      ['Note', 'Profit uses recorded sale-time product costs; excludes refunded/cancelled sales. Not a tax or cash-flow statement.'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
    const expenseRows = report.selectedExpenses.map(e => ({ Date: e.date, Category: e.category, Description: e.description, Amount: e.amount }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows.length ? expenseRows : [{ Date: '', Category: '', Description: '', Amount: 0 }]), 'Expenses');
    const saleRows = report.selectedSales.map(s => ({ Date: localDate(new Date(s.timestamp)), Invoice: s.invoiceNumber, Revenue: s.total, Cost: s.items.reduce((n, item) => n + (Number.isFinite(item.product?.costPrice) ? item.product.costPrice : 0) * item.quantity, 0), Status: s.status }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(saleRows.length ? saleRows : [{ Date: '', Invoice: '', Revenue: 0, Cost: 0, Status: '' }]), 'Sales');
    XLSX.writeFile(wb, `selwick-financial-${year}${period === 'monthly' ? '-' + String(month).padStart(2, '0') : ''}.xlsx`);
  }
  return <div className="min-h-full space-y-5 bg-[#F8F7FC] p-4 text-[#211D35] sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-[#7357E8]">Finance / Overview</p><h1 className="mt-1 text-2xl font-bold">Expenses & Reports</h1><p className="mt-1 text-sm text-[#625B78]">Track business expenses and estimate your net profit.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={exportXlsx} className="inline-flex items-center gap-2 rounded-xl border border-[#DCD6ED] bg-white px-4 py-2.5 text-sm font-semibold text-[#342A56] hover:bg-[#F0ECFF]"><Download size={16}/> Export XLSX</button><button type="button" onClick={() => { clearForm(); setShowForm(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#7357E8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6045D2]"><Plus size={16}/> Add Expense</button></div>
    </div>
    <div className={`${card} flex flex-wrap items-center gap-3`}>
      <label className="text-sm font-semibold" htmlFor="report-period">Report period</label>
      <select id="report-period" className={`${field} max-w-36`} value={period} onChange={e => setPeriod(e.target.value as 'monthly' | 'yearly')}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>
      {period === 'monthly' && <select aria-label="Month" className={`${field} max-w-40`} value={month} onChange={e => setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2024,i,1).toLocaleString('en-US',{month:'long'})}</option>)}</select>}
      <input aria-label="Year" className={`${field} max-w-28`} type="number" min="2000" max="2100" value={year} onChange={e => setYear(Number(e.target.value))}/>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {label:'Total Sales',value:report.revenue,icon:TrendingUp},
        {label:'Gross Profit',value:report.gross,icon:Wallet},
        {label:'Total Expenses',value:report.expenseTotal,icon:ReceiptText},
        {label:'Net Profit',value:report.net,icon:TrendingUp},
      ].map(({label,value,icon:Icon})=><div key={label} className={card}><div className="flex items-center justify-between text-sm font-medium text-[#625B78]">{label}<Icon size={18} className="text-[#7357E8]"/></div><div className={`mt-3 break-words text-2xl font-bold ${label === 'Net Profit' && value < 0 ? 'text-[#B42318]' : 'text-[#211D35]'}`}>{money(value,currency)}</div></div>)}
    </div>
    {report.missingCosts > 0 && <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={17}/>{report.missingCosts} sold line item(s) have missing or zero recorded cost. Gross/net profit may be overstated until cost data is corrected.</div>}
    <p className="text-xs text-[#625B78]">Net Profit = Total Sales − recorded cost of goods sold − entered expenses. Completed sales only; estimates are not cash-flow or tax reports. Costs use the product snapshot stored with each sale.</p>
    {showForm && <form onSubmit={save} className={`${card} space-y-4`} autoComplete="off"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{editingId ? 'Edit Expense' : 'New Expense'}</h2><button type="button" onClick={clearForm} className="text-sm font-semibold text-[#7357E8]">Cancel</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-semibold">Date<input required type="date" value={date} onChange={e=>setDate(e.target.value)} className={field}/></label><label className="space-y-1 text-sm font-semibold">Category<select value={category} onChange={e=>setCategory(e.target.value)} className={field}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label className="space-y-1 text-sm font-semibold">Description<input required autoComplete="off" maxLength={180} value={description} onChange={e=>setDescription(e.target.value)} placeholder="e.g. October shop rent" className={field}/></label><label className="space-y-1 text-sm font-semibold">Amount ({currency})<input required min="0.01" step="0.01" type="number" value={amount} onChange={e=>setAmount(e.target.value)} className={field}/></label></div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button type="submit" className="rounded-xl bg-[#7357E8] px-5 py-2.5 text-sm font-bold text-white">{editingId ? 'Save Changes' : 'Save Expense'}</button></form>}
    <div className={card}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Expense Records</h2><span className="text-sm text-[#625B78]">{report.selectedExpenses.length} records · {report.selectedSales.length} completed sales</span></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-[#E8E3F3] bg-[#F8F7FC] text-[#625B78]"><tr>{['Date','Category','Description','Amount','Actions'].map(h=><th className="px-3 py-3 font-semibold" key={h}>{h}</th>)}</tr></thead><tbody>{[...report.selectedExpenses].sort((a,b)=>b.date.localeCompare(a.date)).map(e=><tr key={e.id} className="border-b border-[#F0ECF7]"><td className="px-3 py-3">{e.date}</td><td className="px-3 py-3">{e.category}</td><td className="px-3 py-3">{e.description}</td><td className="px-3 py-3 font-semibold">{money(e.amount,currency)}</td><td className="px-3 py-3"><div className="flex gap-2"><button type="button" onClick={()=>edit(e)} aria-label={`Edit ${e.description}`} className="rounded-lg p-2 text-[#7357E8] hover:bg-[#F0ECFF]"><Pencil size={16}/></button><button type="button" onClick={()=>{if(window.confirm(`Delete expense: ${e.description}?`)) onDelete(e.id);}} aria-label={`Delete ${e.description}`} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{report.selectedExpenses.length===0 && <p className="py-10 text-center text-sm text-[#625B78]">No expenses recorded for this period.</p>}</div></div>
  </div>;
}
