/**
 * POST /api/migration/reverse-export
 *
 * Generates an emergency recovery export bundle in legacy LocalStorage format from SQLite.
 * Strictly requires active Owner authentication and localhost origin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  requireBusinessScope,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { exportSqliteToLocalStorage } from '@/lib/migration/reverseExport';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Origin Guard
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 2. Owner-level Authorization
  let session;
  try {
    session = requireRole(req, ['owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 3. Parse Request Body
  let body: { businessId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is acceptable; defaults to session.businessId
  }

  const targetBusinessId = body.businessId || session.businessId;

  try {
    requireBusinessScope(req, targetBusinessId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 4. Generate Reverse Export Bundle
  try {
    const db = getInitializedDatabase();
    const origin = req.nextUrl?.origin || 'http://127.0.0.1:3456';
    const report = exportSqliteToLocalStorage(db, targetBusinessId, { origin });

    return NextResponse.json({
      ok: true,
      report,
    }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal reverse-export error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
