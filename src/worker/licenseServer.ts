/**
 * Selwick POS — Cloudflare Worker Commercial License Server.
 *
 * Implements a standalone, zero-cost, serverless commercial license server on Cloudflare Workers
 * using Turso (libSQL) as the persistent cloud database.
 *
 * Invariants:
 *  1. NEVER imports node:sqlite, filesystem, Electron, or desktop POS code.
 *  2. Uses @libsql/client/web for TLS HTTP-based database connectivity.
 *  3. Executes Ed25519 signing via node:crypto (nodejs_compat flag).
 *  4. Fails closed if production secrets are missing.
 *  5. Reuses existing cloud-compatible business logic from tursoRepository.ts & keys.ts.
 *  6. 100% API-compatible with desktop POS client expectations.
 */

import { createClient, type Client } from '@libsql/client';
import {
  createLicenseTurso,
  activateLicenseTurso,
  verifyLicenseTurso,
  deactivateActivationByIdTurso,
  renewLicenseTurso,
  setLicenseStatusTurso,
  setMaxDevicesTurso,
  getLicenseByIdTurso,
  listLicensesTurso,
  getLicenseDetailsTurso,
  getDashboardMetricsTurso,
} from '../lib/licensing/tursoRepository.ts';
import {
  LicenseError,
  generateCustomerMessage,
  type CreateLicenseParams,
  type ListLicensesOptions,
} from '../lib/licensing/licenseService.ts';
import {
  safeEqual,
  createAdminSessionToken,
  verifyAdminSessionToken,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  ADMIN_COOKIE_NAME,
} from '../lib/licensing/adminAuth.ts';

export interface LicenseWorkerEnv {
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  SELWICK_LICENSE_PRIVATE_KEY?: string;
  SELWICK_LICENSE_ADMIN_SECRET?: string;
  ENVIRONMENT?: string;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: unknown, status = 200, req?: Request, extraHeaders: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(req ? getCorsHeaders(req) : {}),
    ...extraHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function getTursoClient(env: LicenseWorkerEnv): Client {
  const url = env.TURSO_DATABASE_URL;
  const token = env.TURSO_AUTH_TOKEN;

  if (!url || !url.trim() || !token || !token.trim()) {
    throw new Error('CRITICAL: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is not configured on Cloudflare Worker.');
  }

  return createClient({
    url: url.trim(),
    authToken: token.trim(),
  });
}

function getPrivateKey(env: LicenseWorkerEnv): string {
  const key = env.SELWICK_LICENSE_PRIVATE_KEY;
  if (!key || !key.trim()) {
    throw new Error('CRITICAL: SELWICK_LICENSE_PRIVATE_KEY is not configured on Cloudflare Worker.');
  }
  return key.trim();
}

function getAdminSecret(env: LicenseWorkerEnv): string {
  const secret = env.SELWICK_LICENSE_ADMIN_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('CRITICAL: SELWICK_LICENSE_ADMIN_SECRET is not configured on Cloudflare Worker.');
  }
  return secret.trim();
}

function getClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         '127.0.0.1';
}

function verifyAdminAuth(req: Request, env: LicenseWorkerEnv): { authorized: boolean; actor: string; error?: string } {
  let secret: string;
  try {
    secret = getAdminSecret(env);
  } catch (err: unknown) {
    return { authorized: false, actor: '', error: err instanceof Error ? err.message : 'Server auth unconfigured' };
  }

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
    const tokenResult = verifyAdminSessionToken(token, secret);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  // 3. Check Cookie
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]+)`));
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]);
    const tokenResult = verifyAdminSessionToken(token, secret);
    if (tokenResult.valid) {
      return { authorized: true, actor: tokenResult.actor };
    }
  }

  return { authorized: false, actor: '', error: 'Unauthorized: Valid admin credentials required.' };
}

export default {
  async fetch(req: Request, env: LicenseWorkerEnv): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    // 0. CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(req),
      });
    }

    // 1. Health check endpoint
    if (pathname === '/health' || pathname === '/api/license/health') {
      return jsonResponse({
        ok: true,
        service: 'Selwick POS License Server',
        runtime: 'Cloudflare Workers (Edge)',
        database: 'Turso (libSQL)',
        timestamp: new Date().toISOString(),
      }, 200, req);
    }

    // 2. Public POST /api/license/activate
    if (method === 'POST' && pathname === '/api/license/activate') {
      let body: { licenseKey?: string; deviceId?: string; deviceName?: string };
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, 400, req);
      }

      const { licenseKey, deviceId, deviceName } = body;
      if (!licenseKey?.trim()) {
        return jsonResponse({ ok: false, error: 'License key is required.', code: 'MISSING_KEY' }, 400, req);
      }
      if (!deviceId?.trim()) {
        return jsonResponse({ ok: false, error: 'Device identifier is required.', code: 'MISSING_DEVICE' }, 400, req);
      }

      try {
        const client = getTursoClient(env);
        const privateKey = getPrivateKey(env);
        const ip = getClientIp(req);
        const result = await activateLicenseTurso(client, licenseKey, deviceId, deviceName, privateKey, ip);

        return jsonResponse({
          ok: true,
          signedPayload: result.signedPayload,
          signature: result.signature,
        }, 200, req);
      } catch (err: unknown) {
        if (err instanceof LicenseError) {
          return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
        }
        return jsonResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Internal licensing server error.',
          code: 'INTERNAL_ERROR',
        }, 500, req);
      }
    }

    // 3. Public POST /api/license/verify
    if (method === 'POST' && pathname === '/api/license/verify') {
      let body: { licenseKey?: string; deviceId?: string };
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, 400, req);
      }

      const { licenseKey, deviceId } = body;
      if (!licenseKey?.trim() || !deviceId?.trim()) {
        return jsonResponse({ ok: false, error: 'License key and device ID are required.', code: 'INVALID_INPUT' }, 400, req);
      }

      try {
        const client = getTursoClient(env);
        const privateKey = getPrivateKey(env);
        const ip = getClientIp(req);
        const result = await verifyLicenseTurso(client, licenseKey, deviceId, privateKey, ip);

        return jsonResponse({
          ok: true,
          status: result.status,
          signedPayload: result.signedPayload,
          signature: result.signature,
        }, 200, req);
      } catch (err: unknown) {
        if (err instanceof LicenseError) {
          return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
        }
        return jsonResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Internal license verification error.',
          code: 'INTERNAL_ERROR',
        }, 500, req);
      }
    }

    // 4. Admin Auth: POST /api/license/admin/auth/login
    if (method === 'POST' && pathname === '/api/license/admin/auth/login') {
      const ip = getClientIp(req);
      const rateLimit = checkLoginRateLimit(ip);
      if (!rateLimit.allowed) {
        return jsonResponse({
          ok: false,
          error: `Too many failed login attempts. Locked out for ${rateLimit.remainingLockoutSeconds} second(s).`,
        }, 429, req);
      }

      let body: { secret?: string; password?: string };
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON request body.' }, 400, req);
      }

      const providedSecret = (body.secret || body.password || '').trim();
      if (!providedSecret) {
        return jsonResponse({ ok: false, error: 'Admin secret is required.' }, 400, req);
      }

      let expectedSecret: string;
      try {
        expectedSecret = getAdminSecret(env);
      } catch (err: unknown) {
        return jsonResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Server authentication unconfigured.',
        }, 500, req);
      }

      if (!safeEqual(providedSecret, expectedSecret)) {
        recordFailedLogin(ip);
        return jsonResponse({ ok: false, error: 'Invalid administrator secret.' }, 401, req);
      }

      clearLoginRateLimit(ip);
      const token = createAdminSessionToken('license-admin', expectedSecret);
      const cookieHeader = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;

      return jsonResponse({ ok: true, token, message: 'Authentication successful.' }, 200, req, {
        'Set-Cookie': cookieHeader,
      });
    }

    // 5. Admin Auth: POST /api/license/admin/auth/logout
    if (method === 'POST' && pathname === '/api/license/admin/auth/logout') {
      const clearCookie = `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
      return jsonResponse({ ok: true, message: 'Logged out successfully.' }, 200, req, {
        'Set-Cookie': clearCookie,
      });
    }

    // 6. Admin Auth: GET /api/license/admin/auth/session
    if (method === 'GET' && pathname === '/api/license/admin/auth/session') {
      const auth = verifyAdminAuth(req, env);
      if (!auth.authorized) {
        return jsonResponse({ ok: true, authenticated: false }, 200, req);
      }
      return jsonResponse({ ok: true, authenticated: true, actor: auth.actor }, 200, req);
    }

    // --- PROTECTED ADMIN ROUTES ---
    const adminAuthPrefixes = [
      '/api/license/admin/overview',
      '/api/license/admin/licenses',
      '/api/license/admin/activations',
    ];

    if (adminAuthPrefixes.some(p => pathname.startsWith(p))) {
      const auth = verifyAdminAuth(req, env);
      if (!auth.authorized) {
        return jsonResponse({ ok: false, error: auth.error || 'Unauthorized admin access.' }, 401, req);
      }

      // 7. GET /api/license/admin/overview
      if (method === 'GET' && pathname === '/api/license/admin/overview') {
        try {
          const client = getTursoClient(env);
          const metrics = await getDashboardMetricsTurso(client);
          return jsonResponse({ ok: true, metrics }, 200, req);
        } catch (err: unknown) {
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Database error.',
          }, 500, req);
        }
      }

      // 8. GET /api/license/admin/licenses
      if (method === 'GET' && pathname === '/api/license/admin/licenses') {
        const search = url.searchParams.get('q') || undefined;
        const status = (url.searchParams.get('status') as any) || undefined;
        const plan = (url.searchParams.get('plan') as any) || undefined;
        const sortBy = (url.searchParams.get('sortBy') as any) || undefined;
        const sortOrder = (url.searchParams.get('sortOrder') as any) || undefined;

        const options: ListLicensesOptions = { search, status, plan, sortBy, sortOrder };
        try {
          const client = getTursoClient(env);
          const licenses = await listLicensesTurso(client, options);
          return jsonResponse({ ok: true, licenses }, 200, req);
        } catch (err: unknown) {
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Database error.',
          }, 500, req);
        }
      }

      // 9. POST /api/license/admin/licenses
      if (method === 'POST' && pathname === '/api/license/admin/licenses') {
        let body: CreateLicenseParams;
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid JSON request body.' }, 400, req);
        }

        try {
          const client = getTursoClient(env);
          const license = await createLicenseTurso(client, { ...body, actor: auth.actor });
          const customerMessage = generateCustomerMessage(license);
          return jsonResponse({ ok: true, license, customerMessage }, 201, req);
        } catch (err: unknown) {
          if (err instanceof LicenseError) {
            return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
          }
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Error creating license.',
          }, 500, req);
        }
      }

      // 10. POST /api/license/admin/licenses/:id/renew
      const renewMatch = pathname.match(/^\/api\/license\/admin\/licenses\/([^/]+)\/renew$/);
      if (method === 'POST' && renewMatch) {
        const licenseId = renewMatch[1];
        let body: { expiresAt?: string | null } = {};
        try {
          body = await req.json();
        } catch {}

        try {
          const client = getTursoClient(env);
          const result = await renewLicenseTurso(client, licenseId, body.expiresAt, auth.actor);
          return jsonResponse({
            ok: true,
            message: 'License renewed successfully.',
            expiresAt: result.expiresAt,
          }, 200, req);
        } catch (err: unknown) {
          if (err instanceof LicenseError) {
            return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
          }
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Error renewing license.',
          }, 500, req);
        }
      }

      // 11. GET /api/license/admin/licenses/:id
      const licenseIdMatch = pathname.match(/^\/api\/license\/admin\/licenses\/([^/]+)$/);
      if (method === 'GET' && licenseIdMatch) {
        const licenseId = licenseIdMatch[1];
        try {
          const client = getTursoClient(env);
          const license = await getLicenseDetailsTurso(client, licenseId);
          if (!license) {
            return jsonResponse({ ok: false, error: 'License not found.' }, 404, req);
          }
          const customerMessage = generateCustomerMessage(license);
          return jsonResponse({ ok: true, license, customerMessage }, 200, req);
        } catch (err: unknown) {
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Database error.',
          }, 500, req);
        }
      }

      // 12. PUT / PATCH /api/license/admin/licenses/:id
      if ((method === 'PUT' || method === 'PATCH') && licenseIdMatch) {
        const licenseId = licenseIdMatch[1];
        let body: {
          action?: 'set_status' | 'renew' | 'set_max_devices';
          status?: 'active' | 'suspended' | 'revoked' | 'expired';
          expiresAt?: string | null;
          maxDevices?: number;
        };

        try {
          body = await req.json();
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400, req);
        }

        try {
          const client = getTursoClient(env);

          if (body.action === 'set_status' && body.status) {
            await setLicenseStatusTurso(client, licenseId, body.status, auth.actor);
            return jsonResponse({ ok: true, message: `Status updated to ${body.status}` }, 200, req);
          }

          if (body.action === 'renew') {
            const renewed = await renewLicenseTurso(client, licenseId, body.expiresAt, auth.actor);
            return jsonResponse({
              ok: true,
              message: 'License renewed successfully.',
              expiresAt: renewed.expiresAt,
            }, 200, req);
          }

          if (body.action === 'set_max_devices' && typeof body.maxDevices === 'number') {
            await setMaxDevicesTurso(client, licenseId, body.maxDevices, auth.actor);
            return jsonResponse({
              ok: true,
              message: `Max devices updated to ${body.maxDevices}`,
            }, 200, req);
          }

          return jsonResponse({ ok: false, error: 'Invalid update action.' }, 400, req);
        } catch (err: unknown) {
          if (err instanceof LicenseError) {
            return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
          }
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Error updating license.',
          }, 500, req);
        }
      }

      // 13. DELETE /api/license/admin/activations/:id
      const activationIdMatch = pathname.match(/^\/api\/license\/admin\/activations\/([^/]+)$/);
      if (method === 'DELETE' && activationIdMatch) {
        const activationId = activationIdMatch[1];
        try {
          const client = getTursoClient(env);
          await deactivateActivationByIdTurso(client, activationId, auth.actor);
          return jsonResponse({ ok: true, message: 'Device deactivated successfully.' }, 200, req);
        } catch (err: unknown) {
          if (err instanceof LicenseError) {
            return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status, req);
          }
          return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Database error.',
          }, 500, req);
        }
      }
    }

    return jsonResponse({ ok: false, error: 'Endpoint not found.' }, 404, req);
  },
};
