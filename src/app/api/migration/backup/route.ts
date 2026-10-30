/**
 * POST /api/migration/backup
 *
 * Exports a durable LocalStorage backup to the server filesystem with SHA-256 verification.
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
import { createDurableBackup, BackupError } from '@/lib/migration/backup';

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
  let body: {
    businessId?: string;
    payload?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const targetBusinessId = body.businessId || session.businessId;

  // Prevent cross-business access
  try {
    requireBusinessScope(req, targetBusinessId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  if (!body.payload) {
    return NextResponse.json({ ok: false, error: 'Missing backup payload.', code: 'MISSING_PAYLOAD' }, { status: 400 });
  }

  // 4. Create Durable Backup
  try {
    const db = getInitializedDatabase();
    const result = createDurableBackup(db, targetBusinessId, body.payload);

    return NextResponse.json({
      ok: true,
      backup: result,
    }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof BackupError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal backup error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
