/**
 * Selwick POS — Turso / libSQL Cloud Database Client Provider (Phase 8.2).
 *
 * Provides authoritative cloud database connectivity for the License Server ONLY.
 * Operational POS business data (selwick.db) remains local and 100% untouched.
 *
 * Security Invariants:
 *  1. In production, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are strictly required.
 *  2. If missing in production, the server FAILS CLOSED and never falls back to local disk.
 *  3. In development / testing, local SQLite is preserved for fast, offline regression tests.
 */

import { createClient, type Client } from '@libsql/client';
import { isProductionEnvironment } from './serverKey.ts';

let tursoClientInstance: Client | null = null;

export function isTursoConfigured(): boolean {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return Boolean(url && url.trim() && token && token.trim());
}

/**
 * Returns the authoritative Turso/libSQL client.
 * Enforces production fail-closed security invariants.
 */
export function getTursoClient(explicitConfig?: { url: string; authToken?: string }): Client {
  if (explicitConfig) {
    return createClient({
      url: explicitConfig.url,
      authToken: explicitConfig.authToken,
    });
  }

  if (tursoClientInstance) {
    return tursoClientInstance;
  }

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  const isProd = isProductionEnvironment();

  if (!url || !url.trim() || !token || !token.trim()) {
    if (isProd) {
      throw new Error(
        'CRITICAL: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is not configured in production environment. ' +
        'License Server fails closed. Never silently falling back to local disk.'
      );
    }
    // In dev mode when env vars are not set, return null
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are not configured.');
  }

  tursoClientInstance = createClient({
    url: url.trim(),
    authToken: token.trim(),
  });

  return tursoClientInstance;
}

export function closeTursoClient(): void {
  if (tursoClientInstance) {
    try {
      tursoClientInstance.close();
    } catch {}
    tursoClientInstance = null;
  }
}

