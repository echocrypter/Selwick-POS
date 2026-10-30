/**
 * GET /api/pos/settings - Retrieve store settings for business
 * PUT /api/pos/settings - Update store settings (Manager/Owner only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { SettingsRepository } from '@/lib/db/repositories/settingsRepository';
import type { StoreSettings } from '@/types/pos';

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const db = getInitializedDatabase();
  const settings = SettingsRepository.getStoreSettings(db, session.businessId);

  return NextResponse.json({ ok: true, data: settings });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let session;
  try {
    session = requireRole(req, ['manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let body: Partial<StoreSettings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  // Strict Validation
  if (body.storeName !== undefined && !body.storeName.trim()) {
    return NextResponse.json({ ok: false, error: 'Store name cannot be empty.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  if (body.taxRate !== undefined) {
    if (typeof body.taxRate !== 'number' || isNaN(body.taxRate) || body.taxRate < 0 || body.taxRate > 100) {
      return NextResponse.json({ ok: false, error: 'Tax rate must be a valid number between 0 and 100.', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
  }

  if (body.defaultDiscount !== undefined) {
    if (typeof body.defaultDiscount !== 'number' || isNaN(body.defaultDiscount) || body.defaultDiscount < 0) {
      return NextResponse.json({ ok: false, error: 'Default discount must be a positive number.', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
  }

  const db = getInitializedDatabase();
  try {
    const updated = SettingsRepository.updateStoreSettings(db, session.businessId, body);

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save store settings.';
    return NextResponse.json({ ok: false, error: msg, code: 'SAVE_SETTINGS_FAILED' }, { status: 500 });
  }
}
