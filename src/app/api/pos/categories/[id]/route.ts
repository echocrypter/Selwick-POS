/**
 * PUT    /api/pos/categories/[id] - Update category (Manager/Owner only)
 * DELETE /api/pos/categories/[id] - Delete category (Manager/Owner only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { CategoryRepository } from '@/lib/db/repositories/categoryRepository';
import { ValidationError, ConflictError, NotFoundError } from '@/lib/db/repositories/errors';

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
    session = requireRole(req, ['manager', 'owner']);
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
    const updated = CategoryRepository.update(db, session.businessId, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      displayOrder: typeof body.displayOrder === 'number' ? body.displayOrder : undefined,
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'CONFLICT' }, { status: 409 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to update category.';
    return NextResponse.json({ ok: false, error: msg, code: 'UPDATE_CATEGORY_FAILED' }, { status: 500 });
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
    session = requireRole(req, ['manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const deleted = CategoryRepository.delete(db, session.businessId, id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: `Category "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true, id });
}
