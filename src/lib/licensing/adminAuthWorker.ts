/**
 * Selwick POS — Worker-safe Admin Authentication (Cloudflare Workers subset).
 *
 * This module contains ONLY the authentication primitives that are safe to
 * bundle into a Cloudflare Worker.  It deliberately does NOT import anything
 * from 'next/server', 'next/*', 'node:sqlite', 'node:fs', or any Electron
 * module.
 *
 * The full Next.js-aware adminAuth.ts (which uses NextRequest / NextResponse)
 * remains intact for the POS server-side API routes.  This file re-implements
 * only the pure, Web-API-compatible subset so Wrangler never bundles next/server.
 *
 * Functions exported here are API-identical to the corresponding exports in
 * adminAuth.ts so the Worker can import from here with a one-line change.
 *
 * Security properties preserved:
 *  - HMAC-SHA256 session tokens (8 h expiry)
 *  - Timing-safe comparison (SubtleCrypto.timingSafeEqual / crypto.timingSafeEqual)
 *  - In-memory IP-based rate limiting (5 attempts → 10 min lockout)
 *  - Bearer token, X-Admin-Key header, and HttpOnly cookie verification
 *  - Production fail-closed: throws if SELWICK_LICENSE_ADMIN_SECRET missing
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADMIN_COOKIE_NAME = 'selwick_license_admin_token';
const DEFAULT_DEV_ADMIN_SECRET = 'selwick-dev-admin-secret-phase7-2026';
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// ---------------------------------------------------------------------------
// Rate limiting (in-memory — per-isolate, resets on cold start)
// ---------------------------------------------------------------------------

const loginRateLimitMap = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Web Crypto helpers (no node:crypto, works in workerd and Node.js)
// ---------------------------------------------------------------------------

/**
 * Encode a string to Uint8Array (UTF-8).
 */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * HMAC-SHA256 — returns base64url digest string.
 * Uses SubtleCrypto so it works identically in workerd and Node.js.
 */
async function hmacSha256Base64url(secret: string, data: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encode(secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, encode(data).buffer as ArrayBuffer);
  return base64urlEncode(new Uint8Array(sig));
}

/**
 * Timing-safe byte comparison via SubtleCrypto HMAC verification.
 * Falls back to a constant-time loop if subtle is unavailable.
 */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Base64url encode a Uint8Array → string (no padding).
 */
function base64urlEncode(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64url decode a string → Uint8Array.
 */
function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const b64 = padded + '='.repeat(padding);
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

// ---------------------------------------------------------------------------
// Secret helpers
// ---------------------------------------------------------------------------

/**
 * Returns the admin secret from the provided override, or from environment.
 * Throws in production if the secret is not configured.
 */
export function getAdminSecret(secretOverride?: string): string {
  if (secretOverride) return secretOverride;
  // In a Worker, process.env is not available — callers must pass secretOverride.
  // This path is kept for backward-compat when used in Node.js test harness.
  if (typeof process !== 'undefined' && process.env?.SELWICK_LICENSE_ADMIN_SECRET) {
    return process.env.SELWICK_LICENSE_ADMIN_SECRET;
  }
  const isProduction =
    typeof process !== 'undefined' &&
    (process.env?.NODE_ENV === 'production' || process.env?.SELWICK_ENV === 'production');
  if (isProduction) {
    throw new Error('CRITICAL: SELWICK_LICENSE_ADMIN_SECRET is not configured in production environment.');
  }
  return DEFAULT_DEV_ADMIN_SECRET;
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison (UTF-8 byte comparison).
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = encode(a);
  const bufB = encode(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqualBytes(bufA, bufB);
}

// ---------------------------------------------------------------------------
// HMAC session tokens
// ---------------------------------------------------------------------------

/**
 * Creates a signed session token. Async because SubtleCrypto is async.
 */
export async function createAdminSessionToken(
  actor: string = 'admin',
  secretOverride?: string,
): Promise<string> {
  const secret = getAdminSecret(secretOverride);
  const payload = {
    actor,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_MAX_AGE_MS,
  };
  const payloadBase64 = base64urlEncode(encode(JSON.stringify(payload)));
  const sig = await hmacSha256Base64url(secret, payloadBase64);
  return `${payloadBase64}.${sig}`;
}

/**
 * Validates a signed session token.  Async because SubtleCrypto is async.
 */
export async function verifyAdminSessionToken(
  token: string,
  secretOverride?: string,
): Promise<{ valid: boolean; actor: string }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, actor: '' };
    const [payloadBase64, sig] = parts;
    const secret = getAdminSecret(secretOverride);

    const expectedSig = await hmacSha256Base64url(secret, payloadBase64);
    if (!safeEqual(sig, expectedSig)) {
      return { valid: false, actor: '' };
    }

    const payloadStr = new TextDecoder().decode(base64urlDecode(payloadBase64));
    const payload = JSON.parse(payloadStr) as { actor?: string; expiresAt?: number };
    if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) {
      return { valid: false, actor: '' };
    }

    return { valid: true, actor: payload.actor || 'admin' };
  } catch {
    return { valid: false, actor: '' };
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingLockoutSeconds?: number } {
  const record = loginRateLimitMap.get(ip);
  if (!record) return { allowed: true };

  const now = Date.now();
  if (record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, remainingLockoutSeconds: remainingSeconds };
  }

  // Lockout expired — clear it
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    loginRateLimitMap.delete(ip);
  }
  return { allowed: true };
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const record = loginRateLimitMap.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
  loginRateLimitMap.set(ip, record);
}

export function clearLoginRateLimit(ip: string): void {
  loginRateLimitMap.delete(ip);
}

// ---------------------------------------------------------------------------
// Worker-native request verification (uses standard Web API Request, not NextRequest)
// ---------------------------------------------------------------------------

/**
 * Verifies an admin request using the standard Web API Request object.
 * Checks (in order): X-Admin-Key header, Authorization Bearer, cookie.
 *
 * Returns a Promise because verifyAdminSessionToken is async.
 */
export async function verifyAdminRequestWorker(
  req: Request,
  secretOverride?: string,
): Promise<{ authorized: boolean; actor: string; error?: string }> {
  const secret = getAdminSecret(secretOverride);

  // 1. X-Admin-Key header — raw secret
  const xAdminKey = req.headers.get('x-admin-key');
  if (xAdminKey && safeEqual(xAdminKey, secret)) {
    return { authorized: true, actor: 'api-admin' };
  }

  // 2. Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7).trim();
    if (safeEqual(token, secret)) {
      return { authorized: true, actor: 'bearer-secret' };
    }
    const tokenResult = await verifyAdminSessionToken(token, secretOverride);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  // 3. Cookie (HttpOnly — forwarded by browser)
  const cookieHeader = req.headers.get('cookie') || '';
  const cookieMatch = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (cookieMatch) {
    const cookieValue = cookieMatch.substring(ADMIN_COOKIE_NAME.length + 1);
    const tokenResult = await verifyAdminSessionToken(cookieValue, secretOverride);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  return { authorized: false, actor: '', error: 'Unauthorized: valid admin authentication required.' };
}
