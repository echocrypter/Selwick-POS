/**
 * GET /api/auth/staff
 * Lists staff for the authenticated business. Credentials are never returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { AuthError, authErrorStatus, requireRole } from '@/lib/auth/authorization';

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const rows = db.prepare(`
    SELECT id, name, role, business_id, created_at
    FROM users
    WHERE business_id = ?
    ORDER BY role ASC, lower(name) ASC
  `).all(session.businessId) as Array<{
    id: string;
    name: string;
    role: string;
    business_id: string;
    created_at: string;
  }>;

  return NextResponse.json({
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      businessId: row.business_id,
      createdAt: row.created_at,
    })),
  });
}
