/**
 * GET /api/license/admin/auth/session
 *
 * Checks if caller has active admin authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/licensing/adminAuth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = verifyAdminRequest(req);
  if (!result.authorized) {
    return NextResponse.json({ ok: true, authenticated: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true, authenticated: true, actor: result.actor }, { status: 200 });
}

