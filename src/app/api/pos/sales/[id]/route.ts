/**
 * GET /api/pos/sales/[id] - Retrieve single sale details with line items and refund ledger
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
} from '@/lib/auth/authorization';
import { fromCents } from '@/lib/money';
import type { Sale, CartItem } from '@/types/pos';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const row = db.prepare(`
    SELECT * FROM sales
    WHERE id = ? AND business_id = ?
  `).get(id, session.businessId) as {
    id: string;
    invoice_number: string;
    timestamp: string;
    date_str: string;
    subtotal_cents: number;
    discount_cents: number;
    discount_type: 'fixed' | 'percent';
    tax_cents: number;
    total_cents: number;
    payment_method: string;
    amount_tendered_cents: number;
    change_due_cents: number;
    customer_id: string | null;
    customer_name: string;
    customer_phone: string | null;
    notes: string | null;
    terminal_id: string;
    status: 'completed' | 'refunded' | 'cancelled';
    created_at: string;
  } | undefined;

  if (!row) {
    return NextResponse.json({ ok: false, error: `Sale "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  // Fetch items
  const itemRows = db.prepare(`
    SELECT * FROM sale_items WHERE sale_id = ?
  `).all(id) as Array<{
    id: string;
    product_id: string | null;
    product_name: string;
    product_sku: string | null;
    product_barcode: string | null;
    category: string | null;
    quantity: number;
    price_cents: number;
    cost_price_cents: number;
    discount_cents: number;
    custom_price_cents: number | null;
  }>;

  const items: CartItem[] = itemRows.map((ir) => ({
    product: {
      id: ir.product_id || `prod-archived-${ir.id}`,
      name: ir.product_name,
      sku: ir.product_sku || '',
      barcode: ir.product_barcode || '',
      category: ir.category || 'other',
      price: fromCents(ir.price_cents),
      costPrice: fromCents(ir.cost_price_cents),
      stock: 0,
      minStockAlert: 5,
      iconType: 'other',
    },
    quantity: ir.quantity,
    discount: fromCents(ir.discount_cents),
    customPrice: ir.custom_price_cents !== null ? fromCents(ir.custom_price_cents) : undefined,
  }));

  const sale: Sale = {
    id: row.id,
    invoiceNumber: row.invoice_number,
    timestamp: row.timestamp,
    dateStr: row.date_str,
    items,
    subtotal: fromCents(row.subtotal_cents),
    discount: fromCents(row.discount_cents),
    discountType: row.discount_type,
    tax: fromCents(row.tax_cents),
    total: fromCents(row.total_cents),
    paymentMethod: row.payment_method as any,
    amountTendered: fromCents(row.amount_tendered_cents),
    changeDue: fromCents(row.change_due_cents),
    customerId: row.customer_id || undefined,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || undefined,
    notes: row.notes || undefined,
    terminalId: row.terminal_id,
    status: row.status,
  };

  // Fetch refund ledger records for this sale
  const refunds = db.prepare(`
    SELECT * FROM refund_ledger WHERE sale_id = ? AND business_id = ?
  `).all(id, session.businessId);

  // Fetch credit ledger info if applicable
  const creditLedger = db.prepare(`
    SELECT * FROM credit_sales_ledger WHERE sale_id = ? AND business_id = ?
  `).get(id, session.businessId);

  return NextResponse.json({
    ok: true,
    data: {
      sale,
      refunds,
      creditLedger,
    },
  });
}
