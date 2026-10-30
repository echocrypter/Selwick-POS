/**
 * GET  /api/pos/products - List products for authenticated business
 * POST /api/pos/products - Create a new product (Manager/Owner only)
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
  const category = searchParams.get('category') || undefined;
  const activeOnlyParam = searchParams.get('activeOnly');
  const activeOnly = activeOnlyParam === 'false' || activeOnlyParam === '0' || activeOnlyParam === 'all' ? false : true;

  const db = getInitializedDatabase();
  const rows = ProductRepository.list(db, session.businessId, { search, category, activeOnly });
  const products = rows.map(toDomainProduct);

  return NextResponse.json({ ok: true, data: products, total: products.length });
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

  const db = getInitializedDatabase();
  try {
    const createdRow = ProductRepository.create(db, session.businessId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      name: String(body.name || ''),
      sku: typeof body.sku === 'string' ? body.sku : undefined,
      barcode: typeof body.barcode === 'string' ? body.barcode : undefined,
      category: String(body.category || ''),
      priceCents: typeof body.priceCents === 'number' ? body.priceCents : undefined,
      price: typeof body.price === 'number' ? body.price : undefined,
      costPriceCents: typeof body.costPriceCents === 'number' ? body.costPriceCents : undefined,
      costPrice: typeof body.costPrice === 'number' ? body.costPrice : undefined,
      stock: typeof body.stock === 'number' ? body.stock : 0,
      minStockAlert: typeof body.minStockAlert === 'number' ? body.minStockAlert : 5,
      description: typeof body.description === 'string' ? body.description : undefined,
      badge: typeof body.badge === 'string' ? body.badge : undefined,
      iconType: body.iconType as any,
      isActive: body.isActive !== false,
    });

    return NextResponse.json({ ok: true, data: toDomainProduct(createdRow) }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'CONFLICT' }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to create product.';
    return NextResponse.json({ ok: false, error: msg, code: 'CREATE_PRODUCT_FAILED' }, { status: 500 });
  }
}
