/**
 * POST /api/pos/checkout
 *
 * Authenticated, atomic SQLite checkout endpoint.
 * Protected by session authentication, business isolation, and origin checks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { executeCheckout } from '@/lib/pos/checkoutEngine';
import { PosError } from '@/lib/pos/errors';
import { MoneyError } from '@/lib/money';
import { type CheckoutRequest } from '@/lib/pos/types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Origin & CSRF Guard
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: authErrorStatus(e) },
      );
    }
    throw e;
  }

  // 2. Role Authorization (Cashier, Manager, Owner)
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: authErrorStatus(e) },
      );
    }
    throw e;
  }

  // 3. Parse Request Body
  let body: CheckoutRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  // Extract Idempotency Key from header or body
  const headerIdempotencyKey = req.headers.get('idempotency-key');
  const idempotencyKey = (headerIdempotencyKey || body.idempotencyKey || '').trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Checkout requires a valid, client-generated idempotency key (header "Idempotency-Key" or field "idempotencyKey").',
        code: 'MISSING_IDEMPOTENCY_KEY',
      },
      { status: 400 },
    );
  }

  const checkoutPayload: CheckoutRequest = {
    ...body,
    idempotencyKey,
  };

  // 4. Execute Checkout Transaction
  const db = getInitializedDatabase();
  try {
    const result = executeCheckout(db, session, checkoutPayload);
    const statusCode = result.idempotentReplay ? 200 : 201;

    return NextResponse.json(
      { ok: true, data: result },
      { status: statusCode },
    );
  } catch (err: unknown) {
    if (err instanceof PosError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code, details: err.details },
        { status: err.status },
      );
    }

    if (err instanceof MoneyError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: 400 },
      );
    }

    const message = err instanceof Error ? err.message : 'Unknown checkout error.';
    return NextResponse.json(
      { ok: false, error: message, code: 'CHECKOUT_FAILED' },
      { status: 500 },
    );
  }
}
