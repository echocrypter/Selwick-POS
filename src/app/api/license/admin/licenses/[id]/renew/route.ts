/**
 * POST /api/license/admin/licenses/[id]/renew
 *
 * Dedicated endpoint to renew or extend a commercial license.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { renewLicense, LicenseError } from '@/lib/licensing/licenseService';
import { requireAdminAuth } from '@/lib/licensing/adminAuth';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { renewLicenseTurso } from '@/lib/licensing/tursoRepository';
import { isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: { expiresAt?: string | null; durationDays?: number } = {};
  try {
    body = await req.json();
  } catch {}

  try {
    let result: { expiresAt: string | null };
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      result = await renewLicenseTurso(client, id, body.expiresAt, auth.actor);
    } else {
      const db = getLicenseDatabase();
      result = renewLicense(db, id, body.expiresAt, auth.actor);
    }

    return NextResponse.json(
      { ok: true, message: 'License renewed successfully.', expiresAt: result.expiresAt },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error renewing license.' },
      { status: 500 }
    );
  }
}
