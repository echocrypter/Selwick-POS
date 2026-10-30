
'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Phone,
  Mail,
  MapPin,
  AlertCircle,
  X,
  Wallet,
  Trash2,
} from 'lucide-react';
import { Customer, StoreSettings } from '@/types/pos';
import { playSound } from '@/utils/sound';

interface CustomersViewProps {
  customers: Customer[];
  settings: StoreSettings;
  onAddCustomer: (
    customer: Omit<
      Customer,
      'id' | 'createdAt' | 'totalOrders' | 'totalSpent' | 'loyaltyPoints'
    >,
  ) => void;
  onSettleKhata: (
    customerId: string,
    amount: number,
    note: string,
  ) => void;
  onDeleteCustomer: (customerId: string) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  settings,
  onAddCustomer,
  onSettleKhata,
  onDeleteCustomer,
}) => {
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] =
    useState<'all' | 'due' | 'credit'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleNote, setSettleNote] = useState<string>('');

  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustBalance, setNewCustBalance] = useState<number>(0);

  const totalReceivables = useMemo(
    () =>
      customers
        .filter((customer) => customer.balance > 0)
        .reduce((sum, customer) => sum + customer.balance, 0),
    [customers],
  );

  const totalCredits = useMemo(
    () =>
      customers
        .filter((customer) => customer.balance < 0)
        .reduce((sum, customer) => sum + Math.abs(customer.balance), 0),
    [customers],
  );

  const customersWithDue = useMemo(
    () => customers.filter((customer) => customer.balance > 0).length,
    [customers],
  );

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const query = search.toLowerCase().trim();

      const matchesSearch =
        !query ||
        customer.name.toLowerCase().includes(query) ||
        customer.phone.toLowerCase().includes(query) ||
        (customer.email ?? '').toLowerCase().includes(query);

      let matchesFilter = true;

      if (balanceFilter === 'due') {
        matchesFilter = customer.balance > 0;
      }

      if (balanceFilter === 'credit') {
        matchesFilter = customer.balance < 0;
      }

      return matchesSearch && matchesFilter;
    });
  }, [customers, search, balanceFilter]);

  const handleAddSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!newCustName.trim()) return;

    onAddCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim() || 'N/A',
      email: newCustEmail.trim() || undefined,
      address: newCustAddress.trim() || undefined,
      balance: newCustBalance || 0,
    });

    setIsAddModalOpen(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustEmail('');
    setNewCustAddress('');
    setNewCustBalance(0);

    playSound('beep', settings.soundEnabled);
  };

  const handleSettleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!settleCustomer || settleAmount <= 0) return;

    if (
      settleCustomer.balance > 0 &&
      settleAmount > settleCustomer.balance
    ) {
      const confirmed = window.confirm(
        'The payment is greater than the outstanding balance. Record this payment anyway?',
      );

      if (!confirmed) return;
    }

    onSettleKhata(settleCustomer.id, settleAmount, settleNote);

    playSound('success', settings.soundEnabled);
    setSettleCustomer(null);
    setSettleAmount(0);
    setSettleNote('');
  };

  const handleDeleteCustomer = (customer: Customer) => {
    const balanceWarning =
      customer.balance !== 0
        ? '\n\nWarning: this customer has a non-zero Khata balance. Make sure you have recorded any outstanding amount before deleting the account.'
        : '';

    const confirmed = window.confirm(
      `Delete customer "${customer.name}"?\n\nThis removes the customer account from the current customer list. Historical sales and receipts will not be deleted.${balanceWarning}\n\nThis action cannot be undone.`,
    );

    if (!confirmed) return;

    onDeleteCustomer(customer.id);

    if (settleCustomer?.id === customer.id) {
      setSettleCustomer(null);
    }

    playSound('click', settings.soundEnabled);
  };

  return (
    <div className="flex-1 space-y-5 overflow-y-auto bg-slate-950 p-4 lg:p-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Registered Accounts</span>
            <Users className="h-4 w-4 text-blue-400" />
          </div>

          <div className="font-mono text-2xl font-bold text-white">
            {customers.length} Accounts
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Registered customers only
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Khata Due Receivables</span>
            <AlertCircle className="h-4 w-4 text-rose-400" />
          </div>

          <div className="font-mono text-2xl font-bold text-rose-400">
            {settings.currencySymbol} {totalReceivables.toLocaleString()}
          </div>

          <div className="mt-1 text-xs text-rose-400/80">
            {customersWithDue} customer
            {customersWithDue !== 1 ? 's' : ''} owe balance
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Store Advance Credits</span>
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>

          <div className="font-mono text-2xl font-bold text-emerald-400">
            {settings.currencySymbol} {totalCredits.toLocaleString()}
          </div>

          <div className="mt-1 text-xs text-emerald-400/80">
            Advance customer deposits
          </div>
        </div>
      </div>

      {/* Customer Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div className="flex flex-col items-center justify-between gap-3 border-b border-slate-800 p-4 md:flex-row">
          <div className="flex w-full flex-1 flex-col gap-2 md:flex-row md:items-center">
            <div className="relative w-full flex-1 md:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                type="text"
                autoComplete="off"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, phone, or email..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  ['all', 'All'],
                  ['due', 'Has Due Balance'],
                  ['credit', 'Advance Credit'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBalanceFilter(value)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                    balanceFilter === value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] md:w-auto"
          >
            <UserPlus className="h-4 w-4" />
            Add Customer
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/80 uppercase tracking-wider text-slate-400">
              <tr>
                <th className="p-3.5">Customer Name</th>
                <th className="p-3.5">Contact Details</th>
                <th className="p-3.5">Address</th>
                <th className="p-3.5">Khata Balance</th>
                <th className="p-3.5">Total Orders</th>
                <th className="p-3.5">Total Spent</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    {customers.length === 0
                      ? 'No customers yet. Select Add Customer to create an account.'
                      : 'No customers match your search or selected filter.'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const hasDue = customer.balance > 0;
                  const hasCredit = customer.balance < 0;

                  return (
                    <tr
                      key={customer.id}
                      className="transition-colors hover:bg-slate-800/40"
                    >
                      <td className="p-3.5">
                        <div className="font-bold text-slate-100">
                          {customer.name}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          ID: {customer.id}
                        </div>
                      </td>

                      <td className="p-3.5 font-mono text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-slate-500" />
                          <span>{customer.phone}</span>
                        </div>

                        {customer.email && (
                          <div className="mt-0.5 flex items-center gap-1.5 text-slate-400">
                            <Mail className="h-3 w-3 text-slate-500" />
                            <span>{customer.email}</span>
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 text-slate-400">
                        {customer.address ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0 text-slate-500" />
                            <span className="max-w-[150px] truncate">
                              {customer.address}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      <td className="p-3.5">
                        <span
                          className={`inline-block rounded-lg border px-2.5 py-1 font-mono text-xs font-bold ${
                            hasDue
                              ? 'border-rose-500/30 bg-rose-500/20 text-rose-300'
                              : hasCredit
                                ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                                : 'border-slate-700 bg-slate-800 text-slate-400'
                          }`}
                        >
                          {hasDue
                            ? `Due: ${settings.currencySymbol} ${customer.balance.toLocaleString()}`
                            : hasCredit
                              ? `Credit: ${settings.currencySymbol} ${Math.abs(customer.balance).toLocaleString()}`
                              : 'Settled (0)'}
                        </span>
                      </td>

                      <td className="p-3.5 font-mono text-slate-300">
                        {customer.totalOrders}
                      </td>

                      <td className="p-3.5 font-mono font-bold text-white">
                        {settings.currencySymbol}{' '}
                        {customer.totalSpent.toLocaleString()}
                      </td>

                      <td className="p-3.5">
                        <div className="flex flex-wrap justify-end gap-2">
                          {customer.id !== 'walk-in' &&
                            customer.id !== 'cust-walkin' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSettleCustomer(customer);
                                  setSettleAmount(
                                    customer.balance > 0
                                      ? customer.balance
                                      : 0,
                                  );
                                }}
                                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-slate-700"
                              >
                                Receive Khata
                              </button>
                            )}

                          <button
                            type="button"
                            onClick={() => handleDeleteCustomer(customer)}
                            disabled={
                              customer.id === 'walk-in' ||
                              customer.id === 'cust-walkin'
                            }
                            title="Delete customer"
                            className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
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

      {/* Settle Khata Modal */}
      {settleCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">
                Settle Customer Khata
              </h3>
              <button
                type="button"
                onClick={() => setSettleCustomer(null)}
                className="text-slate-400 hover:text-white"
                aria-label="Close settlement modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSettleSubmit} className="space-y-3 py-4 text-xs" autoComplete="off">
              <div>
                <span className="mb-0.5 block text-slate-400">Customer</span>
                <span className="text-sm font-bold text-slate-200">
                  {settleCustomer.name}
                </span>
                <div className="mt-1 font-mono font-semibold text-rose-400">
                  Current Balance: {settings.currencySymbol}{' '}
                  {settleCustomer.balance.toLocaleString()}
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  Payment Amount Received ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={settleAmount || ''}
                  onChange={(event) =>
                    setSettleAmount(parseFloat(event.target.value) || 0)
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-base font-bold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-300">
                  Receipt Note / Method
                </label>
                <input
                  type="text"
                  value={settleNote}
                  autoComplete="off"
                  onChange={(event) => setSettleNote(event.target.value)}
                  placeholder="Cash / Bank Transfer"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSettleCustomer(null)}
                  className="flex-1 rounded-xl py-2 font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-emerald-600 py-2 font-bold text-white shadow-md hover:bg-emerald-500"
                >
                  Record Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
              <h3 className="text-sm font-bold text-white">
                Create New Customer Account
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close add customer modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3 p-5 text-xs" autoComplete="off">
              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  Full Name / Shop Name *
                </label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={newCustName}
                  onChange={(event) => setNewCustName(event.target.value)}
                  placeholder="Customer or shop name"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  Phone Number
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={newCustPhone}
                  onChange={(event) => setNewCustPhone(event.target.value)}
                  placeholder="0300-1234567"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-300">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  autoComplete="off"
                  value={newCustEmail}
                  onChange={(event) => setNewCustEmail(event.target.value)}
                  placeholder="customer@example.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-300">
                  Shop / Residential Address
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={newCustAddress}
                  onChange={(event) => setNewCustAddress(event.target.value)}
                  placeholder="Shop or residential address"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  Initial Due Balance ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  min="0"
                  value={newCustBalance || ''}
                  onChange={(event) =>
                    setNewCustBalance(parseFloat(event.target.value) || 0)
                  }
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-xl px-4 py-2 font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white shadow-md hover:bg-blue-500"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
