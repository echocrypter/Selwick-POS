/**
 * Selwick POS — License Server Private Key Provider.
 *
 * Exists ONLY for the License Server.
 * NEVER shipped or exported to client-facing modules.
 *
 * In production:
 *   - The private key MUST come from SELWICK_LICENSE_PRIVATE_KEY.
 *   - If missing, it FAILS CLOSED. It never silently falls back to disk or default keys.
 * In development / testing:
 *   - Falls back to .data/license_private_key.pem or default dev key.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DEV_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIO4QyRr8UIRWAyKS1pX0tWEqgZgwy1NcH8Nsd1rCezHS
-----END PRIVATE KEY-----`;

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.SELWICK_ENV === 'production';
}

export function getLicenseServerPrivateKey(): string {
  if (process.env.SELWICK_LICENSE_PRIVATE_KEY) {
    return process.env.SELWICK_LICENSE_PRIVATE_KEY.trim();
  }

  // In production, strictly fail closed. Never fall back to disk or default dev keys.
  if (isProductionEnvironment()) {
    throw new Error('CRITICAL: SELWICK_LICENSE_PRIVATE_KEY is not configured in production environment. License Server fails closed.');
  }

  const keyPath = path.join(process.cwd(), '.data', 'license_private_key.pem');
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8').trim();
  }

  // In test / dev environments, fallback to default key corresponding to the embedded public key
  return DEFAULT_DEV_PRIVATE_KEY;
}
