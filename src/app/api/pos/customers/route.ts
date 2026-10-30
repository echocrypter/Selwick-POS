/**
 * GET  /api/pos/customers - List customers for business
 * POST /api/pos/customers - Create a new customer
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
import { ValidationError, ConflictError } from '@/lib/db/repositories/errors';

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
  const search = searchParams.get('search') || undefined;
  const phone = searchParams.get('phone') || undefined;

  const db = getInitializedDatabase();
  let rows;
  if (phone) {
    const single = CustomerRepository.findByPhone(db, session.businessId, phone);
    rows = single ? [single] : [];
  } else {
    rows = CustomerRepository.list(db, session.businessId, { search });
  }

  const customers = rows.map(toDomainCustomer);
  return NextResponse.json({ ok: true, data: customers, total: customers.length });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

  if (!name) {
    return NextResponse.json({ ok: false, error: 'Customer name is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ ok: false, error: 'Customer phone number is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const db = getInitializedDatabase();
  try {
    const created = CustomerRepository.create(db, session.businessId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      name,
      phone,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      address: typeof body.address === 'string' ? body.address.trim() : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainCustomer(created) }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to create customer.';
    return NextResponse.json({ ok: false, error: msg, code: 'CREATE_CUSTOMER_FAILED' }, { status: 500 });
  }
}
