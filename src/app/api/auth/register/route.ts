/**
 * POST /api/auth/register
 *
 * Registers a new staff user in the SQLite users table.
 *
 * Security & Access Control:
 *   - Strictly requires an active, authenticated session.
 *   - Only Owner and Manager roles are permitted to register staff accounts.
 *   - Cashiers CANNOT register staff or escalate privileges.
 *   - Only an Owner can register an Owner account (Managers cannot create Owners).
 *   - Client-provided businessId cannot override session.businessId.
 *   - Client-supplied salt/hash are rejected; credentials must be generated
 *     server-side from a validated PIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getInitializedDatabase } from '@/lib/db';
import { hashPin, generateSalt } from '@/lib/auth/crypto';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { type UserRole, type SessionPayload } from '@/lib/auth/sessions';

interface ExistingUserRow { id: string }

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Origin guard
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // 2. Parse request body
  let body: {
    businessId?: string;
    id?: string;
    name?: string;
    role?: string;
    pin?: string;
    salt?: string;
    hash?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  // Reject client-supplied credentials (FINDING-02)
  if (body.salt || body.hash) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Client-supplied salt and hash are not accepted on registration requests. Provide a valid PIN.',
        code: 'INVALID_CREDENTIALS',
      },
      { status: 400 },
    );
  }

  const name = (body.name ?? '').trim();
  const role = (body.role ?? '').trim() as UserRole;
  const pin = (body.pin ?? '').trim();
  const incomingId = (body.id ?? '').trim();
  const requestedBusinessId = (body.businessId ?? '').trim();

  // Basic validation
  if (!name || !role || !pin) {
    return NextResponse.json(
      { ok: false, error: 'name, role, and pin are required.', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  if (!['owner', 'manager', 'cashier'].includes(role)) {
    return NextResponse.json(
      { ok: false, error: 'role must be owner, manager, or cashier.', code: 'INVALID_ROLE' },
      { status: 400 },
    );
  }

  // Validate PIN (4-8 numeric digits)
  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json(
      { ok: false, error: 'pin must be between 4 and 8 numeric digits.', code: 'INVALID_PIN' },
      { status: 400 },
    );
  }

  // Validate incomingId format if provided
  if (incomingId && !UUID_REGEX.test(incomingId)) {
    return NextResponse.json(
      { ok: false, error: 'id must be a valid UUID format.', code: 'INVALID_ID' },
      { status: 400 },
    );
  }

  // 3. Centralized Authorization (FINDING-01, FINDING-03)
  // Strictly require an authenticated session with at least 'manager' or 'owner' role.
  // Cashiers and unauthenticated callers are rejected.
  let session: SessionPayload;
  try {
    session = requireRole(req, ['owner', 'manager']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: authErrorStatus(e) },
      );
    }
    throw e;
  }

  // Manager accounts cannot create or modify Owner accounts (FINDING-03)
  if (role === 'owner' && session.role !== 'owner') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Only owners can register new owner accounts.',
        code: 'INSUFFICIENT_ROLE',
      },
      { status: 403 },
    );
  }

  // Enforce server-side business scope: target user is ALWAYS created in session.businessId
  if (requestedBusinessId && requestedBusinessId !== session.businessId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Cannot register staff for a different business.',
        code: 'BUSINESS_MISMATCH',
      },
      { status: 403 },
    );
  }
  const businessId = session.businessId;

  const db = getInitializedDatabase();

  // 4. Duplicate checks
  const existingName = db.prepare(
    'SELECT id FROM users WHERE business_id = ? AND lower(name) = lower(?)'
  ).get(businessId, name) as ExistingUserRow | undefined;

  if (existingName) {
    return NextResponse.json(
      { ok: false, error: 'A user with this name already exists in this business.', code: 'DUPLICATE_NAME' },
      { status: 409 },
    );
  }

  const userId = incomingId || randomUUID();
  const existingId = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as ExistingUserRow | undefined;
  if (existingId) {
    return NextResponse.json(
      { ok: false, error: 'A user with this ID already exists.', code: 'DUPLICATE_ID' },
      { status: 409 },
    );
  }

  // 5. Generate credentials server-side
  const salt = generateSalt();
  const hash = await hashPin(pin, salt);

  // 6. Insert new user
  db.prepare(`
    INSERT INTO users (id, business_id, name, role, salt, hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, businessId, name, role, salt, hash);

  return NextResponse.json(
    {
      ok: true,
      userId,
      businessId,
      name,
      role,
    },
    { status: 201 },
  );
}
