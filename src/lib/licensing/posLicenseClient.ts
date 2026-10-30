/**
 * Selwick POS — Client-Side License Verification & Offline Grace Engine (Phase 6).
 *
 * Runs locally inside the POS desktop app:
 *  1. Cryptographically verifies Ed25519 signature with embedded public key
 *  2. Evaluates expiration date (supports Lifetime licenses that never expire)
 *  3. Enforces device binding (prevents copying activation file across machines)
 *  4. Enforces offline grace period (temporary internet loss does NOT disrupt sales)
 *  5. Never deletes or touches the SQLite operational POS database on license expiry
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type SignedLicensePayload,
  type LocalActivationData,
  type PosLicenseState,
} from './types.ts';
import {
  SELWICK_POS_PUBLIC_KEY,
  verifyLicenseSignature,
} from './keys.ts';
import { getDeviceId } from './device.ts';

const DEFAULT_GRACE_PERIOD_DAYS = 14;

export function getActivationFilePath(): string {
  if (process.env.SELWICK_ACTIVATION_PATH) {
    return path.resolve(process.env.SELWICK_ACTIVATION_PATH);
  }

  // Windows packaged app user data path
  if (process.env.SELWICK_USER_DATA_PATH) {
    return path.join(process.env.SELWICK_USER_DATA_PATH, 'license_activation.json');
  }

  // Local / dev fallback in .data/
  return path.join(process.cwd(), '.data', 'license_activation.json');
}

/**
 * Loads the local activation file from disk.
 */
export function loadLocalActivation(): LocalActivationData | null {
  try {
    const filePath = getActivationFilePath();
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return null;
    const content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, 'utf8');
    return JSON.parse(content) as LocalActivationData;
  } catch {
    return null;
  }
}

/**
 * Persists an authentic, verified activation locally.
 */
export function saveLocalActivation(
  signedPayload: SignedLicensePayload,
  signature: string,
  gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS,
): void {
  const filePath = getActivationFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });

  const data: LocalActivationData = {
    signedPayload,
    signature,
    lastVerifiedAt: new Date().toISOString(),
    gracePeriodDays,
  };

  fs.writeFileSync(/*turbopackIgnore: true*/ filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Removes local activation file (e.g. for deactivation or fresh license key).
 */
export function clearLocalActivation(): void {
  try {
    const filePath = getActivationFilePath();
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
  } catch {}
}

/**
 * Core POS license evaluation function.
 * Evaluates authenticity, device binding, expiration, and offline grace status.
 */
export function evaluateLicenseState(
  explicitActivation?: LocalActivationData | null,
  explicitDeviceId?: string,
  publicKeyPem: string = SELWICK_POS_PUBLIC_KEY,
): PosLicenseState {
  const currentDeviceId = explicitDeviceId || getDeviceId();
  const activation = explicitActivation !== undefined ? explicitActivation : loadLocalActivation();

  if (!activation || !activation.signedPayload || !activation.signature) {
    return {
      status: 'unlicensed',
      isValid: false,
      canOperate: false,
      plan: null,
      customerName: null,
      licenseKey: null,
      expiresAt: null,
      daysRemaining: null,
      isGracePeriod: false,
      graceDaysRemaining: null,
      features: [],
      deviceId: currentDeviceId,
      message: 'Selwick POS is not activated. Enter a commercial license key to unlock.',
    };
  }

  const { signedPayload, signature, lastVerifiedAt, gracePeriodDays } = activation;

  // 1. Cryptographic Signature Verification
  const isSignatureValid = verifyLicenseSignature(signedPayload, signature, publicKeyPem);
  if (!isSignatureValid) {
    return {
      status: 'invalid',
      isValid: false,
      canOperate: false,
      plan: null,
      customerName: null,
      licenseKey: null,
      expiresAt: null,
      daysRemaining: null,
      isGracePeriod: false,
      graceDaysRemaining: null,
      features: [],
      deviceId: currentDeviceId,
      message: 'License signature verification failed. The activation file has been modified or corrupted.',
    };
  }

  // 2. Device Identifier Binding Check
  if (signedPayload.deviceId !== currentDeviceId) {
    return {
      status: 'invalid',
      isValid: false,
      canOperate: false,
      plan: signedPayload.plan,
      customerName: signedPayload.customerName,
      licenseKey: signedPayload.licenseKey,
      expiresAt: signedPayload.expiresAt,
      daysRemaining: null,
      isGracePeriod: false,
      graceDaysRemaining: null,
      features: [],
      deviceId: currentDeviceId,
      message: 'This activation is bound to another device. Activate this terminal with your license key.',
    };
  }

  // 3. Expiration Check
  const now = new Date();
  let daysRemaining: number | null = null;

  if (signedPayload.expiresAt) {
    const expDate = new Date(signedPayload.expiresAt);
    const diffMs = expDate.getTime() - now.getTime();
    daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs <= 0) {
      return {
        status: 'expired',
        isValid: false,
        canOperate: false,
        plan: signedPayload.plan,
        customerName: signedPayload.customerName,
        licenseKey: signedPayload.licenseKey,
        expiresAt: signedPayload.expiresAt,
        daysRemaining: 0,
        isGracePeriod: false,
        graceDaysRemaining: null,
        features: signedPayload.features,
        deviceId: currentDeviceId,
        message: `Your ${signedPayload.plan} license expired on ${expDate.toLocaleDateString()}. Please renew your license to continue.`,
      };
    }
  }

  // 4. Offline Grace Period Evaluation
  const lastVerified = new Date(lastVerifiedAt || signedPayload.serverTimestamp);
  const timeSinceVerificationMs = now.getTime() - lastVerified.getTime();
  const gracePeriodMs = (gracePeriodDays || DEFAULT_GRACE_PERIOD_DAYS) * 24 * 60 * 60 * 1000;
  const graceRemainingMs = gracePeriodMs - timeSinceVerificationMs;
  const graceDaysRemaining = Math.max(0, Math.ceil(graceRemainingMs / (1000 * 60 * 60 * 24)));

  if (graceRemainingMs <= 0) {
    // Grace period exhausted without online reconnection
    return {
      status: 'grace_period',
      isValid: true,
      canOperate: false, // Must reconnect to server
      plan: signedPayload.plan,
      customerName: signedPayload.customerName,
      licenseKey: signedPayload.licenseKey,
      expiresAt: signedPayload.expiresAt,
      daysRemaining,
      isGracePeriod: true,
      graceDaysRemaining: 0,
      features: signedPayload.features,
      deviceId: currentDeviceId,
      message: `Offline grace period (${gracePeriodDays} days) has elapsed. Connect to the internet to verify your license.`,
    };
  }

  const isGraceWarning = graceDaysRemaining <= 5 && graceDaysRemaining > 0;

  return {
    status: 'active',
    isValid: true,
    canOperate: true,
    plan: signedPayload.plan,
    customerName: signedPayload.customerName,
    licenseKey: signedPayload.licenseKey,
    expiresAt: signedPayload.expiresAt,
    daysRemaining,
    isGracePeriod: isGraceWarning,
    graceDaysRemaining,
    features: signedPayload.features,
    deviceId: currentDeviceId,
    message: isGraceWarning
      ? `License active (Offline mode: please connect to internet within ${graceDaysRemaining} day(s)).`
      : 'License activated and verified.',
  };
}

/**
 * Checks if a specific feature is enabled by the active license.
 */
export function isFeatureEnabled(featureName: string, state?: PosLicenseState): boolean {
  const current = state || evaluateLicenseState();
  if (!current.canOperate) return false;
  return current.features.includes(featureName as any);
}

/**
 * Validates the license server URL configuration.
 * Enforces HTTPS in production environments.
 */
export function validateLicenseServerUrl(
  url?: string | null,
  isProd: boolean = false
): { valid: boolean; error?: string; code?: string; url?: string } {
  if (!url || !url.trim()) {
    if (isProd) {
      return {
        valid: false,
        error: 'CRITICAL: SELWICK_LICENSE_SERVER_URL is not configured in production environment.',
        code: 'MISSING_LICENSE_SERVER_URL',
      };
    }
    return { valid: true, url: undefined };
  }

  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (isProd && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `Production license server URL must use HTTPS (TLS encryption required). Received: ${trimmed}`,
        code: 'INSECURE_HTTP_NOT_ALLOWED',
      };
    }
    return { valid: true, url: trimmed };
  } catch {
    return {
      valid: false,
      error: `Invalid license server URL format: ${trimmed}`,
      code: 'INVALID_URL_FORMAT',
    };
  }
}
