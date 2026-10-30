/**
 * GET  /api/pos/held - List held parked sales
 * POST /api/pos/held - Park/create a held sale (does NOT deduct inventory)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { HeldSalesRepository, toDomainHeldSale } from '@/lib/db/repositories/heldSalesRepository';
import { ValidationError } from '@/lib/db/repositories/errors';

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

  const db = getInitializedDatabase();
  const rows = HeldSalesRepository.list(db, session.businessId);
  const heldSales = rows.map(toDomainHeldSale);

  return NextResponse.json({ ok: true, data: heldSales, total: heldSales.length });
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

  const invoiceNumber = String(body.invoiceNumber || '').trim();
  if (!invoiceNumber) {
    return NextResponse.json({ ok: false, error: 'Invoice number is required to hold sale.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ ok: false, error: 'Cannot hold sale with empty items.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const db = getInitializedDatabase();
  try {
    const created = HeldSalesRepository.create(db, session.businessId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      invoiceNumber,
      dateStr: typeof body.dateStr === 'string' ? body.dateStr : undefined,
      timestamp: typeof body.timestamp === 'number' ? body.timestamp : undefined,
      items: body.items as any,
      customer: body.customer as any,
      note: typeof body.note === 'string' ? body.note : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainHeldSale(created) }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to hold sale.';
    return NextResponse.json({ ok: false, error: msg, code: 'HOLD_SALE_FAILED' }, { status: 500 });
  }
}
