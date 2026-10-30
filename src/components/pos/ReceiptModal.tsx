
'use client';

import { RECEIPT_VENDOR_LINE, RECEIPT_VENDOR_PHONE } from '@/utils/receiptBranding';

import React, { useEffect, useState } from 'react';
import { X, Printer, MessageCircle } from 'lucide-react';
import { whatsappReceiptText, pakistanWhatsappNumber } from '@/utils/whatsappReceipt';
import { paymentLabel } from '@/utils/paymentMethods';
import { Sale, StoreSettings } from '@/types/pos';
import { printThermalReceipt } from '@/utils/printReceipt';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale | null;
  settings: StoreSettings;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  settings,
}) => {
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappError, setWhatsappError] = useState('');
  useEffect(() => { if (isOpen) { setWhatsappPhone(sale?.customerPhone ?? ''); setWhatsappError(''); } }, [isOpen, sale?.id, sale?.customerPhone]);
  if (!isOpen || !sale) return null;


  const handlePrint = () => {
    printThermalReceipt(sale, settings);
  };

  const handleWhatsapp = () => {
    const phone = pakistanWhatsappNumber(whatsappPhone);
    if (!phone) { setWhatsappError('Enter a valid Pakistani mobile number (03XXXXXXXXX or +923XXXXXXXXX).'); return; }
    setWhatsappError('');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(whatsappReceiptText(sale, settings))}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) { setWhatsappError('Allow popups for this site to open WhatsApp.'); }
  };

  const is58mm = settings.printerPaperWidth === '58mm';

  const formatMoney = (amount: number) =>
    amount.toLocaleString();

  // Compact four-column layout for thermal receipt paper.
  const itemGrid = is58mm
    ? 'grid-cols-[minmax(0,1fr)_22px_43px_48px]'
    : 'grid-cols-[minmax(0,1fr)_30px_58px_65px]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold text-white">
              Receipt Preview ({settings.printerPaperWidth})
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Close receipt preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Receipt Preview */}
        <div className="flex justify-center overflow-y-auto bg-slate-950/80 p-4">
          <div
            className={`rounded-sm border-t-4 border-slate-300 bg-white p-3 font-mono text-slate-900 shadow-xl transition-all ${
              is58mm
                ? 'w-[260px] text-[10px]'
                : 'w-[320px] text-[12px]'
            }`}
            style={{
              boxShadow:
                '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Store Details */}
            <div className="text-center text-sm font-bold uppercase tracking-wide">
              {settings.storeName}
            </div>

            {settings.tagline && (
              <div className="text-center font-sans text-[10px] font-medium uppercase text-slate-600">
                {settings.tagline}
              </div>
            )}

            {settings.address && (
              <div className="mt-1 text-center text-[10px] text-slate-600">
                {settings.address}
              </div>
            )}

            {settings.phone && (
              <div className="text-center text-[10px] text-slate-600">
                Ph: {settings.phone}
              </div>
            )}

            {settings.terminalId && (
              <div className="text-center text-[10px] text-slate-600">
                Terminal: {settings.terminalId}
              </div>
            )}

            <div className="my-2 border-t border-dashed border-slate-800" />

            {/* Invoice Information */}
            <div className="flex justify-between gap-2 text-[10px]">
              <span className="min-w-0 break-all">
                Inv: <span className="font-bold">{sale.invoiceNumber}</span>
              </span>

              <span className="shrink-0 font-semibold uppercase">
                {paymentLabel(sale.paymentMethod)}
              </span>
            </div>

            <div className="text-[10px] text-slate-500">
              {sale.dateStr}
            </div>

            <div className="mt-0.5 break-words text-[10px]">
              Customer:{' '}
              <span className="font-semibold">
                {sale.customerName}
              </span>
              {sale.customerPhone ? ` (${sale.customerPhone})` : ''}
            </div>

            <div className="my-2 border-t border-dashed border-slate-800" />

            {/* Compact Items Table */}
            <div
              className={`grid ${itemGrid} gap-1 border-b border-dashed border-slate-400 pb-1 text-[9px] font-bold`}
            >
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Total</span>
            </div>

            <div className="space-y-1 py-1.5">
              {sale.items.map((item, idx) => {
                const price =
                  item.customPrice ?? item.product.price;

                const lineTotal =
                  price * item.quantity - (item.discount || 0);

                return (
                  <div
                    key={`${item.product.id ?? item.product.name}-${idx}`}
                    className={`grid ${itemGrid} items-start gap-1 text-[9px]`}
                  >
                    {/* Product name and SKU */}
                    <div className="min-w-0">
                      <div className="break-words font-semibold leading-tight">
                        {item.product.name}
                      </div>

                      {item.product.sku && (
                        <div className="break-all text-[8px] leading-tight text-slate-500">
                          {item.product.sku}
                        </div>
                      )}
                    </div>

                    {/* Quantity */}
                    <span className="text-right tabular-nums">
                      {item.quantity}
                    </span>

                    {/* Unit Rate */}
                    <span className="break-words text-right tabular-nums">
                      {formatMoney(price)}
                    </span>

                    {/* Line Total */}
                    <span className="break-words text-right font-bold tabular-nums">
                      {formatMoney(lineTotal)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="my-2 border-t border-dashed border-slate-800" />

            {/* Totals */}
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between gap-2">
                <span>Subtotal:</span>
                <span className="text-right">
                  {settings.currencySymbol}{' '}
                  {formatMoney(sale.subtotal)}
                </span>
              </div>

              {sale.discount > 0 && (
                <div className="flex justify-between gap-2 text-slate-600">
                  <span>Discount:</span>
                  <span className="text-right">
                    -{settings.currencySymbol}{' '}
                    {formatMoney(sale.discount)}
                  </span>
                </div>
              )}

              {sale.tax > 0 && (
                <div className="flex justify-between gap-2 text-slate-600">
                  <span>Tax:</span>
                  <span className="text-right">
                    +{settings.currencySymbol}{' '}
                    {formatMoney(sale.tax)}
                  </span>
                </div>
              )}

              <div className="my-1 flex justify-between gap-2 border-y border-dashed border-slate-900 py-1.5 text-xs font-bold">
                <span>TOTAL</span>
                <span className="text-right">
                  {settings.currencySymbol}{' '}
                  {formatMoney(sale.total)}
                </span>
              </div>

              <div className="flex justify-between gap-2 pt-0.5">
                <span>Paid:</span>
                <span className="text-right">
                  {settings.currencySymbol}{' '}
                  {formatMoney(sale.amountTendered)}
                </span>
              </div>

              <div className="flex justify-between gap-2 font-bold">
                <span>Change:</span>
                <span className="text-right">
                  {settings.currencySymbol}{' '}
                  {formatMoney(sale.changeDue)}
                </span>
              </div>
            </div>

            <div className="my-2 border-t-2 border-dashed border-slate-800" />

            {/* Footer */}
            <div className="whitespace-pre-line text-center text-[10px] leading-relaxed text-slate-600">
              {settings.receiptFooter}
            </div>

            {/* Invoice Reference */}
            <div className="mt-3 break-all text-center font-mono text-xs font-bold tracking-widest">
              * {sale.invoiceNumber} *
            </div>
            {/* Fixed software vendor imprint; not editable by store users. */}
            <div className="mt-3 border-t border-dashed border-slate-400 pt-2 text-center text-[10px] leading-relaxed text-slate-700">
              <div className="font-semibold">{RECEIPT_VENDOR_LINE}</div>
              <div>{RECEIPT_VENDOR_PHONE}</div>
            </div>
          </div>
        </div>

        {/* Optional WhatsApp receipt; the cashier must send the prefilled message. */}
        <div className="border-t border-[#E8E3F5] bg-[#F8F6FF] px-4 py-3">
          <label htmlFor="receipt-whatsapp" className="mb-1.5 block text-xs font-semibold text-[#29223B]">Customer WhatsApp number (optional)</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="receipt-whatsapp" type="tel" inputMode="tel" autoComplete="off" value={whatsappPhone}
              onChange={event => { setWhatsappPhone(event.target.value); setWhatsappError(''); }}
              placeholder="03XXXXXXXXX" className="min-w-0 flex-1 rounded-lg border border-[#CFC5EF] bg-white px-3 py-2 text-sm text-[#29223B] placeholder:text-[#756E89] focus:outline-none focus:ring-2 focus:ring-[#7357E8]" />
            <button type="button" onClick={handleWhatsapp}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#176B43] px-4 py-2 text-xs font-bold text-white hover:bg-[#105233]">
              <MessageCircle className="h-4 w-4" /> Send via WhatsApp
            </button>
          </div>
          {whatsappError && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{whatsappError}</p>}
          <p className="mt-1.5 text-[11px] text-[#625B78]">WhatsApp opens with a prepared receipt. Press Send there to share it.</p>
        </div>
        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 border-t border-[#E8E3F5] bg-white p-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-[#423B55] transition-colors hover:bg-[#F1EDFF]"
          >
            Close &amp; New Sale
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-xl bg-[#7357E8] px-5 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-[#6045D2] active:scale-[0.98]"
          >
            <Printer className="h-4 w-4" />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
