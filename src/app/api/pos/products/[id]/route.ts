/**
 * GET    /api/pos/products/[id] - Get product details
 * PUT    /api/pos/products/[id] - Update product (Manager/Owner only)
 * DELETE /api/pos/products/[id] - Delete product if unreferenced by sales (Manager/Owner only)
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
import { ValidationError, ConflictError, NotFoundError } from '@/lib/db/repositories/errors';

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
  const row = ProductRepository.findById(db, session.businessId, id);
  if (!row) {
    return NextResponse.json({ ok: false, error: `Product "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: toDomainProduct(row) });
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
    const updated = ProductRepository.update(db, session.businessId, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      sku: typeof body.sku === 'string' ? body.sku : undefined,
      barcode: typeof body.barcode === 'string' ? body.barcode : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      priceCents: typeof body.priceCents === 'number' ? body.priceCents : undefined,
      price: typeof body.price === 'number' ? body.price : undefined,
      costPriceCents: typeof body.costPriceCents === 'number' ? body.costPriceCents : undefined,
      costPrice: typeof body.costPrice === 'number' ? body.costPrice : undefined,
      stock: typeof body.stock === 'number' ? body.stock : undefined,
      minStockAlert: typeof body.minStockAlert === 'number' ? body.minStockAlert : undefined,
      description: body.description !== undefined ? (typeof body.description === 'string' ? body.description : null) : undefined,
      badge: body.badge !== undefined ? (typeof body.badge === 'string' ? body.badge : null) : undefined,
      iconType: body.iconType as any,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainProduct(updated) });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'CONFLICT' }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to update product.';
    return NextResponse.json({ ok: false, error: msg, code: 'UPDATE_PRODUCT_FAILED' }, { status: 500 });
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
  const existing = ProductRepository.findById(db, session.businessId, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: `Product "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  // Stock Invariant: Do not delete products referenced by historical sales
  const salesRef = db.prepare(`
    SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?
  `).get(id) as { count: number } | undefined;

  if (salesRef && salesRef.count > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot delete product "${id}" because it is referenced in ${salesRef.count} historical sale items. Please archive the product instead.`,
        code: 'PRODUCT_REFERENCED_IN_SALES',
      },
      { status: 409 }
    );
  }

  const success = ProductRepository.delete(db, session.businessId, id);
  return NextResponse.json({ ok: true, deleted: success, id });
}
