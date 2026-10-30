/**
 * GET /api/auth/directory
 *
 * Local installation account index for the sign-in screen.
 * Returns names and business IDs only — never hashes, salts, or PINs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import { AuthError, assertLocalhostOrigin, authErrorStatus } from '@/lib/auth/authorization';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const rows = db.prepare(`
    SELECT u.id, u.name, u.role, u.business_id, b.name as business_name
    FROM users u
    JOIN businesses b ON b.id = u.business_id
    ORDER BY lower(u.name) ASC
  `).all() as Array<{
    id: string;
    name: string;
    role: 'owner' | 'manager' | 'cashier';
    business_id: string;
    business_name: string;
  }>;

  return NextResponse.json({
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      businessId: row.business_id,
      businessName: row.business_name,
    })),
  });
}
