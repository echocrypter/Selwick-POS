/**
 * GET /api/pos/customers/[id] - Get customer by ID
 * PUT /api/pos/customers/[id] - Update customer profile
 *
 * CRITICAL INVARIANT: Customer balance cannot be arbitrarily overwritten!
 * Debt adjustments must exclusively occur via transactional checkout, refund, or Khata settlements.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { CustomerRepository, toDomainCustomer } from '@/lib/db/repositories/customerRepository';
import { ValidationError, NotFoundError } from '@/lib/db/repositories/errors';

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
  const row = CustomerRepository.findById(db, session.businessId, id);
  if (!row) {
    return NextResponse.json({ ok: false, error: `Customer "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: toDomainCustomer(row) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  // BALANCE INTEGRITY GUARD:
  // Reject any attempts to directly mutate financial debt fields via ordinary customer edit.
  if ('balance' in body || 'balanceCents' in body || 'balance_cents' in body) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Customer balance cannot be arbitrarily overwritten through customer profile edits. All balance adjustments must occur through verified checkout, refund, or Khata settlement transactions.',
        code: 'BALANCE_MUTATION_FORBIDDEN',
      },
      { status: 400 }
    );
  }

  const db = getInitializedDatabase();
  try {
    const updated = CustomerRepository.update(db, session.businessId, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      email: body.email !== undefined ? (typeof body.email === 'string' ? body.email : null) : undefined,
      address: body.address !== undefined ? (typeof body.address === 'string' ? body.address : null) : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainCustomer(updated) });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to update customer.';
    return NextResponse.json({ ok: false, error: msg, code: 'UPDATE_CUSTOMER_FAILED' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let session;
  try {
    session = requireRole(req, ['manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const existing = CustomerRepository.findById(db, session.businessId, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: `Customer "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }
  if (existing.balance_cents > 0) {
    return NextResponse.json({
      ok: false,
      error: 'Cannot delete a customer with an outstanding Khata balance. Settle the balance first.',
      code: 'CUSTOMER_HAS_BALANCE',
    }, { status: 409 });
  }

  const saleCount = db.prepare(
    'SELECT COUNT(*) as c FROM sales WHERE business_id = ? AND customer_id = ?',
  ).get(session.businessId, id) as { c: number };
  if (Number(saleCount?.c || 0) > 0) {
    return NextResponse.json({
      ok: false,
      error: 'Cannot delete a customer who appears on historical sales. Customer records are retained for audit.',
      code: 'CUSTOMER_HAS_SALES',
    }, { status: 409 });
  }

  CustomerRepository.delete(db, session.businessId, id);
  return NextResponse.json({ ok: true, deleted: true });
}
