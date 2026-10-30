/**
 * DELETE /api/license/admin/activations/[id]
 *
 * Deactivates a device activation, freeing up device capacity on the license.
 * Logs an administrative audit record.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { deactivateActivationById, LicenseError } from '@/lib/licensing/licenseService';
import { requireAdminAuth } from '@/lib/licensing/adminAuth';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { deactivateActivationByIdTurso } from '@/lib/licensing/tursoRepository';
import { isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      await deactivateActivationByIdTurso(client, id, auth.actor);
    } else {
      const db = getLicenseDatabase();
      deactivateActivationById(db, id, auth.actor);
    }
    return NextResponse.json({ ok: true, message: 'Device deactivated successfully.' }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Database error.' },
      { status: 500 }
    );
  }
}
