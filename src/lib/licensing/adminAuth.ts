/**
 * Selwick POS — License Admin Authentication & Authorization Subsystem (Phase 7).
 *
 * Provides:
 *  1. Server-side admin verification (Bearer token, X-Admin-Key, or HTTP-only cookie)
 *  2. Timing-safe comparison against SELWICK_LICENSE_ADMIN_SECRET
 *  3. Cryptographic HMAC session tokens for browser dashboard
 *  4. In-memory IP-based rate limiting on administrative login attempts
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server.js';

export const ADMIN_COOKIE_NAME = 'selwick_license_admin_token';
const DEFAULT_DEV_ADMIN_SECRET = 'selwick-dev-admin-secret-phase7-2026';
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// In-memory rate limiting map for login attempts: ip -> { count, lockedUntil }
const loginRateLimitMap = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Retrieves the authoritative admin secret.
 * Enforces that in production, the secret must be configured.
 */
export function getAdminSecret(): string {
  if (process.env.SELWICK_LICENSE_ADMIN_SECRET) {
    return process.env.SELWICK_LICENSE_ADMIN_SECRET;
  }
  if (process.env.NODE_ENV === 'production' || process.env.SELWICK_ENV === 'production') {
    throw new Error('CRITICAL: SELWICK_LICENSE_ADMIN_SECRET is not configured in production environment.');
  }
  return DEFAULT_DEV_ADMIN_SECRET;
}

/**
 * Timing-safe string comparison.
 */
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Creates an HMAC signed session token for admin dashboard access.
 */
export function createAdminSessionToken(actor: string = 'admin'): string {
  const secret = getAdminSecret();
  const payload = {
    actor,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_MAX_AGE_MS,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  return `${payloadBase64}.${sig}`;
}

/**
 * Validates an HMAC signed session token.
 */
export function verifyAdminSessionToken(token: string): { valid: boolean; actor: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, actor: '' };
    const [payloadBase64, sig] = parts;
    const secret = getAdminSecret();

    const expectedSig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
    if (!safeEqual(sig, expectedSig)) {
      return { valid: false, actor: '' };
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (Date.now() > payload.expiresAt) {
      return { valid: false, actor: '' };
    }

    return { valid: true, actor: payload.actor || 'admin' };
  } catch {
    return { valid: false, actor: '' };
  }
}

/**
 * Checks if the caller IP is rate limited for admin authentication.
 */
export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingLockoutSeconds?: number } {
  const record = loginRateLimitMap.get(ip);
  if (!record) return { allowed: true };

  const now = Date.now();
  if (record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, remainingLockoutSeconds: remainingSeconds };
  }

  // Lockout expired
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

/**
 * Core admin request verifier.
 * Checks:
 *  1. Bearer token in Authorization header (either raw secret or HMAC token)
 *  2. X-Admin-Key header (raw secret)
 *  3. selwick_license_admin_token cookie (HMAC token)
 */
export function verifyAdminRequest(req: NextRequest): { authorized: boolean; actor: string; error?: string } {
  const secret = getAdminSecret();

  // 1. Check X-Admin-Key header
  const xAdminKey = req.headers.get('x-admin-key');
  if (xAdminKey && safeEqual(xAdminKey, secret)) {
    return { authorized: true, actor: 'api-admin' };
  }

  // 2. Check Authorization Bearer header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7).trim();
    if (safeEqual(token, secret)) {
      return { authorized: true, actor: 'bearer-secret' };
    }
    const tokenResult = verifyAdminSessionToken(token);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  // 3. Check Cookie
  const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (cookie) {
    const tokenResult = verifyAdminSessionToken(cookie);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  return { authorized: false, actor: '', error: 'Unauthorized: valid admin authentication required.' };
}

/**
 * Enforces admin authorization or returns a 401 response.
 */
export function requireAdminAuth(req: NextRequest): { authorized: true; actor: string } | NextResponse {
  const result = verifyAdminRequest(req);
  if (!result.authorized) {
    return NextResponse.json(
      { ok: false, error: result.error || 'Unauthorized admin access.' },
      { status: 401 }
    );
  }
  return { authorized: true, actor: result.actor };
}
