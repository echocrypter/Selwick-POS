/**
 * PUT /api/pos/categories/reorder - Reorder categories (Manager/Owner only)
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

export async function PUT(req: NextRequest): Promise<NextResponse> {
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

  let body: { orderedIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'orderedIds array of category IDs is required.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const db = getInitializedDatabase();
  try {
    const updated = CategoryRepository.reorder(db, session.businessId, body.orderedIds);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reorder categories.';
    return NextResponse.json({ ok: false, error: msg, code: 'REORDER_FAILED' }, { status: 500 });
  }
}
