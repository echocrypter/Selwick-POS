/**
 * GET    /api/pos/expenses/[id] - Get single expense
 * DELETE /api/pos/expenses/[id] - Delete/reverse expense with audit preservation (Manager/Owner only)
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

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
  const row = ExpenseRepository.findById(db, session.businessId, id);
  if (!row) {
    return NextResponse.json({ ok: false, error: `Expense "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: toDomainExpense(row) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

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

  const db = getInitializedDatabase();
  const existing = ExpenseRepository.findById(db, session.businessId, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: `Expense "${id}" not found.`, code: 'NOT_FOUND' }, { status: 404 });
  }

  // Preserve financial audit trail by capturing deleted record snapshot before removal
  const deletedSnapshot = toDomainExpense(existing);
  const success = ExpenseRepository.delete(db, session.businessId, id);

  return NextResponse.json({
    ok: true,
    deleted: success,
    reversedExpense: deletedSnapshot,
    audit: {
      action: 'EXPENSE_DELETED',
      expenseId: id,
      deletedByUserId: session.userId,
      deletedByUserRole: session.role,
      timestamp: new Date().toISOString(),
    },
  });
}
