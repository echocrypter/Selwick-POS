/**
 * POST /api/pos/license/verify
 *
 * Client-side POS endpoint to verify and refresh active commercial license status online.
 * Connects to the License Server, receives fresh signed payload, verifies Ed25519 signature,
 * and updates local activation state to refresh the offline grace period.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyLicenseSignature } from '@/lib/licensing/keys';
import { loadLocalActivation, saveLocalActivation, clearLocalActivation, evaluateLicenseState, validateLicenseServerUrl } from '@/lib/licensing/posLicenseClient';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { verifyLicense, LicenseError } from '@/lib/licensing/licenseService';
import { getLicenseServerPrivateKey, isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const currentActivation = loadLocalActivation();
  if (!currentActivation || !currentActivation.signedPayload) {
    return NextResponse.json({
      ok: false,
      error: 'No active license found to verify.',
      code: 'NO_ACTIVE_LICENSE',
    }, { status: 400 });
  }

  const { licenseKey, deviceId } = currentActivation.signedPayload;
  const isProd = isProductionEnvironment();

  let body: { serverUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  const rawServerUrl = (body.serverUrl && body.serverUrl.trim()) || process.env.SELWICK_LICENSE_SERVER_URL;
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
      const target = `${effectiveServerUrl}/api/license/verify`;
      let response: Response;
      try {
        response = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey, deviceId }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        // Offline / server unreachable: return current cached state with notification
        const state = evaluateLicenseState();
        return NextResponse.json({
          ok: true,
          offline: true,
          message: 'Server unreachable. Operating in offline mode with cached license.',
          state,
        }, { status: 200 });
      }

      const resData = await response.json();
      if (!response.ok || !resData.ok) {
        // If revoked or suspended or deactivated
        if (resData.code === 'REVOKED' || resData.code === 'SUSPENDED' || resData.code === 'DEVICE_DEACTIVATED') {
          clearLocalActivation();
          const state = evaluateLicenseState();
          return NextResponse.json({
            ok: false,
            error: resData.error || 'License is no longer valid.',
            code: resData.code,
            state,
          }, { status: 403 });
        }

        return NextResponse.json({
          ok: false,
          error: resData.error || 'License verification rejected.',
          code: resData.code || 'VERIFICATION_FAILED',
        }, { status: response.status });
      }

      signedPayload = resData.signedPayload;
      signature = resData.signature;
    } else {
      // Local embedded check (dev / test suites)
      const db = getLicenseDatabase();
      const privateKey = getLicenseServerPrivateKey();
      const result = verifyLicense(db, licenseKey, deviceId, privateKey);
      signedPayload = result.signedPayload;
      signature = result.signature;
    }

    // Cryptographic verification
    const isAuthentic = verifyLicenseSignature(signedPayload, signature);
    if (!isAuthentic) {
      return NextResponse.json({
        ok: false,
        error: 'Security alert: Returned license payload failed cryptographic verification.',
        code: 'SIGNATURE_INVALID',
      }, { status: 400 });
    }

    // Persist refreshed verification timestamp and payload
    saveLocalActivation(signedPayload, signature);

    const state = evaluateLicenseState();
    return NextResponse.json({ ok: true, state }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Verification error.',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
