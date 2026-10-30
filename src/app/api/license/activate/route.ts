/**
 * POST /api/license/activate
 *
 * Public License Server activation endpoint.
 * POS terminals submit their license key and device identifier here.
 * Returns an Ed25519-signed license payload upon successful validation.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { activateLicense, LicenseError } from '@/lib/licensing/licenseService';
import { getLicenseServerPrivateKey, isProductionEnvironment } from '@/lib/licensing/serverKey';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { activateLicenseTurso } from '@/lib/licensing/tursoRepository';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    licenseKey?: string;
    deviceId?: string;
    deviceName?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const { licenseKey, deviceId, deviceName } = body;

  if (!licenseKey?.trim()) {
    return NextResponse.json({ ok: false, error: 'License key is required.', code: 'MISSING_KEY' }, { status: 400 });
  }
  if (!deviceId?.trim()) {
    return NextResponse.json({ ok: false, error: 'Device identifier is required.', code: 'MISSING_DEVICE' }, { status: 400 });
  }

  try {
    const privateKey = getLicenseServerPrivateKey();
    const ip = req.headers.get('x-forwarded-for') || undefined;

    let result: { signedPayload: any; signature: string };

    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      result = await activateLicenseTurso(client, licenseKey, deviceId, deviceName, privateKey, ip);
    } else {
      const db = getLicenseDatabase();
      result = activateLicense(db, licenseKey, deviceId, deviceName, privateKey, ip);
    }

    return NextResponse.json({
      ok: true,
      signedPayload: result.signedPayload,
      signature: result.signature,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal licensing server error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
