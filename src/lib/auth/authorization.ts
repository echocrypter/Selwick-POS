/**
 * Selwick POS – Server-side authorization helpers.
 *
 * Usage in a Next.js Route Handler:
 *
 *   import { requireAuth, requireRole } from '@/lib/auth/authorization';
 *
 *   export async function GET(req: NextRequest) {
 *     const session = await requireAuth(req);
 *     // or:
 *     const session = await requireRole(req, ['owner', 'manager']);
 *     // session.businessId, session.userId, session.role are available
 *   }
 *
 * Both helpers return a SessionPayload or throw a typed AuthError that the
 * route handler should convert to an appropriate HTTP response.
 */

import { type NextRequest } from 'next/server.js';
import { getInitializedDatabase } from '../../lib/db/connection.ts';
import {
  verifySession,
  maybeRefreshSession,
  SESSION_COOKIE_NAME,
  type UserRole,
  type SessionPayload,
} from './sessions.ts';
import { isLocalhostOrigin } from './crypto.ts';

// ─── Auth Error Types ─────────────────────────────────────────────────────────

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'EXPIRED_SESSION'
  | 'INSUFFICIENT_ROLE'
  | 'INVALID_ORIGIN'
  | 'BUSINESS_MISMATCH';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

const ROLE_RANK: Record<UserRole, number> = {
  cashier: 1,
  manager: 2,
  owner: 3,
};

/**
 * Returns true if the session role meets the minimum required role.
 */
export function hasRole(sessionRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[sessionRole] >= ROLE_RANK[requiredRole];
}

// ─── Core Auth Helpers ────────────────────────────────────────────────────────

/**
 * Validates the request origin against localhost.
 * Throws AuthError if the request does not come from a localhost origin.
 *
 * Skipped in test environments where no real HTTP request is made.
 */
export function assertLocalhostOrigin(req: NextRequest): void {
  if (process.env.SELWICK_ENV === 'test') return;

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const clientHeader = req.headers.get('x-selwick-client');

  if (origin || referer) {
    if (!isLocalhostOrigin(origin, referer)) {
      throw new AuthError(
        'INVALID_ORIGIN',
        `Request rejected: origin "${origin || referer}" is not a permitted Selwick POS origin.`,
      );
    }
    return;
  }

  // If no origin and no referer, verify local loopback host or client header
  const host = req.headers.get('host') || '';
  const isLoopback =
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('::1');

  if (!isLoopback && clientHeader !== 'selwick-pos-renderer') {
    throw new AuthError(
      'INVALID_ORIGIN',
      'Request rejected: origin or host is not permitted.',
    );
  }
}

/**
 * Extracts and validates the session cookie from the request.
 * Returns a refreshed SessionPayload or throws an AuthError.
 */
export function requireAuth(req: NextRequest): SessionPayload {
  assertLocalhostOrigin(req);

  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) {
    throw new AuthError('MISSING_TOKEN', 'No session cookie present.');
  }

  const db = getInitializedDatabase();
  const session = verifySession(db, rawToken);

  if (!session) {
    throw new AuthError('EXPIRED_SESSION', 'Session has expired or is invalid.');
  }

  // Opportunistically refresh if nearing expiry
  const refreshedExpiry = maybeRefreshSession(db, session.sessionId, session.expiresAt);
  return { ...session, expiresAt: refreshedExpiry };
}

/**
 * Like requireAuth but also enforces that the session role meets one of the
 * allowed roles. Throws AuthError with code INSUFFICIENT_ROLE otherwise.
 */
export function requireRole(
  req: NextRequest,
  allowedRoles: UserRole[],
): SessionPayload {
  const session = requireAuth(req);

  const permitted = allowedRoles.some((r) => hasRole(session.role, r));
  if (!permitted) {
    throw new AuthError(
      'INSUFFICIENT_ROLE',
      `Role "${session.role}" is not authorized. Required: ${allowedRoles.join(' | ')}.`,
    );
  }

  return session;
}

/**
 * Like requireAuth but also enforces that the session businessId matches the
 * businessId in the request body / query params. Prevents cross-business data access.
 *
 * @param req - the incoming request
 * @param requestedBusinessId - the business ID from the request payload
 */
export function requireBusinessScope(
  req: NextRequest,
  requestedBusinessId: string,
): SessionPayload {
  const session = requireAuth(req);

  if (session.businessId !== requestedBusinessId) {
    throw new AuthError(
      'BUSINESS_MISMATCH',
      `Session business "${session.businessId}" does not match requested business "${requestedBusinessId}".`,
    );
  }

  return session;
}

// ─── HTTP Error Response Helper ───────────────────────────────────────────────

/**
 * Maps an AuthError to an appropriate HTTP status code.
 */
export function authErrorStatus(error: AuthError): number {
  switch (error.code) {
    case 'MISSING_TOKEN':
    case 'EXPIRED_SESSION':
    case 'INVALID_TOKEN':
      return 401;
    case 'INSUFFICIENT_ROLE':
    case 'BUSINESS_MISMATCH':
      return 403;
    case 'INVALID_ORIGIN':
      return 403;
    default:
      return 401;
  }
}
