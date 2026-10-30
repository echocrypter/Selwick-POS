/**
 * POST /api/migration/import
 *
 * Ingests a validated LocalStorage payload or references a durable backup file,
 * executing transactional migration into SQLite.
 * Strictly requires active Owner authentication and localhost origin.
 */

import { NextRequest, NextResponse } from 'next/server.js';
import { getInitializedDatabase } from '../../../../lib/db/connection.ts';
import {
  requireRole,
  requireBusinessScope,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '../../../../lib/auth/authorization.ts';
import {
  migrateLocalStorageToSqlite,
  MigrationError,
  type MigrationOptions,
} from '../../../../lib/migration/migrationEngine.ts';
import { readBackupFile, verifyBackupIntegrity, BackupError } from '../../../../lib/migration/backup.ts';

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
    backupId?: string;
    filename?: string;
    payload?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const targetBusinessId = body.businessId || session.businessId;

  // Prevent cross-business tampering
  try {
    requireBusinessScope(req, targetBusinessId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 4. Require Durable Verified Backup Before Migration (FINDING-M4-04)
  if (!body.backupId && !body.filename) {
    return NextResponse.json({
      ok: false,
      error: 'Pre-migration backup required: an integrity-verified backup must be exported and registered in the ledger before initiating migration.',
      code: 'BACKUP_REQUIRED',
    }, { status: 400 });
  }

  const db = getInitializedDatabase();

  // Verify backup against ledger and enforce business scope
  let integrity;
  try {
    integrity = verifyBackupIntegrity(db, { backupId: body.backupId, filename: body.filename });
  } catch (err: unknown) {
    if (err instanceof BackupError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to verify backup.', code: 'BACKUP_VERIFY_ERROR' }, { status: 400 });
  }

  if (!integrity.verified) {
    return NextResponse.json({
      ok: false,
      error: `Backup integrity check failed: ${integrity.error || 'SHA-256 hash mismatch or missing file.'}`,
      code: 'BACKUP_INTEGRITY_MISMATCH',
    }, { status: 400 });
  }

  if (integrity.businessId && integrity.businessId !== targetBusinessId) {
    return NextResponse.json({
      ok: false,
      error: `Backup business ID (${integrity.businessId}) does not match session business ID (${targetBusinessId}).`,
      code: 'BUSINESS_MISMATCH',
    }, { status: 403 });
  }

  // Read validated backup file content
  let migrationPayload: unknown;
  try {
    const fileData = readBackupFile(integrity.filename);
    migrationPayload = JSON.parse(fileData.content);
  } catch (err: unknown) {
    if (err instanceof BackupError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'Backup content is not valid JSON.', code: 'CORRUPT_BACKUP' }, { status: 400 });
  }

  // 5. Execute Migration with Forced Strict Mode (FINDING-M4-03)
  try {
    const report = migrateLocalStorageToSqlite(db, migrationPayload, {
      strict: true,
      quarantineMalformed: false,
    });

    return NextResponse.json({
      ok: true,
      report,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof MigrationError) {
      return NextResponse.json({
        ok: false,
        error: err.message,
        code: err.code,
        quarantined: err.quarantined,
      }, { status: 422 });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal migration error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
