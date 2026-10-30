/**
 * Selwick POS – Persistent SQLite-backed login rate limiter.
 *
 * Persists failed login attempts and lockout timestamps to the SQLite database
 * in the `login_attempts` table. This prevents PIN brute-force attacks and ensures
 * that lockouts cannot be bypassed by restarting Electron, killing the server,
 * or reloading Next.js processes.
 *
 * Limits:
 *   • MAX_ATTEMPTS failed attempts within WINDOW_MS → account locked for LOCKOUT_MS.
 *   • A successful login immediately clears the lockout and failure counter.
 */

import { DatabaseSync } from 'node:sqlite';
import { getInitializedDatabase } from '@/lib/db';

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes rolling window
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout duration

interface AttemptRow {
  identity_key: string;
  failed_count: number;
  first_failed_at: number;
  last_failed_at: number;
  locked_until: number | null;
}

function resolveDb(db?: DatabaseSync): DatabaseSync {
  const targetDb = db || getInitializedDatabase();
  ensureAttemptsTable(targetDb);
  return targetDb;
}

function ensureAttemptsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      identity_key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER NOT NULL,
      last_failed_at INTEGER NOT NULL,
      locked_until INTEGER
    );
  `);
}

export function identityKey(businessId: string, name: string): string {
  return `${businessId.trim().toLowerCase()}::${name.trim().toLowerCase()}`;
}

/**
 * Records a failed login attempt in SQLite.
 * Returns the current failure count.
 */
export function recordFailure(businessId: string, name: string, db?: DatabaseSync): number {
  const targetDb = resolveDb(db);
  const key = identityKey(businessId, name);
  const now = Date.now();

  const row = targetDb.prepare(
    'SELECT failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts WHERE identity_key = ?'
  ).get(key) as AttemptRow | undefined;

  if (!row || now - row.first_failed_at > WINDOW_MS) {
    targetDb.prepare(`
      INSERT INTO login_attempts (identity_key, failed_count, first_failed_at, last_failed_at, locked_until)
      VALUES (?, 1, ?, ?, NULL)
      ON CONFLICT(identity_key) DO UPDATE SET
        failed_count = 1,
        first_failed_at = excluded.first_failed_at,
        last_failed_at = excluded.last_failed_at,
        locked_until = NULL
    `).run(key, now, now);
    return 1;
  }

  const newCount = row.failed_count + 1;
  const lockedUntil = newCount >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null;

  targetDb.prepare(`
    UPDATE login_attempts
    SET failed_count = ?, last_failed_at = ?, locked_until = ?
    WHERE identity_key = ?
  `).run(newCount, now, lockedUntil, key);

  return newCount;
}

/**
 * Clears the failure counter in SQLite for a successful login.
 */
export function clearFailures(businessId: string, name: string, db?: DatabaseSync): void {
  const targetDb = resolveDb(db);
  const key = identityKey(businessId, name);
  targetDb.prepare('DELETE FROM login_attempts WHERE identity_key = ?').run(key);
}

/**
 * Returns true if the identity is currently locked out (persisted in SQLite).
 */
export function isLockedOut(businessId: string, name: string, db?: DatabaseSync): boolean {
  const targetDb = resolveDb(db);
  const key = identityKey(businessId, name);
  const now = Date.now();

  const row = targetDb.prepare(
    'SELECT failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts WHERE identity_key = ?'
  ).get(key) as AttemptRow | undefined;

  if (!row) return false;

  // Check explicit locked_until
  if (row.locked_until) {
    if (now < row.locked_until) {
      return true;
    }
    // Expired lockout: clean up
    clearFailures(businessId, name, targetDb);
    return false;
  }

  // Fallback: failed_count reached max and still within lockout window
  if (row.failed_count >= MAX_ATTEMPTS && now - row.last_failed_at < LOCKOUT_MS) {
    return true;
  }

  return false;
}

/**
 * Returns how many seconds until lockout expires (0 if not locked).
 */
export function lockoutSecondsRemaining(businessId: string, name: string, db?: DatabaseSync): number {
  const targetDb = resolveDb(db);
  const key = identityKey(businessId, name);
  const now = Date.now();

  const row = targetDb.prepare(
    'SELECT failed_count, last_failed_at, locked_until FROM login_attempts WHERE identity_key = ?'
  ).get(key) as AttemptRow | undefined;

  if (!row || row.failed_count < MAX_ATTEMPTS) return 0;

  const unlockAt = row.locked_until || (row.last_failed_at + LOCKOUT_MS);
  const remaining = Math.ceil((unlockAt - now) / 1000);
  return Math.max(0, remaining);
}

/**
 * Prunes expired attempts from the database to prevent unbounded growth.
 */
export function pruneStaleAttempts(db?: DatabaseSync): void {
  const targetDb = resolveDb(db);
  const now = Date.now();
  const cutoff = now - (WINDOW_MS + LOCKOUT_MS);

  targetDb.prepare(`
    DELETE FROM login_attempts
    WHERE last_failed_at < ? AND (locked_until IS NULL OR locked_until <= ?)
  `).run(cutoff, now);
}
