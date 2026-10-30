/**
 * POST /api/license/verify
 *
 * Online heartbeat verification endpoint.
 * POS terminals submit their current activation details when internet is available
 * to refresh grace periods and check for plan renewals or revocations.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { verifyLicense, LicenseError } from '@/lib/licensing/licenseService';
import { getLicenseServerPrivateKey, isProductionEnvironment } from '@/lib/licensing/serverKey';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { verifyLicenseTurso } from '@/lib/licensing/tursoRepository';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    licenseKey?: string;
    deviceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const { licenseKey, deviceId } = body;

  if (!licenseKey?.trim() || !deviceId?.trim()) {
    return NextResponse.json({ ok: false, error: 'License key and device ID are required.', code: 'INVALID_INPUT' }, { status: 400 });
  }

  try {
    const privateKey = getLicenseServerPrivateKey();
    const ip = req.headers.get('x-forwarded-for') || undefined;

    let result: { signedPayload: any; signature: string; status: any };

    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      result = await verifyLicenseTurso(client, licenseKey, deviceId, privateKey, ip);
    } else {
      const db = getLicenseDatabase();
      result = verifyLicense(db, licenseKey, deviceId, privateKey, ip);
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      signedPayload: result.signedPayload,
      signature: result.signature,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal license verification error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
