/**
 * Selwick POS – Milestone 5 Type Definitions
 * Server-side checkout and refund contracts.
 */

import { type PaymentMethod, type Sale, type CartItem } from '../../types/pos';
import { type SaleTotals } from '../money';

export type PosPaymentMethod = PaymentMethod | 'credit';

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
  discountCents?: number;
  customPriceCents?: number;
}

export interface CheckoutRequest {
  businessId?: string;
  items: CheckoutItemInput[];
  discountType?: 'fixed' | 'percent';
  discountValue?: number; // Cents if fixed, percentage (0-100) if percent
  taxRatePercent?: number;
  enableTax?: boolean;
  paymentMethod: PosPaymentMethod;
  amountTenderedCents?: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  terminalId?: string;
  idempotencyKey?: string;
  transactionRef?: string;
}

export interface CheckoutResult {
  sale: Sale;
  invoiceNumber: string;
  totals: SaleTotals;
  idempotentReplay?: boolean;
}

export interface RefundRequest {
  businessId?: string;
  saleId?: string;
  invoiceNumber?: string;
  reason?: string;
  restockItems?: boolean;
  idempotencyKey?: string;
}

export interface RefundResult {
  refundId: string;
  saleId: string;
  invoiceNumber: string;
  status: 'refunded';
  refundedAt: string;
  restockedItemCount: number;
  reversedTotalCents: number;
  cashPayoutCents: number;
  debtReversalCents: number;
  payoutMethod: string;
  payoutStatus: string;
  customerUpdated: boolean;
  notes?: string;
  idempotentReplay?: boolean;
}
