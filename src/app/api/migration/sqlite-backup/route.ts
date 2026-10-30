/**
 * POST /api/migration/sqlite-backup
 * GET  /api/migration/sqlite-backup
 *
 * Server-authoritative SQLite snapshot backup engine (Phase 3).
 * Reads directly from SQLite (no client-provided payload) and produces a
 * cryptographically verified, versioned backup file.
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
import { createSqliteBackup, SqliteBackupError } from '@/lib/migration/sqliteBackup';

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

  // 3. Parse optional body for explicit businessId
  let targetBusinessId = session.businessId;
  try {
    const body = await req.json();
    if (body?.businessId) {
      targetBusinessId = body.businessId;
    }
  } catch {
    // Body is optional; fallback to session.businessId
  }

  try {
    requireBusinessScope(req, targetBusinessId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 4. Create authoritative SQLite backup
  try {
    const db = getInitializedDatabase();
    const result = createSqliteBackup(db, targetBusinessId);

    return NextResponse.json({
      ok: true,
      backup: result,
    }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof SqliteBackupError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal SQLite backup error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    assertLocalhostOrigin(req);
    const session = requireRole(req, ['owner', 'manager']);
    const db = getInitializedDatabase();

    const backups = db.prepare(`
      SELECT id, business_id, filename, sha256_hash, total_records, created_at
      FROM durable_backup_ledger
      WHERE business_id = ?
      ORDER BY created_at DESC
    `).all(session.businessId);

    return NextResponse.json({
      ok: true,
      backups,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    return NextResponse.json({ ok: false, error: 'Failed to retrieve backups.' }, { status: 500 });
  }
}

