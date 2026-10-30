/**
 * POST /api/pos/license/activate
 *
 * Client-side POS endpoint to activate a commercial license.
 * Connects to the License Server, receives the Ed25519-signed payload,
 * cryptographically verifies it with the public key, and persists it locally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeviceId, getDeviceName } from '@/lib/licensing/device';
import { verifyLicenseSignature } from '@/lib/licensing/keys';
import { saveLocalActivation, evaluateLicenseState, validateLicenseServerUrl } from '@/lib/licensing/posLicenseClient';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { activateLicense, LicenseError } from '@/lib/licensing/licenseService';
import { getLicenseServerPrivateKey, isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    licenseKey?: string;
    serverUrl?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const { licenseKey, serverUrl } = body;

  if (!licenseKey?.trim()) {
    return NextResponse.json({ ok: false, error: 'License key is required.', code: 'MISSING_KEY' }, { status: 400 });
  }

  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  const isProd = isProductionEnvironment();
  const rawServerUrl = (serverUrl && serverUrl.trim()) || process.env.SELWICK_LICENSE_SERVER_URL;

  const urlValidation = validateLicenseServerUrl(rawServerUrl, isProd);
  if (!urlValidation.valid) {
    const status = urlValidation.code === 'MISSING_LICENSE_SERVER_URL' ? 500 : 400;
    return NextResponse.json({
      ok: false,
      error: urlValidation.error,
      code: urlValidation.code,
    }, { status });
  }

  const effectiveServerUrl = urlValidation.url;

  try {
    let signedPayload;
    let signature;

    if (effectiveServerUrl) {
      const target = `${effectiveServerUrl}/api/license/activate`;
      let response: Response;
      try {
        response = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey, deviceId, deviceName }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        return NextResponse.json({
          ok: false,
          error: 'Could not connect to license server. Please verify your internet connection and try again.',
          code: 'NETWORK_ERROR',
        }, { status: 503 });
      }

      const resData = await response.json();
      if (!response.ok || !resData.ok) {
        return NextResponse.json({
          ok: false,
          error: resData.error || 'Server rejected activation.',
          code: resData.code || 'ACTIVATION_REJECTED',
        }, { status: response.status });
      }

      signedPayload = resData.signedPayload;
      signature = resData.signature;
    } else {
      // Direct local embedded license server evaluation (development & automated test suites only)
      const db = getLicenseDatabase();
      const privateKey = getLicenseServerPrivateKey();
      const result = activateLicense(db, licenseKey, deviceId, deviceName, privateKey);
      signedPayload = result.signedPayload;
      signature = result.signature;
    }

    // 1. Client-side cryptographic verification with embedded public key
    const isAuthentic = verifyLicenseSignature(signedPayload, signature);
    if (!isAuthentic) {
      return NextResponse.json({
        ok: false,
        error: 'Security alert: Returned license payload failed cryptographic verification.',
        code: 'SIGNATURE_INVALID',
      }, { status: 400 });
    }

    // 2. Persist locally
    saveLocalActivation(signedPayload, signature);

    // 3. Return updated evaluated state
    const state = evaluateLicenseState();
    return NextResponse.json({ ok: true, state }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Activation error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
