
'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Banknote,
  CreditCard,
  Wallet,
  CheckCircle2,
  Printer,
  Sparkles,
  QrCode,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import confetti from 'canvas-confetti';

import {
  CartItem,
  Customer,
  PaymentMethod,
  StoreSettings,
} from '@/types/pos';
import { playSound } from '@/utils/sound';
import { PAYMENT_METHODS } from '@/utils/paymentMethods';

export interface PaymentResult {
  paymentMethod: PaymentMethod;
  amountTendered: number;
  changeDue: number;
  notes?: string;
  transactionRef?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  customer: Customer | null;
  settings: StoreSettings;
  onCompleteSale: (result: PaymentResult) => void | Promise<void>;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  subtotal,
  discount,
  tax,
  total,
  customer,
  settings,
  onCompleteSale,
}) => {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState<number>(total);
  const [amountDirty, setAmountDirty] = useState<boolean>(false);
  const [notes, setNotes] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmountTendered(total);
      setMethod('cash');
      setAmountDirty(false);
      setNotes('');
      setTransactionRef('');
      setIsProcessing(false);
      setCheckoutError('');
    }
  }, [isOpen]);

  const isCustomerSelected =
    !!customer &&
    customer.id !== 'walk-in' &&
    customer.id !== 'cust-walkin';

  useEffect(() => {
    if (!isOpen) return;
    // Preserve manually entered amounts; only apply method defaults for fresh input.
    if (amountDirty) return;
    if (method === 'credit') {
      setAmountTendered(0);
    } else if (method === 'cash') {
      setAmountTendered(total);
    }
  }, [isOpen, method, total, amountDirty]);

  if (!isOpen) return null;

  const changeDue = Math.max(0, amountTendered - total);
  const isUnderpaid = method === 'cash' && amountTendered < total;
  const isCreditOverpaid = method === 'credit' && amountTendered > total;

  const handleComplete = async () => {
    if (isProcessing) return;

    if (method === 'credit') {
      if (!isCustomerSelected) {
        setCheckoutError('Select a customer before using Credit/Khata/Udhar.');
        playSound('error', settings.soundEnabled);
        return;
      }

      if (
        !Number.isFinite(amountTendered) ||
        amountTendered < 0 ||
        amountTendered > total
      ) {
        setCheckoutError(
          'Down payment must be between 0 and the sale total for Credit/Khata/Udhar.',
        );
        playSound('error', settings.soundEnabled);
        return;
      }
    }

    if (isUnderpaid) {
      playSound('error', settings.soundEnabled);
      setCheckoutError('The amount tendered is less than the total due.');
      return;
    }

    if (!Number.isFinite(total) || total < 0) {
      setCheckoutError('The sale total is invalid. Please review the cart.');
      playSound('error', settings.soundEnabled);
      return;
    }

    setIsProcessing(true);
    setCheckoutError('');

    try {
      await onCompleteSale({
        paymentMethod: method,
        amountTendered:
          method === 'cash'
            ? amountTendered
            : method === 'credit'
              ? amountTendered
              : total,
        changeDue: method === 'cash' ? changeDue : 0,
        notes: notes.trim() || undefined,
        transactionRef: transactionRef.trim() || undefined,
      });

      // Show success feedback only after the sale handler resolves.
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'],
        });
      } catch (error) {
        console.debug('Confetti effect could not run:', error);
      }

      playSound('success', settings.soundEnabled);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The sale could not be completed. Please try again.';

      setCheckoutError(message);
      playSound('error', settings.soundEnabled);
    } finally {
      setIsProcessing(false);
    }
  };

  const addDenomination = (add: number) => {
    setAmountTendered((prev) => (prev || 0) + add);
    setAmountDirty(true);
    playSound('click', settings.soundEnabled);
  };

  const setExact = () => {
    setAmountTendered(total);
    setAmountDirty(true);
    playSound('click', settings.soundEnabled);
  };

  const roundUpTo = (step: number) => {
    setAmountTendered(Math.ceil(total / step) * step);
    setAmountDirty(true);
    playSound('click', settings.soundEnabled);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Checkout &amp; Payment
            </h2>
            <p className="text-xs text-slate-400">
              Customer:{' '}
              <span className="font-semibold text-slate-200">
                {customer?.name ?? 'Walk-in Sale'}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close payment"
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
              <span className="block text-[10px] uppercase text-slate-400">
                Subtotal
              </span>
              <span className="font-mono text-xs font-bold text-slate-200">
                {settings.currencySymbol} {subtotal.toLocaleString()}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
              <span className="block text-[10px] uppercase text-slate-400">
                Discount
              </span>
              <span className="font-mono text-xs font-bold text-emerald-400">
                {discount > 0
                  ? `-${settings.currencySymbol} ${discount.toLocaleString()}`
                  : 'None'}
              </span>
            </div>

            <div className="rounded-xl border border-blue-500/40 bg-blue-950/40 p-2.5">
              <span className="block text-[10px] font-bold uppercase text-blue-300">
                Total Due
              </span>
              <span className="font-mono text-base font-black text-white">
                {settings.currencySymbol} {total.toLocaleString()}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-300">
              Payment Method
            </label>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PAYMENT_METHODS.filter(
                (option) =>
                  option.value !== 'wallet' &&
                  (option.value !== 'credit' || isCustomerSelected),
              ).map(option => (
                <button key={option.value} type="button" disabled={isProcessing}
                  onClick={() => { setMethod(option.value); setCheckoutError(''); setTransactionRef(''); playSound('click', settings.soundEnabled); }}
                  aria-pressed={method === option.value}
                  className={`min-h-12 rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${method === option.value ? 'border-[#7357E8] bg-[#7357E8] text-white' : 'border-[#DCD6F0] bg-white text-[#29223B] hover:bg-[#F1EDFF]'} disabled:opacity-50`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {method === 'cash' && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Amount Tendered
                  </label>
                  <button
                    type="button"
                    onClick={setExact}
                    disabled={isProcessing}
                    className="text-[11px] font-semibold text-blue-400 underline hover:text-blue-300 disabled:opacity-50"
                  >
                    Exact Amount ({settings.currencySymbol}{' '}
                    {total.toLocaleString()})
                  </button>
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    {settings.currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={amountTendered || ''}
                    disabled={isProcessing}
                    onChange={(event) => {
                      setAmountTendered(
                        Math.max(0, Number.parseFloat(event.target.value) || 0),
                      );
                      setAmountDirty(true);
                      setCheckoutError('');
                    }}
                    placeholder="0"
                    autoFocus
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 font-mono text-xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => addDenomination(500)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  +500
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => addDenomination(1000)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  +1,000
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => addDenomination(5000)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  +5,000
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => roundUpTo(500)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-blue-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Round 500
                </button>
              </div>

              <div
                className={`flex items-center justify-between rounded-xl border p-3 ${
                  isUnderpaid
                    ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isUnderpaid ? (
                    <AlertCircle className="h-5 w-5 text-rose-400" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  )}
                  <span className="text-xs font-bold">
                    {isUnderpaid
                      ? 'Short Amount (Insufficient):'
                      : 'Change Return Due:'}
                  </span>
                </div>
                <div className="font-mono text-lg font-black">
                  {settings.currencySymbol}{' '}
                  {isUnderpaid
                    ? (total - amountTendered).toLocaleString()
                    : changeDue.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {method === 'credit' && (
            <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-100">
              <div>
                <label className="mb-1 block font-semibold text-amber-200">
                  Down Payment (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    {settings.currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={total}
                    value={amountTendered || ''}
                    disabled={isProcessing}
                    onChange={(event) => {
                      setAmountTendered(
                        Math.max(0, Number.parseFloat(event.target.value) || 0),
                      );
                      setAmountDirty(true);
                      setCheckoutError('');
                    }}
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 font-mono text-xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                  />
                </div>
                <p className="mt-2 text-amber-200/80">
                  Enter any amount received now. The remaining balance will be
                  added to this customer&apos;s Khata/Udhar.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-950/30 p-3">
                <span className="font-bold">Remaining Khata Balance</span>
                <span className="font-mono text-lg font-black">
                  {settings.currencySymbol}{' '}
                  {Math.max(0, total - amountTendered).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {method === 'card' && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  Card Authorization / Approval Code (Optional)
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={transactionRef}
                  disabled={isProcessing}
                  onChange={(event) => setTransactionRef(event.target.value)}
                  placeholder="e.g. AUTH-992140"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Swipe or tap the customer card on your payment terminal, then
                confirm the payment.
              </p>
            </div>
          )}

          {method !== 'cash' && method !== 'card' && (
            <div className="rounded-xl border border-[#E0D9F5] bg-[#F8F6FF] p-4 text-xs text-[#29223B]">
              <label className="mb-2 block font-semibold">Transaction / Reference ID (Optional)</label>
              <input type="text" autoComplete="off" value={transactionRef} disabled={isProcessing}
                onChange={event => setTransactionRef(event.target.value)} placeholder="Enter payment reference"
                className="w-full rounded-lg border border-[#CFC5EF] bg-white px-3 py-2 text-[#29223B] placeholder:text-[#726A83] focus:outline-none focus:ring-2 focus:ring-[#7357E8]" />
              <p className="mt-2 text-[#625B78]">Confirm the payment in your bank or wallet app before completing this sale. Selwick records the method; it does not process the transfer.</p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Order Notes (Optional)
            </label>
            <input
              type="text"
              autoComplete="off"
              value={notes}
              disabled={isProcessing}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. Special packing, customer promised remaining Rs tomorrow..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          {checkoutError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div>
                <p className="font-semibold">Checkout was not confirmed</p>
                <p className="mt-1 break-words text-xs">{checkoutError}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-950 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleComplete}
            disabled={isUnderpaid || isCreditOverpaid || isProcessing || (method === 'credit' && !isCustomerSelected)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 transition-all hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing Sale...</span>
              </>
            ) : (
              <>
                <Printer className="h-4 w-4" />
                <span>Complete &amp; Print Receipt</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
