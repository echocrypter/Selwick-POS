/**
 * GET  /api/pos/expenses - List expenses for business with date/category filters
 * POST /api/pos/expenses - Record a new business expense
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '@/lib/auth/authorization';
import { ExpenseRepository, toDomainExpense } from '@/lib/db/repositories/expenseRepository';
import { ValidationError, NotFoundError } from '@/lib/db/repositories/errors';

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

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const category = searchParams.get('category') || undefined;

  const db = getInitializedDatabase();
  const rows = ExpenseRepository.list(db, session.businessId, { startDate, endDate, category });
  const totalCents = ExpenseRepository.getTotalAmountCents(db, session.businessId, { startDate, endDate, category });

  return NextResponse.json({
    ok: true,
    data: rows.map(toDomainExpense),
    totalCount: rows.length,
    totalCents,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertLocalhostOrigin(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  // Expense creation is restricted to Manager and Owner.
  // Cashiers cannot create expenses (server-side enforced, not UI-only).
  let session;
  try {
    session = requireRole(req, ['manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const db = getInitializedDatabase();
  try {
    const created = ExpenseRepository.create(db, session.businessId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      date: String(body.date || ''),
      category: String(body.category || ''),
      description: String(body.description || ''),
      amountCents: typeof body.amountCents === 'number' ? body.amountCents : undefined,
      amount: typeof body.amount === 'number' ? body.amount : undefined,
    });

    return NextResponse.json({ ok: true, data: toDomainExpense(created) }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to record expense.';
    return NextResponse.json({ ok: false, error: msg, code: 'CREATE_EXPENSE_FAILED' }, { status: 500 });
  }
}
