/**
 * GET    /api/pos/held/[id] - Retrieve single held sale
 * PUT    /api/pos/held/[id] - Update held sale
 * DELETE /api/pos/held/[id] - Delete/unpark held sale
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
  const row = HeldSalesRepository.findById(db, session.businessId, id);
  if (!row) {
    return NextResponse.json({ ok: false, error: `Held sale "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: toDomainHeldSale(row) });
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

  const db = getInitializedDatabase();
  try {
    const updated = HeldSalesRepository.update(db, session.businessId, id, {
      items: Array.isArray(body.items) ? (body.items as any) : undefined,
      customer: body.customer as any,
      note: typeof body.note === 'string' ? body.note : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainHeldSale(updated) });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to update held sale.';
    return NextResponse.json({ ok: false, error: msg, code: 'UPDATE_HELD_SALE_FAILED' }, { status: 500 });
  }
}

export async function DELETE(
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

  const db = getInitializedDatabase();
  const deleted = HeldSalesRepository.delete(db, session.businessId, id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: `Held sale "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true, id });
}
