/**
 * POST /api/auth/login
 *
 * Authenticates a staff member using their name + PIN.
 * On success, sets an HttpOnly session cookie and returns the session payload.
 *
 * Request body (JSON):
 *   { name: string; pin: string; businessId: string }
 *
 * Response (200):
 *   { ok: true; role: string; userId: string; businessId: string; name: string }
 *
 * Response (401):
 *   { ok: false; error: string; code: string }
 *
 * Response (429):
 *   { ok: false; error: string; retryAfterSeconds: number }
 *
 * Security:
 *   - Persistent SQLite rate limiting: 5 attempts / 15 min → 15-min lockout.
 *   - Constant-time PIN comparison (timingSafeEqual with unconditional safeCompare).
 *   - Session token is 256-bit random, only its SHA-256 hash is stored.
 *   - Cookie is HttpOnly, SameSite=Strict, Path=/, host-scoped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { hashPin, safeCompare } from '@/lib/auth/crypto';
import {
  isLockedOut,
  lockoutSecondsRemaining,
  recordFailure,
  clearFailures,
} from '@/lib/auth/rateLimit';
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  type UserRole,
} from '@/lib/auth/sessions';
import { AuthError, assertLocalhostOrigin, authErrorStatus } from '@/lib/auth/authorization';

interface UserRow {
  id: string;
  name: string;
  role: string;
  salt: string;
  hash: string;
  business_id: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Origin guard
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

  // 2. Parse body
  let body: { name?: string; pin?: string; businessId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const name = (body.name ?? '').trim();
  const pin = (body.pin ?? '').trim();
  const businessId = (body.businessId ?? '').trim();

  if (!name || !pin || !businessId) {
    return NextResponse.json(
      { ok: false, error: 'name, pin, and businessId are required.', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const db = getInitializedDatabase();

  // 3. Persistent SQLite rate-limit check (FINDING-04)
  if (isLockedOut(businessId, name, db)) {
    const retryAfterSeconds = lockoutSecondsRemaining(businessId, name, db);
    return NextResponse.json(
      {
        ok: false,
        error: `Too many failed login attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  // 4. Look up user by name + businessId (case-insensitive name match)
  const userRow = db.prepare(`
    SELECT id, name, role, salt, hash, business_id
    FROM users
    WHERE business_id = ? AND lower(name) = lower(?)
    LIMIT 1
  `).get(businessId, name) as UserRow | undefined;

  // 5. Verify PIN – constant-time defense (FINDING-05 & FINDING-10)
  // Always compute PBKDF2 and always execute safeCompare unconditionally
  const saltToUse = userRow?.salt ?? 'deadbeefdeadbeef';
  const computed = await hashPin(pin, saltToUse);
  const storedHash = userRow?.hash ?? '';
  const pinMatch = safeCompare(computed, storedHash);

  if (!userRow || !pinMatch) {
    recordFailure(businessId, name, db);
    return NextResponse.json(
      { ok: false, error: 'Invalid name or PIN.', code: 'INVALID_CREDENTIALS' },
      { status: 401 },
    );
  }

  // 6. Create session & reset persistent failure counter
  clearFailures(businessId, name, db);
  const { rawToken, payload } = createSession(
    db,
    userRow.id,
    userRow.business_id,
    userRow.role as UserRole,
  );

  // 7. Build response with HttpOnly cookie
  const response = NextResponse.json({
    ok: true,
    userId: payload.userId,
    businessId: payload.businessId,
    role: payload.role,
    name: userRow.name,
    expiresAt: payload.expiresAt,
  });

  response.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return response;
}
