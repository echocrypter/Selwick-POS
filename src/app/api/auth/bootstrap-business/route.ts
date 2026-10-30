/**
 * POST /api/auth/bootstrap-business
 *
 * First-run owner signup. Creates the SQLite business + owner and sets a session cookie.
 * Rejected if the business already has users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { AuthError, assertLocalhostOrigin, authErrorStatus } from '@/lib/auth/authorization';
import { bootstrapBusiness, BootstrapError } from '@/lib/auth/bootstrapBusiness';
import { createSession, SESSION_COOKIE_NAME, SESSION_TTL_MS } from '@/lib/auth/sessions';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let body: {
    businessId?: string;
    businessName?: string;
    ownerName?: string;
    name?: string;
    pin?: string;
    address?: string;
    phone?: string;
    businessType?: string;
    ownerId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const db = getInitializedDatabase();
  try {
    const result = await bootstrapBusiness(db, {
      businessId: body.businessId,
      businessName: body.businessName || '',
      ownerName: body.ownerName || body.name || '',
      pin: body.pin || '',
      address: body.address,
      phone: body.phone,
      businessType: body.businessType,
      ownerId: body.ownerId,
    });

    const { rawToken, payload } = createSession(db, result.userId, result.businessId, 'owner');
    const response = NextResponse.json({
      ok: true,
      created: true,
      userId: result.userId,
      businessId: result.businessId,
      role: result.role,
      name: result.name,
      expiresAt: payload.expiresAt,
    }, { status: 201 });

    response.cookies.set(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return response;
  } catch (err) {
    if (err instanceof BootstrapError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Bootstrap failed.';
    return NextResponse.json({ ok: false, error: message, code: 'BOOTSTRAP_FAILED' }, { status: 500 });
  }
}
