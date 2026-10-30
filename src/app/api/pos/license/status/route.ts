/**
 * GET /api/pos/license/status
 *
 * Evaluates and returns the local commercial license state for the active POS machine.
 * Executed completely offline without requiring internet.
 */

import { NextResponse } from 'next/server';
import { evaluateLicenseState } from '@/lib/licensing/posLicenseClient';

export async function GET(): Promise<NextResponse> {
  try {
    const state = evaluateLicenseState();
    return NextResponse.json({ ok: true, state }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error evaluating license state.',
    }, { status: 500 });
  }
}

