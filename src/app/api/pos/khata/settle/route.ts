/**
 * POST /api/pos/khata/settle
 *
 * Authenticated Khata settlement endpoint.
 * FIFO payment allocation with mandatory business-scoped idempotency key.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { recordKhataSettlement, KhataSettlementRequest } from '@/lib/pos/khataEngine';
import { PosError } from '@/lib/pos/errors';
import { toCents } from '@/lib/money';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Origin & CSRF Guard
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 2. Role Authorization
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 3. Parse JSON Body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  // 4. Extract Idempotency Key
  const headerIdempotencyKey = req.headers.get('idempotency-key');
  const idempotencyKey = String(headerIdempotencyKey || body.idempotencyKey || '').trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Khata settlement requires a valid, client-generated idempotency key (header "Idempotency-Key" or field "idempotencyKey").',
        code: 'MISSING_IDEMPOTENCY_KEY',
      },
      { status: 400 }
    );
  }

  const customerId = String(body.customerId || '').trim();
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'Customer ID is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  let amountCents: number;
  if (typeof body.amountCents === 'number') {
    amountCents = body.amountCents;
  } else if (typeof body.amount === 'number') {
    amountCents = toCents(body.amount, false, 'Settlement amount');
  } else {
    return NextResponse.json({ ok: false, error: 'Settlement amount or amountCents is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim().toLowerCase() : 'cash';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;

  const db = getInitializedDatabase();
  const targetBusinessId = session.businessId;

  // Compute canonical hash of settlement parameters
  const requestHash = crypto
    .createHash('sha256')
    .update(`${targetBusinessId}:${customerId}:${amountCents}:${paymentMethod}`)
    .digest('hex');

  // Check Idempotency Ledger
  const existingKey = db.prepare(`
    SELECT response_code, response_body, request_hash
    FROM idempotency_keys
    WHERE key = ? AND business_id = ?
  `).get(idempotencyKey, targetBusinessId) as {
    response_code: number;
    response_body: string;
    request_hash: string | null;
  } | undefined;

  if (existingKey) {
    if (existingKey.request_hash && existingKey.request_hash !== requestHash) {
      return NextResponse.json(
        {
          ok: false,
          error: `Idempotency conflict: key "${idempotencyKey}" was previously used with different settlement parameters.`,
          code: 'IDEMPOTENCY_CONFLICT',
        },
        { status: 409 }
      );
    }

    try {
      const parsedBody = JSON.parse(existingKey.response_body);
      return NextResponse.json(
        { ...parsedBody, idempotentReplay: true },
        { status: 200 }
      );
    } catch {
      // Re-execute if stored body was malformed
    }
  }

  // Execute Settlement
  try {
    const result = recordKhataSettlement(db, session, {
      businessId: targetBusinessId,
      customerId,
      amountCents,
      paymentMethod,
      notes,
    });

    const responsePayload = {
      ok: true,
      data: result,
      idempotentReplay: false,
    };

    // Store in idempotency ledger
    try {
      db.prepare(`
        INSERT INTO idempotency_keys (key, business_id, endpoint, request_hash, response_code, response_body)
        VALUES (?, ?, '/api/pos/khata/settle', ?, 201, ?)
      `).run(idempotencyKey, targetBusinessId, requestHash, JSON.stringify(responsePayload));
    } catch (keyErr) {
      // Check if race won by concurrent thread
      const raceCheck = db.prepare(`
        SELECT response_body FROM idempotency_keys WHERE key = ? AND business_id = ?
      `).get(idempotencyKey, targetBusinessId) as { response_body: string } | undefined;
      if (raceCheck) {
        return NextResponse.json({ ...JSON.parse(raceCheck.response_body), idempotentReplay: true }, { status: 200 });
      }
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    if (err instanceof PosError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    const msg = err instanceof Error ? err.message : 'Khata settlement failed.';
    return NextResponse.json({ ok: false, error: msg, code: 'SETTLEMENT_FAILED' }, { status: 500 });
  }
}
