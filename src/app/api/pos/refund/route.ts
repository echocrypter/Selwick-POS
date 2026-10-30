/**
 * POST /api/pos/refund
 *
 * Authenticated, atomic SQLite refund endpoint.
 * Restricted to Manager and Owner roles.
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
import { executeRefund } from '@/lib/pos/refundEngine';
import { PosError } from '@/lib/pos/errors';
import { type RefundRequest } from '@/lib/pos/types';

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

  // 2. Role Authorization (Manager, Owner only)
  let session;
  try {
    session = requireRole(req, ['manager', 'owner']);
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
  let body: RefundRequest;
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
  const refundPayload: RefundRequest = {
    ...body,
    idempotencyKey: (headerIdempotencyKey || body.idempotencyKey || '').trim() || undefined,
  };

  // 4. Execute Refund Transaction
  const db = getInitializedDatabase();
  try {
    const result = executeRefund(db, session, refundPayload);

    return NextResponse.json(
      { ok: true, data: result },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof PosError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code, details: err.details },
        { status: err.status },
      );
    }

    const message = err instanceof Error ? err.message : 'Unknown refund error.';
    return NextResponse.json(
      { ok: false, error: message, code: 'REFUND_FAILED' },
      { status: 500 },
    );
  }
}
