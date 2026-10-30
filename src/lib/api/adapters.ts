/**
 * Selwick POS — Safe Frontend-to-Backend Monetary & Contract Adapters
 *
 * Provides bidirectional conversions between:
 *   - Frontend: Rupees (floating point decimal numbers, e.g. 1500.50)
 *   - Backend: Paisa / minor units (integers, e.g. 150050)
 *
 * Guarantees zero precision loss, string-split arithmetic, and contract consistency.
 */

import { toCents, fromCents, MoneyError } from '../money';
import { type CartItem, type Customer, type Sale, type StoreSettings, type Product } from '../../types/pos';
import { type PaymentResult } from '../../components/pos/PaymentModal';
import {
  type CheckoutApiPayload,
  type CheckoutApiResult,
  type RefundApiPayload,
  type RefundApiResult,
} from './posApiClient';

export interface FrontendCheckoutParams {
  cart: CartItem[];
  payment: PaymentResult;
  customer: Customer | null;
  discount: number;
  discountType: 'fixed' | 'percent';
  settings: StoreSettings;
  terminalId?: string;
  notes?: string;
}

/**
 * Converts frontend cart and payment details into the backend SQLite checkout payload.
 */
export function toBackendCheckoutPayload(params: FrontendCheckoutParams): CheckoutApiPayload {
  const { cart, payment, customer, discount, discountType, settings, terminalId, notes } = params;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Cannot checkout with an empty cart.');
  }

  const items = cart.map((item) => {
    const unitPriceCents = toCents(item.product.price, false, `Product ${item.product.name} price`);
    let customPriceCents: number | null = null;

    if (item.customPrice !== undefined && item.customPrice !== null) {
      customPriceCents = toCents(item.customPrice, false, `Custom price for ${item.product.name}`);
    }

    let discountCents = 0;
    if (item.discount !== undefined && item.discount > 0) {
      discountCents = toCents(item.discount, false, `Line discount for ${item.product.name}`);
    }

    return {
      productId: item.product.id,
      quantity: item.quantity,
      discountCents,
      customPriceCents,
    };
  });

  const paymentMethod = payment.paymentMethod.toLowerCase();
  let amountTenderedCents: number | null = null;
  if (payment.amountTendered !== undefined && payment.amountTendered !== null) {
    amountTenderedCents = toCents(payment.amountTendered, false, 'Amount tendered');
  }

  let discountValue = 0;
  if (discount > 0) {
    discountValue = discountType === 'percent'
      ? Math.round(discount)
      : toCents(discount, false, 'Sale fixed discount');
  }

  const mergedNotes = [notes, payment.notes].filter(Boolean).join('\n') || undefined;

  return {
    items,
    paymentMethod,
    amountTenderedCents,
    customerId: customer?.id || null,
    customerName: customer?.name || null,
    customerPhone: customer?.phone || null,
    discountType,
    discountValue,
    enableTax: Boolean(settings.enableTax),
    taxRatePercent: Number(settings.taxRate || 0),
    terminalId: terminalId || 'main-terminal',
    transactionRef: payment.transactionRef || null,
    notes: mergedNotes,
  };
}

/**
 * Converts backend checkout result into a frontend domain Sale object.
 */
export function fromBackendCheckoutResult(
  result: CheckoutApiResult,
  originalParams: FrontendCheckoutParams,
  timestampStr?: string
): Sale {
  const now = new Date();
  const dateStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const rawTimestamp = timestampStr || now.toISOString();

  const totalCents = result.totals?.totalCents ?? result.sale.totalCents ?? (result.sale.total !== undefined ? toCents(result.sale.total, false, 'total') : 0);
  const subtotalCents = result.totals?.subtotalCents ?? result.sale.subtotalCents ?? (result.sale.subtotal !== undefined ? toCents(result.sale.subtotal, false, 'subtotal') : totalCents);
  const discountCents = result.totals?.discountCents ?? result.sale.discountCents ?? (result.sale.discount !== undefined ? toCents(result.sale.discount, false, 'discount') : 0);
  const taxCents = result.totals?.taxCents ?? result.sale.taxCents ?? (result.sale.tax !== undefined ? toCents(result.sale.tax, false, 'tax') : 0);

  return {
    id: result.sale.id,
    invoiceNumber: result.invoiceNumber || result.sale.invoiceNumber,
    items: [...originalParams.cart],
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    discountType: originalParams.discountType,
    tax: fromCents(taxCents),
    total: fromCents(totalCents),
    paymentMethod: result.sale.paymentMethod as any,
    dateStr,
    timestamp: rawTimestamp,
    customerId: originalParams.customer?.id,
    customerName: originalParams.customer?.name || 'Walk-in Customer',
    customerPhone: originalParams.customer?.phone,
    status: (result.sale.status as 'completed' | 'refunded' | 'cancelled') || 'completed',
    amountTendered: originalParams.payment.amountTendered,
    changeDue: originalParams.payment.changeDue,
    notes: originalParams.payment.notes,
    terminalId: originalParams.terminalId || originalParams.settings.terminalId,
  };
}

export interface FrontendRefundParams {
  saleId: string;
  reason?: string;
  notes?: string;
}

/**
 * Converts frontend refund parameters into backend refund payload.
 */
export function toBackendRefundPayload(params: FrontendRefundParams): RefundApiPayload {
  return {
    saleId: params.saleId,
    reason: params.reason || 'Customer requested refund',
    notes: params.notes,
  };
}

export interface FrontendRefundResult {
  refundId: string;
  saleId: string;
  invoiceNumber: string;
  status: 'refunded';
  payoutMethod: string;
  cashPayout: number;
  debtReversed: number;
  idempotentReplay: boolean;
}

/**
 * Converts backend refund result into frontend representation with currency in Rupees.
 */
export function fromBackendRefundResult(result: RefundApiResult): FrontendRefundResult {
  return {
    refundId: result.refundId,
    saleId: result.saleId,
    invoiceNumber: result.invoiceNumber,
    status: 'refunded',
    payoutMethod: result.payoutMethod,
    cashPayout: fromCents(result.cashPayoutCents),
    debtReversed: fromCents(result.debtReversedCents),
    idempotentReplay: result.idempotentReplay,
  };
}

/**
 * Converts frontend Khata settlement amount in Rupees to integer paisa.
 */
export function toBackendKhataSettlementAmount(rupees: number): number {
  return toCents(rupees, false, 'Khata settlement amount');
}

/**
 * Converts backend Khata settled cents to Rupees.
 */
export function fromBackendKhataSettlementAmount(cents: number): number {
  return fromCents(cents);
}

/**
 * Converts backend customer balance cents to frontend Rupees.
 */
export function toCustomerCreditRupees(balanceCents: number): number {
  return fromCents(balanceCents);
}

/**
 * Converts frontend customer balance in Rupees to integer paisa.
 */
export function toCustomerBalanceCents(balanceRupees: number): number {
  return toCents(balanceRupees, false, 'Customer balance');
}
