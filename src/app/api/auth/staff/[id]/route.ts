/**
 * DELETE /api/auth/staff/[id]
 * Owner/manager can remove staff in the same business. Last owner cannot be removed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { AuthError, authErrorStatus, assertLocalhostOrigin, requireRole } from '@/lib/auth/authorization';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let session;
  try {
    session = requireRole(req, ['owner', 'manager']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const target = db.prepare(`
    SELECT id, role, business_id FROM users WHERE id = ? AND business_id = ?
  `).get(id, session.businessId) as { id: string; role: string; business_id: string } | undefined;

  if (!target) {
    return NextResponse.json({ ok: false, error: 'Staff member not found.', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (target.id === session.userId) {
    return NextResponse.json({ ok: false, error: 'You cannot remove your own account.', code: 'FORBIDDEN' }, { status: 403 });
  }
  if (target.role === 'owner' && session.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only an owner can remove another owner.', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
  }
  if (session.role === 'manager' && target.role !== 'cashier') {
    return NextResponse.json({ ok: false, error: 'Managers can only remove cashiers.', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
  }
  if (target.role === 'owner') {
    const owners = db.prepare(`
      SELECT COUNT(*) as c FROM users WHERE business_id = ? AND role = 'owner'
    `).get(session.businessId) as { c: number };
    if (Number(owners?.c || 0) <= 1) {
      return NextResponse.json({ ok: false, error: 'Cannot remove the last owner.', code: 'LAST_OWNER' }, { status: 409 });
    }
  }

  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ? AND business_id = ?').run(id, session.businessId);
  return NextResponse.json({ ok: true, deleted: true });
}
