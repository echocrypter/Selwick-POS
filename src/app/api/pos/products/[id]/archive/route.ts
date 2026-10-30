/**
 * POST /api/pos/products/[id]/archive - Archive a product (Manager/Owner only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { ProductRepository, toDomainProduct } from '@/lib/db/repositories/productRepository';
import { NotFoundError } from '@/lib/db/repositories/errors';

export async function POST(
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
  try {
    const updated = ProductRepository.update(db, session.businessId, id, { isActive: false });
    return NextResponse.json({ ok: true, data: toDomainProduct(updated), archived: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to archive product.';
    return NextResponse.json({ ok: false, error: msg, code: 'ARCHIVE_PRODUCT_FAILED' }, { status: 500 });
  }
}
