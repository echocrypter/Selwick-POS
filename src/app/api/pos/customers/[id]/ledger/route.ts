/**
 * GET /api/pos/customers/[id]/ledger - Retrieve customer credit ledger and settlement history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
} from '@/lib/auth/authorization';
import { CustomerRepository, toDomainCustomer } from '@/lib/db/repositories/customerRepository';
import { fromCents } from '@/lib/money';

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
  const customer = CustomerRepository.findById(db, session.businessId, id);
  if (!customer) {
    return NextResponse.json({ ok: false, error: `Customer "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  // 1. Credit Sales
  const creditSales = db.prepare(`
    SELECT
      csl.sale_id,
      s.invoice_number,
      csl.original_credit_cents,
      csl.settled_cents,
      (csl.original_credit_cents - csl.settled_cents) as remaining_debt_cents,
      csl.status,
      s.timestamp as sale_timestamp,
      csl.created_at
    FROM credit_sales_ledger csl
    JOIN sales s ON s.id = csl.sale_id
    WHERE csl.business_id = ? AND csl.customer_id = ?
    ORDER BY csl.created_at DESC
  `).all(session.businessId, id) as Array<{
    sale_id: string;
    invoice_number: string;
    original_credit_cents: number;
    settled_cents: number;
    remaining_debt_cents: number;
    status: string;
    sale_timestamp: string;
    created_at: string;
  }>;

  // 2. Khata Settlements
  const settlements = db.prepare(`
    SELECT
      ks.id as settlement_id,
      ks.amount_cents,
      ks.payment_method,
      ks.notes,
      u.name as cashier_name,
      ks.created_at
    FROM khata_settlements ks
    LEFT JOIN users u ON u.id = ks.user_id
    WHERE ks.business_id = ? AND ks.customer_id = ?
    ORDER BY ks.created_at DESC
  `).all(session.businessId, id) as Array<{
    settlement_id: string;
    amount_cents: number;
    payment_method: string;
    notes: string | null;
    cashier_name: string | null;
    created_at: string;
  }>;

  // 3. Settlement Allocations
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
  `).all(session.businessId, id);

  return NextResponse.json({
    ok: true,
    data: {
      customer: toDomainCustomer(customer),
      currentBalanceRupees: fromCents(customer.balance_cents),
      currentBalanceCents: customer.balance_cents,
      creditSales: creditSales.map((cs) => ({
        ...cs,
        originalCreditRupees: fromCents(cs.original_credit_cents),
        settledRupees: fromCents(cs.settled_cents),
        remainingDebtRupees: fromCents(cs.remaining_debt_cents),
      })),
      settlements: settlements.map((s) => ({
        ...s,
        amountRupees: fromCents(s.amount_cents),
      })),
      allocations,
    },
  });
}
