/**
 * POST /api/migration/sqlite-restore
 *
 * Server-authoritative SQLite disaster recovery restore endpoint (Phase 3).
 * Accepts either a backup payload or a filename from the local durable backup directory.
 * Strictly restricted to authenticated Owners and localhost origin.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  requireBusinessScope,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { getBackupDirectory, sanitizeBackupFilename } from '@/lib/migration/backup';
import { restoreSqliteBackup, RestoreError } from '@/lib/migration/sqliteRestore';

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

  // 2. Owner-only authorization
  let session;
  try {
    session = requireRole(req, ['owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 3. Parse Body
  let body: {
    businessId?: string;
    filename?: string;
    payload?: unknown;
    allowDifferentBusinessId?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request body.', code: 'BAD_REQUEST' }, { status: 400 });
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

  // 4. Resolve Payload
  let restorePayload: unknown = body.payload;

  if (!restorePayload && body.filename) {
    try {
      const sanitized = sanitizeBackupFilename(body.filename);
      const backupDir = getBackupDirectory();
      const filePath = path.join(backupDir, sanitized);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ ok: false, error: `Backup file "${sanitized}" not found.`, code: 'FILE_NOT_FOUND' }, { status: 404 });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      restorePayload = JSON.parse(content);
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to read backup file.',
        code: 'FILE_READ_ERROR',
      }, { status: 400 });
    }
  }

  if (!restorePayload) {
    return NextResponse.json({
      ok: false,
      error: 'Either "filename" or "payload" is required for restoration.',
      code: 'MISSING_PAYLOAD',
    }, { status: 400 });
  }

  // 5. Execute Restore
  try {
    const db = getInitializedDatabase();
    const result = restoreSqliteBackup(
      db,
      restorePayload,
      targetBusinessId,
      { allowDifferentBusinessId: !!body.allowDifferentBusinessId }
    );

    return NextResponse.json({
      ok: true,
      restore: result,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof RestoreError) {
      return NextResponse.json({
        ok: false,
        error: err.message,
        code: err.code,
        details: err.details,
      }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal disaster recovery restoration error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}

