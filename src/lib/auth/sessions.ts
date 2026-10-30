/**
 * Selwick POS – Session management (server-side, SQLite-backed).
 *
 * Session lifecycle:
 *   create  → INSERT into user_sessions with token_hash + expiry
 *   verify  → SELECT by token_hash, check expiry, return session payload
 *   refresh → UPDATE expires_at to extend an active session
 *   revoke  → DELETE a specific session (logout)
 *   purge   → DELETE all sessions for a user (force-logout all devices)
 *
 * The raw session token (256-bit random hex) is sent to the browser as an
 * HttpOnly, SameSite=Strict cookie named `selwick_session`.
 * Only the SHA-256 hash of the token is stored in the database.
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { generateSessionToken, hashSessionToken } from './crypto.ts';

export const SESSION_COOKIE_NAME = 'selwick_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;   // 8 hours (a typical shift)
export const SESSION_REFRESH_THRESHOLD_MS = 30 * 60 * 1000; // refresh if < 30 min remain

export type UserRole = 'owner' | 'manager' | 'cashier';

export interface SessionPayload {
  sessionId: string;
  userId: string;
  businessId: string;
  role: UserRole;
  expiresAt: string; // ISO-8601
}

interface SessionRow {
  id: string;
  user_id: string;
  business_id: string;
  role: string;
  token_hash: string;
  expires_at: string;
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Creates a new server-side session and returns the raw token to be set as a
 * cookie.  The raw token is never stored in the database.
 */
export function createSession(
  db: DatabaseSync,
  userId: string,
  businessId: string,
  role: UserRole,
): { rawToken: string; payload: SessionPayload } {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, business_id, role, token_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, businessId, role, tokenHash, expiresAt);

  return {
    rawToken,
    payload: { sessionId, userId, businessId, role, expiresAt },
  };
}

// ─── Verify ──────────────────────────────────────────────────────────────────

/**
 * Looks up a session by raw token.
 * Returns the session payload if valid, or null if expired / not found.
 */
export function verifySession(
  db: DatabaseSync,
  rawToken: string,
): SessionPayload | null {
  const tokenHash = hashSessionToken(rawToken);

  const row = db.prepare(`
    SELECT id, user_id, business_id, role, token_hash, expires_at
    FROM user_sessions
    WHERE token_hash = ?
    LIMIT 1
  `).get(tokenHash) as SessionRow | undefined;

  if (!row) return null;

  // Expired → delete and return null
  if (new Date(row.expires_at) <= new Date()) {
    db.prepare('DELETE FROM user_sessions WHERE id = ?').run(row.id);
    return null;
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    businessId: row.business_id,
    role: row.role as UserRole,
    expiresAt: row.expires_at,
  };
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/**
 * Extends the session expiry if it will expire within the refresh threshold.
 * Returns the updated expiry or the existing one if no refresh was needed.
 */
export function maybeRefreshSession(
  db: DatabaseSync,
  sessionId: string,
  currentExpiresAt: string,
): string {
  const remaining = new Date(currentExpiresAt).getTime() - Date.now();
  if (remaining > SESSION_REFRESH_THRESHOLD_MS) return currentExpiresAt;

  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('UPDATE user_sessions SET expires_at = ? WHERE id = ?').run(
    newExpiry,
    sessionId,
  );
  return newExpiry;
}

// ─── Revoke ──────────────────────────────────────────────────────────────────

/**
 * Revokes (deletes) a single session by its ID.
 */
export function revokeSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
}

/**
 * Revokes all sessions for a user (force-logout everywhere).
 */
export function revokeAllUserSessions(db: DatabaseSync, userId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

// ─── Purge Expired ───────────────────────────────────────────────────────────

/**
 * Deletes all expired sessions from the database.
 * Should be called periodically (e.g., on server startup or scheduled).
 */
export function purgeExpiredSessions(db: DatabaseSync): number {
  const nowIso = new Date().toISOString();
  const result = db.prepare(
    'DELETE FROM user_sessions WHERE expires_at <= ?',
  ).run(nowIso);
  return (result as unknown as { changes: number }).changes ?? 0;
}
