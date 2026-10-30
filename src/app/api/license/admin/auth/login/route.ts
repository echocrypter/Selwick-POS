/**
 * POST /api/license/admin/auth/login
 *
 * Secure administrator login for the commercial licensing dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAdminSecret,
  createAdminSessionToken,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  ADMIN_COOKIE_NAME,
} from '@/lib/licensing/adminAuth';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '127.0.0.1';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many failed login attempts. Locked out for ${rateLimit.remainingLockoutSeconds} second(s).`,
      },
      { status: 429 }
    );
  }

  let body: { secret?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const providedSecret = (body.secret || body.password || '').trim();
  if (!providedSecret) {
    return NextResponse.json({ ok: false, error: 'Admin secret is required.' }, { status: 400 });
  }

  let expectedSecret: string;
  try {
    expectedSecret = getAdminSecret();
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Server authentication configuration error.' },
      { status: 500 }
    );
  }

  if (providedSecret !== expectedSecret) {
    recordFailedLogin(ip);
    return NextResponse.json({ ok: false, error: 'Invalid administrator secret.' }, { status: 401 });
  }

  // Success
  clearLoginRateLimit(ip);
  const token = createAdminSessionToken('license-admin');

  const res = NextResponse.json({ ok: true, token, message: 'Authentication successful.' }, { status: 200 });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  });

  return res;
}

