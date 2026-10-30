/**
 * POST /api/license/admin/auth/logout
 */

import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME } from '@/lib/licensing/adminAuth';

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true, message: 'Logged out successfully.' });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return res;
}

