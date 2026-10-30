/**
 * Selwick POS — Cryptographic License Signing & Verification (Ed25519).
 *
 * The POS client contains ONLY the PUBLIC key and can verify authentic licenses offline.
 * The PRIVATE key is owned exclusively by the License Server.
 */

import crypto from 'node:crypto';
import { type SignedLicensePayload } from './types.ts';

// ─── Embedded POS Public Verification Key (SPKI Ed25519 PEM) ─────────────────
export const SELWICK_POS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3YoQ8zyynwiJyAm8h+9lxBtBkmT7tNtvhsyEAqYeWUM=
-----END PUBLIC KEY-----`;

/**
 * Deterministically canonicalizes a SignedLicensePayload to avoid JSON key ordering discrepancies.
 */
export function canonicalizePayload(payload: SignedLicensePayload): string {
  const sorted = {
    deviceId: payload.deviceId,
    expiresAt: payload.expiresAt,
    features: [...payload.features].sort(),
    issuedAt: payload.issuedAt,
    licenseId: payload.licenseId,
    licenseKey: payload.licenseKey,
    maxDevices: payload.maxDevices,
    customerName: payload.customerName,
    plan: payload.plan,
    serverTimestamp: payload.serverTimestamp,
  };
  return JSON.stringify(sorted);
}

/**
 * Verifies that a SignedLicensePayload was authentically signed by the License Server.
 * Executed locally on the POS client machine without needing internet access.
 */
export function verifyLicenseSignature(
  payload: SignedLicensePayload,
  signatureBase64: string,
  publicKeyPem: string = SELWICK_POS_PUBLIC_KEY,
): boolean {
  try {
    if (!signatureBase64 || typeof signatureBase64 !== 'string') return false;
    const canonical = canonicalizePayload(payload);
    const dataBuffer = Buffer.from(canonical, 'utf8');
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');

    return crypto.verify(null, dataBuffer, publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Signs a license payload using the License Server's private key.
 * Strictly executed on the License Server only.
 */
export function signLicensePayload(
  payload: SignedLicensePayload,
  privateKeyPem: string,
): string {
  const canonical = canonicalizePayload(payload);
  const dataBuffer = Buffer.from(canonical, 'utf8');
  return crypto.sign(null, dataBuffer, privateKeyPem).toString('base64');
}

/**
 * Generates a high-entropy, human-friendly, cryptographically random license key.
 * Format: SELW-PRO-A3F2-89C4-E1D7-B508
 */
export function generateLicenseKey(prefix = 'SELW', plan = 'PRO'): string {
  const randomBytes = crypto.randomBytes(8).toString('hex').toUpperCase();
  const chunk1 = randomBytes.slice(0, 4);
  const chunk2 = randomBytes.slice(4, 8);
  const chunk3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const chunk4 = crypto.randomBytes(2).toString('hex').toUpperCase();

  return `${prefix.toUpperCase()}-${plan.toUpperCase()}-${chunk1}-${chunk2}-${chunk3}-${chunk4}`;
}

