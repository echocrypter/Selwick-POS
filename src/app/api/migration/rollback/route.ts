/**
 * POST /api/migration/rollback
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
import { exportSqliteToLocalStorage } from '../../../../lib/migration/reverseExport.ts';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try { assertLocalhostOrigin(req); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  let session;
  try { session = requireRole(req, ['owner']); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  let body: { businessId?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const targetBusinessId = body.businessId || session.businessId;
  try { requireBusinessScope(req, targetBusinessId); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  try {
    const db = getInitializedDatabase();
    const origin = req.nextUrl?.origin || 'http://127.0.0.1:3456';
    const report = exportSqliteToLocalStorage(db, targetBusinessId, { origin });
    db.exec(`CREATE TABLE IF NOT EXISTS migration_activation (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id TEXT NOT NULL, mode TEXT NOT NULL, activated_at TEXT NOT NULL)`);
    db.prepare('INSERT INTO migration_activation (business_id, mode, activated_at) VALUES (?, ?, ?)').run(targetBusinessId, 'localstorage', new Date().toISOString());
    return NextResponse.json({ ok: true, recovered: true, localStorageRestored: true, localStorageRestorePayload: report.payload, report });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Rollback failed.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
