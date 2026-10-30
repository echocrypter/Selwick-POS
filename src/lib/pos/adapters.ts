/**
 * Selwick POS – Frontend Compatibility Adapters
 *
 * Provides type-safe converters and validation bridges between:
 *   - Frontend UI models (floating-point Rupees, LocalStorage structures)
 *   - Server API models (integer minor units / paisa, strict SQLite contracts)
 *
 * Designed for safe, seamless integration in Milestone 6 without altering
 * current frontend state or runtime behavior.
 */

import { toCents, fromCents } from '../money';
import { type CartItem, type Sale } from '../../types/pos';
import {
  type CheckoutItemInput,
  type CheckoutRequest,
  type PosPaymentMethod,
} from './types';

export interface FrontendCheckoutOptions {
  businessId?: string;
  cart: CartItem[];
  discountType?: 'fixed' | 'percent';
  orderDiscount?: number; // In Rupees if fixed, 0-100 if percent
  taxRatePercent?: number;
  enableTax?: boolean;
  paymentMethod: PosPaymentMethod;
  amountTendered?: number; // In Rupees
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  terminalId?: string;
  notes?: string;
  transactionRef?: string;
  idempotencyKey?: string;
}

/**
 * Converts frontend cart items and payment options into a strict, integer-minor-unit
 * CheckoutRequest suitable for POST /api/pos/checkout.
 */
export function buildCheckoutPayload(options: FrontendCheckoutOptions): CheckoutRequest {
  const {
    businessId,
    cart,
    discountType = 'fixed',
    orderDiscount = 0,
    taxRatePercent = 0,
    enableTax = false,
    paymentMethod,
    amountTendered,
    customerId,
    customerName,
    customerPhone,
    terminalId,
    notes,
    transactionRef,
    idempotencyKey,
  } = options;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('[ADAPTER_ERROR] Cart cannot be empty for checkout payload generation.');
  }

  // Convert line items to integer paisa
  const items: CheckoutItemInput[] = cart.map((item) => {
    const input: CheckoutItemInput = {
      productId: item.product.id,
      quantity: Math.floor(item.quantity),
      discountCents: item.discount ? toCents(item.discount, false, 'Line discount') : 0,
    };
    if (item.customPrice !== undefined && item.customPrice !== null) {
      input.customPriceCents = toCents(item.customPrice, false, 'Custom price');
    }
    return input;
  });

  // Convert order-level discount
  let discountValueCentsOrPercent = 0;
  if (discountType === 'percent') {
    discountValueCentsOrPercent = Math.max(0, Math.min(100, Number(orderDiscount) || 0));
  } else {
    discountValueCentsOrPercent = orderDiscount ? toCents(orderDiscount, false, 'Order discount') : 0;
  }

  // Convert tendered amount
  let amountTenderedCents: number | undefined;
  if (amountTendered !== undefined && amountTendered !== null) {
    amountTenderedCents = toCents(amountTendered, false, 'Amount tendered');
  }

  return {
    businessId,
    items,
    discountType,
    discountValue: discountValueCentsOrPercent,
    taxRatePercent: Number(taxRatePercent) || 0,
    enableTax: Boolean(enableTax),
    paymentMethod,
    amountTenderedCents,
    customerId: customerId || undefined,
    customerName: customerName || undefined,
    customerPhone: customerPhone || undefined,
    terminalId: terminalId || undefined,
    notes: notes || undefined,
    transactionRef: transactionRef || undefined,
    idempotencyKey: idempotencyKey || undefined,
  };
}

/**
 * Maps a SQLite Sale record back into standard frontend Sale format (Rupees).
 */
export function sqliteSaleToFrontendSale(sale: Sale): Sale {
  return {
    ...sale,
    subtotal: typeof sale.subtotal === 'number' ? sale.subtotal : 0,
    discount: typeof sale.discount === 'number' ? sale.discount : 0,
    tax: typeof sale.tax === 'number' ? sale.tax : 0,
    total: typeof sale.total === 'number' ? sale.total : 0,
    amountTendered: typeof sale.amountTendered === 'number' ? sale.amountTendered : 0,
    changeDue: typeof sale.changeDue === 'number' ? sale.changeDue : 0,
  };
}

/**
 * Interface and converter for Khata balance settlement.
 */
export interface KhataSettlementInput {
  customerId: string;
  settlementAmount: number; // In Rupees
  paymentMethod: 'cash' | 'bank_transfer' | 'other';
  notes?: string;
  idempotencyKey?: string;
}

export interface KhataSettlementPayload {
  customerId: string;
  settlementAmountCents: number; // In Paisa
  paymentMethod: string;
  notes?: string;
  idempotencyKey?: string;
}

export function buildKhataSettlementPayload(input: KhataSettlementInput): KhataSettlementPayload {
  return {
    customerId: input.customerId,
    settlementAmountCents: toCents(input.settlementAmount, false, 'Settlement amount'),
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    idempotencyKey: input.idempotencyKey,
  };
}
