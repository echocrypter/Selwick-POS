/**
 * GET /api/pos/khata/ledger/[customerId] - Retrieve customer settlement and allocation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
} from '@/lib/auth/authorization';
import { fromCents } from '@/lib/money';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
): Promise<NextResponse> {
  const { customerId } = await params;

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

  const customer = db.prepare(`
    SELECT id, name, phone, balance_cents FROM customers
    WHERE id = ? AND business_id = ?
  `).get(customerId, session.businessId) as { id: string; name: string; phone: string; balance_cents: number } | undefined;

  if (!customer) {
    return NextResponse.json({ ok: false, error: `Customer "${customerId}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  const settlements = db.prepare(`
    SELECT
      ks.id,
      ks.amount_cents,
      ks.payment_method,
      ks.notes,
      u.name as cashier_name,
      ks.created_at
    FROM khata_settlements ks
    LEFT JOIN users u ON u.id = ks.user_id
    WHERE ks.business_id = ? AND ks.customer_id = ?
    ORDER BY ks.created_at DESC
  `).all(session.businessId, customerId) as Array<{
    id: string;
    amount_cents: number;
    payment_method: string;
    notes: string | null;
    cashier_name: string | null;
    created_at: string;
  }>;

  const allocations = db.prepare(`
    SELECT
      ksa.id as allocation_id,
      ksa.settlement_id,
      ksa.sale_id,
      s.invoice_number,
      ksa.allocated_cents,
      ksa.created_at
    FROM khata_settlement_allocations ksa
    JOIN sales s ON s.id = ksa.sale_id
    WHERE ksa.business_id = ? AND ksa.customer_id = ?
    ORDER BY ksa.created_at DESC
  `).all(session.businessId, customerId);

  return NextResponse.json({
    ok: true,
    data: {
      customerId: customer.id,
      customerName: customer.name,
      currentBalanceCents: customer.balance_cents,
      currentBalanceRupees: fromCents(customer.balance_cents),
      settlements: settlements.map((s) => ({
        ...s,
        amountRupees: fromCents(s.amount_cents),
      })),
      allocations,
    },
  });
}
