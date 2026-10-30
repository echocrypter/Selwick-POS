/**
 * POST /api/auth/logout
 *
 * Revokes the current session and clears the session cookie.
 *
 * Request: no body needed (session is read from cookie).
 *
 * Response (200):
 *   { ok: true }
 *
 * Always returns 200 even if no session exists (idempotent logout).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  SESSION_COOKIE_NAME,
  verifySession,
  revokeSession,
} from '@/lib/auth/sessions';
import { assertLocalhostOrigin, AuthError, authErrorStatus } from '@/lib/auth/authorization';

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  if (rawToken) {
    const db = getInitializedDatabase();
    const session = verifySession(db, rawToken);
    if (session) {
      revokeSession(db, session.sessionId);
    }
  }

  // Clear cookie regardless of whether a session existed
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });

  return response;
}
