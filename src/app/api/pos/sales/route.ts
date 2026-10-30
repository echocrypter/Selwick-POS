/**
 * GET /api/pos/sales - Paginated sales history with filtering
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const db = getInitializedDatabase();

  let whereSql = 'WHERE s.business_id = ?';
  const params: (string | number)[] = [session.businessId];

  if (startDate) {
    whereSql += ' AND s.date_str >= ?';
    params.push(startDate);
  }
  if (endDate) {
    whereSql += ' AND s.date_str <= ?';
    params.push(endDate);
  }
  if (status) {
    whereSql += ' AND s.status = ?';
    params.push(status);
  }
  if (search) {
    whereSql += ' AND (lower(s.invoice_number) LIKE ? OR lower(s.customer_name) LIKE ? OR lower(s.customer_phone) LIKE ?)';
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term);
  }

  // Count total matching sales
  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM sales s ${whereSql}
  `).get(...params) as { total: number } | undefined;
  const total = countRow?.total ?? 0;

  // Query paginated sales
  const salesRows = db.prepare(`
    SELECT
      s.id,
      s.invoice_number,
      s.timestamp,
      s.date_str,
      s.subtotal_cents,
      s.discount_cents,
      s.discount_type,
      s.tax_cents,
      s.total_cents,
      s.payment_method,
      s.amount_tendered_cents,
      s.change_due_cents,
      s.customer_id,
      s.customer_name,
      s.customer_phone,
      s.notes,
      s.terminal_id,
      s.status,
      s.created_at
    FROM sales s
    ${whereSql}
    ORDER BY s.timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
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
  }>;

  // Fetch items for each sale
  const sales: Sale[] = salesRows.map((row) => {
    const itemRows = db.prepare(`
      SELECT * FROM sale_items WHERE sale_id = ?
    `).all(row.id) as Array<{
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

    return {
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
  });

  return NextResponse.json({
    ok: true,
    data: sales,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
