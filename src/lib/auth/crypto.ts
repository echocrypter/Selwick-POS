/**
 * Selwick POS – Cryptographic helpers (server-side, Node.js built-ins only).
 *
 * PIN hashing is PBKDF2-SHA256 with 150,000 iterations – identical to the
 * browser-side implementation in offlineUsers.ts so existing staff accounts
 * remain valid after migration.
 *
 * Session tokens are 32 cryptographically random bytes (256-bit entropy),
 * stored as hex. The token hash stored in the DB is SHA-256 of that hex string.
 */

import { createHash, randomBytes, pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

// ─── PIN Hashing (PBKDF2-SHA256, 150 000 iterations) ────────────────────────

/**
 * Derives a PBKDF2 hash from a raw PIN using the provided hex salt.
 * Matches the browser-side WebCrypto implementation in offlineUsers.ts exactly.
 */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const saltBuffer = Buffer.from(saltHex, 'hex');
  const derived = await pbkdf2Async(
    Buffer.from(pin, 'utf8'),
    saltBuffer,
    150_000,
    32,
    'sha256',
  );
  return derived.toString('hex');
}

/**
 * Generates a new 16-byte random salt as a hex string.
 */
export function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Constant-time comparison of two strings using crypto.timingSafeEqual.
 * Hashes both inputs with SHA-256 first so both buffers have identical
 * 32-byte length, preventing length leakage and avoiding RangeError.
 */
export function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

// ─── Session Tokens ──────────────────────────────────────────────────────────

/**
 * Generates a 32-byte (256-bit) cryptographically random session token.
 * Returns the raw hex token (sent to client as a cookie value).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hashes a session token for storage in the database.
 * Only the hash is persisted; the raw token lives in the HttpOnly cookie.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// ─── CSRF / Request Origin Validation ────────────────────────────────────────

/**
 * Returns true if the request Origin or Referer header confirms the request
 * originated from localhost / 127.0.0.1 (the only valid Selwick POS origin).
 *
 * Next.js already enforces CORS for cross-origin fetch, but this provides an
 * additional layer for same-site requests (e.g., form submits) that carry no
 * CORS pre-flight.
 */
export function isLocalhostOrigin(origin: string | null, referer: string | null): boolean {
  const check = (value: string | null): boolean => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1'
      );
    } catch {
      return false;
    }
  };
  return check(origin) || check(referer);
}
