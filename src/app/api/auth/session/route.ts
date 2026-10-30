/**
 * GET /api/auth/session
 *
 * Returns the current authenticated session details without re-authentication.
 * Used by the client to re-hydrate the UI after page reload or Electron restart.
 *
 * Response (200) – authenticated:
 *   {
 *     ok: true;
 *     userId: string;
 *     businessId: string;
 *     role: 'owner' | 'manager' | 'cashier';
 *     name: string;
 *     expiresAt: string;  // ISO-8601
 *   }
 *
 * Response (401) – not authenticated:
 *   { ok: false; code: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { SESSION_COOKIE_NAME, verifySession, maybeRefreshSession } from '@/lib/auth/sessions';
import { assertLocalhostOrigin, AuthError, authErrorStatus } from '@/lib/auth/authorization';

interface UserNameRow {
  name: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Origin guard
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

  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) {
    return NextResponse.json({ ok: false, code: 'MISSING_TOKEN' }, { status: 401 });
  }

  const db = getInitializedDatabase();
  const session = verifySession(db, rawToken);

  if (!session) {
    const response = NextResponse.json({ ok: false, code: 'EXPIRED_SESSION' }, { status: 401 });
    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    return response;
  }

  // Opportunistically refresh nearing-expiry sessions
  const expiresAt = maybeRefreshSession(db, session.sessionId, session.expiresAt);

  // Fetch current display name from users table
  const userRow = db.prepare('SELECT name FROM users WHERE id = ? LIMIT 1').get(session.userId) as UserNameRow | undefined;

  return NextResponse.json({
    ok: true,
    userId: session.userId,
    businessId: session.businessId,
    role: session.role,
    name: userRow?.name ?? 'Unknown',
    expiresAt,
  });
}
