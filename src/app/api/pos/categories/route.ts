/**
 * GET  /api/pos/categories - List categories for business
 * POST /api/pos/categories - Create category (Manager/Owner only)
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

  const db = getInitializedDatabase();
  const categories = CategoryRepository.list(db, session.businessId);

  return NextResponse.json({ ok: true, data: categories, total: categories.length });
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ ok: false, error: 'Category name is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const db = getInitializedDatabase();
  try {
    const created = CategoryRepository.create(db, session.businessId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      name,
      displayOrder: typeof body.displayOrder === 'number' ? body.displayOrder : 0,
    });

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'CONFLICT' }, { status: 409 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to create category.';
    return NextResponse.json({ ok: false, error: msg, code: 'CREATE_CATEGORY_FAILED' }, { status: 500 });
  }
}
