/**
 * POST /api/migration/verify-backup
 *
 * Verifies backup file integrity against the durable ledger and validates restore readiness.
 * Strictly requires active Owner authentication and localhost origin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { verifyBackupIntegrity, BackupError } from '@/lib/migration/backup';
import { validateBackupForRestore } from '@/lib/migration/restoreValidator';

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
    filename?: string;
    backupId?: string;
    rawJson?: string;
    expectedSha256?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const db = getInitializedDatabase();

  try {
    let integrityResult;
    if (body.filename || body.backupId) {
      integrityResult = verifyBackupIntegrity(db, {
        filename: body.filename,
        backupId: body.backupId,
      });

      // Prevent cross-business metadata disclosure (FINDING-M4-06)
      if (integrityResult.businessId && integrityResult.businessId !== session.businessId) {
        return NextResponse.json({
          ok: false,
          error: `Access denied: backup belongs to business "${integrityResult.businessId}", not authenticated business "${session.businessId}".`,
          code: 'BUSINESS_MISMATCH',
        }, { status: 403 });
      }
    }

    const validationResult = validateBackupForRestore({
      filename: body.filename,
      rawJson: body.rawJson,
      expectedSha256: body.expectedSha256,
    }, db);

    // Prevent cross-business metadata disclosure from raw payload
    if (validationResult.businessId && validationResult.businessId !== 'unknown' && validationResult.businessId !== session.businessId) {
      return NextResponse.json({
        ok: false,
        error: `Access denied: backup payload business ID "${validationResult.businessId}" does not match authenticated business "${session.businessId}".`,
        code: 'BUSINESS_MISMATCH',
      }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      integrity: integrityResult,
      validation: validationResult,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof BackupError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal verification error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
