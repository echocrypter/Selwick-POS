/**
 * GET   /api/license/admin/licenses/[id]
 * PUT   /api/license/admin/licenses/[id]
 * PATCH /api/license/admin/licenses/[id]
 *
 * Admin API to retrieve full license details, activated devices, and audit logs,
 * or update status (active, suspended, revoked), renewal, or device limits.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import {
  getLicenseDetails,
  setLicenseStatus,
  renewLicense,
  setMaxDevices,
  generateCustomerMessage,
  LicenseError,
} from '@/lib/licensing/licenseService';
import { requireAdminAuth } from '@/lib/licensing/adminAuth';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import {
  getLicenseDetailsTurso,
  setLicenseStatusTurso,
  renewLicenseTurso,
  setMaxDevicesTurso,
} from '@/lib/licensing/tursoRepository';
import { isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    let license;
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      license = await getLicenseDetailsTurso(client, id);
    } else {
      const db = getLicenseDatabase();
      license = getLicenseDetails(db, id);
    }

    if (!license) {
      return NextResponse.json({ ok: false, error: 'License not found.' }, { status: 404 });
    }
    const customerMessage = generateCustomerMessage(license);
    return NextResponse.json({ ok: true, license, customerMessage }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Database error.' },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: {
    action?: 'set_status' | 'renew' | 'set_max_devices';
    status?: 'active' | 'suspended' | 'revoked' | 'expired';
    expiresAt?: string | null;
    maxDevices?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const isProd = isProductionEnvironment();
    const useTurso = isTursoConfigured() || isProd;

    if (useTurso) {
      const client = getTursoClient();

      if (body.action === 'set_status' && body.status) {
        await setLicenseStatusTurso(client, id, body.status, auth.actor);
        return NextResponse.json({ ok: true, message: `Status updated to ${body.status}` });
      }

      if (body.action === 'renew') {
        const renewed = await renewLicenseTurso(client, id, body.expiresAt, auth.actor);
        return NextResponse.json({ ok: true, message: 'License renewed successfully.', expiresAt: renewed.expiresAt });
      }

      if (body.action === 'set_max_devices' && typeof body.maxDevices === 'number') {
        await setMaxDevicesTurso(client, id, body.maxDevices, auth.actor);
        return NextResponse.json({ ok: true, message: `Max devices updated to ${body.maxDevices}` });
      }
    } else {
      const db = getLicenseDatabase();

      if (body.action === 'set_status' && body.status) {
        setLicenseStatus(db, id, body.status, auth.actor);
        return NextResponse.json({ ok: true, message: `Status updated to ${body.status}` });
      }

      if (body.action === 'renew') {
        const renewed = renewLicense(db, id, body.expiresAt, auth.actor);
        return NextResponse.json({ ok: true, message: 'License renewed successfully.', expiresAt: renewed.expiresAt });
      }

      if (body.action === 'set_max_devices' && typeof body.maxDevices === 'number') {
        setMaxDevices(db, id, body.maxDevices, auth.actor);
        return NextResponse.json({ ok: true, message: `Max devices updated to ${body.maxDevices}` });
      }
    }

    return NextResponse.json({ ok: false, error: 'Invalid update action.' }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error updating license.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return PUT(req, context);
}
