import { Sale, StoreSettings } from '@/types/pos';
import { RECEIPT_VENDOR_LINE, RECEIPT_VENDOR_PHONE } from '@/utils/receiptBranding';
import { paymentLabel } from '@/utils/paymentMethods';

export function whatsappReceiptText(sale: Sale, settings: StoreSettings): string {
 const money = (amount:number) => `${settings.currencySymbol} ${amount.toLocaleString()}`;
 const lines = sale.items.map(item => {
  const unit = item.customPrice ?? item.product.price;
  const total = unit * item.quantity - (item.discount || 0);
  return `• ${item.product.name} × ${item.quantity} @ ${money(unit)} = ${money(total)}${item.discount ? ` (discount ${money(item.discount)})` : ''}`;
 });
 return [settings.storeName || 'Selwick POS', 'SALES RECEIPT',
  `Invoice: ${sale.invoiceNumber}`, `Date: ${sale.dateStr || new Date(sale.timestamp).toLocaleString()}`,
  `Customer: ${sale.customerName || 'Walk-in'}`, '--------------------', ...lines,
  '--------------------', `Subtotal: ${money(sale.subtotal)}`, `Discount: ${money(sale.discount)}`,
  `Tax: ${money(sale.tax)}`, `TOTAL: ${money(sale.total)}`,
  `Payment: ${paymentLabel(sale.paymentMethod)}`,
  ...(settings.phone ? [`Store phone: ${settings.phone}`] : []),
  ...(settings.address ? [`Address: ${settings.address}`] : []),
  settings.receiptFooter || 'Thank you for shopping!',
  RECEIPT_VENDOR_LINE, RECEIPT_VENDOR_PHONE].join('\n');
}
export function pakistanWhatsappNumber(raw: string): string | null {
 const digits = raw.replace(/\D/g,'');
 if (/^03\d{9}$/.test(digits)) return `92${digits.slice(1)}`;
 if (/^923\d{9}$/.test(digits)) return digits;
 if (/^3\d{9}$/.test(digits)) return `92${digits}`;
 if (/^00923\d{9}$/.test(digits)) return digits.slice(2);
 return null;
}
