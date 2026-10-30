/**
 * POST /api/migration/reconcile
 *
 * Read-only reconciliation: compares source counts/totals to SQLite using SELECTs only.
 * No INSERT/UPDATE/DELETE is performed.
 */
import { NextRequest, NextResponse } from 'next/server.js';
import { getInitializedDatabase } from '../../../../lib/db/connection.ts';
import {
  requireRole,
  requireBusinessScope,
  AuthError,
  authErrorStatus,
  assertLocalhostOrigin,
} from '../../../../lib/auth/authorization.ts';
import { normalizeMigrationPayload } from '../../../../lib/migration/migrationEngine.ts';
import { readBackupFile, verifyBackupIntegrity, BackupError } from '../../../../lib/migration/backup.ts';
import { toCents } from '../../../../lib/money.ts';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try { assertLocalhostOrigin(req); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  let session;
  try { session = requireRole(req, ['owner']); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  let body: { businessId?: string; backupId?: string; filename?: string; sourcePayload?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body.', code: 'BAD_REQUEST' }, { status: 400 }); }
  const targetBusinessId = body.businessId || session.businessId;
  try { requireBusinessScope(req, targetBusinessId); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }
  const db = getInitializedDatabase();
  let sourcePayload: unknown = body.sourcePayload;
  if (!sourcePayload && (body.backupId || body.filename)) {
    try {
      const integrity = verifyBackupIntegrity(db, { backupId: body.backupId, filename: body.filename });
      if (!integrity.verified) return NextResponse.json({ ok: false, error: integrity.error || 'Backup integrity failed.', code: 'BACKUP_INTEGRITY_MISMATCH' }, { status: 400 });
      const fileData = readBackupFile(integrity.filename);
      sourcePayload = JSON.parse(fileData.content);
    } catch (err: unknown) {
      if (err instanceof BackupError) return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
      return NextResponse.json({ ok: false, error: 'Failed to read backup payload.', code: 'BACKUP_READ_ERROR' }, { status: 400 });
    }
  }
  if (!sourcePayload) return NextResponse.json({ ok: false, error: 'Missing source payload or backup reference.', code: 'MISSING_PAYLOAD' }, { status: 400 });
  let payload: any;
  try { payload = normalizeMigrationPayload(sourcePayload, targetBusinessId); } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Invalid payload.', code: 'INVALID_PAYLOAD' }, { status: 400 });
  }
  const sourceProductsCount = payload.products?.length || 0;
  const sourceCustomersCount = payload.customers?.length || 0;
  const sourceSalesCount = payload.sales?.length || 0;
  const sourceExpensesCount = payload.expenses?.length || 0;
  const sourceCategoriesCount = payload.categories?.length || 0;
  const sourceSalesTotalCents = (payload.sales || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.total || 0))), 0);
  const sourceCustomerBalancesCents = (payload.customers || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.balance || 0))), 0);
  const sourceExpenseTotalCents = (payload.expenses || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.amount || 0))), 0);
  const sourceStockTotal = (payload.products || []).reduce((s: number, x: any) => s + Number(x.stock || 0), 0);
  const sourceInventoryValueCents = (payload.products || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.price || 0))) * Number(x.stock || 0), 0);
  const sumRow = (sql: string) => { const row = db.prepare(sql).get(targetBusinessId) as { sum?: number | null }; return Number(row?.sum || 0); };
  const countRow = (table: string) => { const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE business_id = ?`).get(targetBusinessId) as { c?: number }; return Number(row?.c || 0); };
  const sqliteTotals = {
    productsCount: countRow('products'),
    customersCount: countRow('customers'),
    salesCount: countRow('sales'),
    expensesCount: countRow('expenses'),
    categoriesCount: countRow('categories'),
    stockTotal: sumRow('SELECT SUM(stock) as sum FROM products WHERE business_id = ?'),
    inventoryValueCents: sumRow('SELECT SUM(price_cents * stock) as sum FROM products WHERE business_id = ?'),
    salesTotalCents: sumRow('SELECT SUM(total_cents) as sum FROM sales WHERE business_id = ?'),
    customerBalancesCents: sumRow('SELECT SUM(balance_cents) as sum FROM customers WHERE business_id = ?'),
    expenseTotalCents: sumRow('SELECT SUM(amount_cents) as sum FROM expenses WHERE business_id = ?'),
  };
  const sourceTotals = {
    productsCount: sourceProductsCount,
    customersCount: sourceCustomersCount,
    salesCount: sourceSalesCount,
    expensesCount: sourceExpensesCount,
    categoriesCount: sourceCategoriesCount,
    stockTotal: sourceStockTotal,
    inventoryValueCents: sourceInventoryValueCents,
    salesTotalCents: sourceSalesTotalCents,
    customerBalancesCents: sourceCustomerBalancesCents,
    expenseTotalCents: sourceExpenseTotalCents,
  };
  const differences: string[] = [];
  if (sqliteTotals.productsCount < sourceProductsCount) differences.push(`products count: sqlite ${sqliteTotals.productsCount} < source ${sourceProductsCount}`);
  if (sqliteTotals.customersCount < sourceCustomersCount) differences.push(`customers count: sqlite ${sqliteTotals.customersCount} < source ${sourceCustomersCount}`);
  if (sqliteTotals.salesCount < sourceSalesCount) differences.push(`sales count: sqlite ${sqliteTotals.salesCount} < source ${sourceSalesCount}`);
  if (sqliteTotals.expensesCount < sourceExpensesCount) differences.push(`expenses count: sqlite ${sqliteTotals.expensesCount} < source ${sourceExpensesCount}`);
  if (sqliteTotals.categoriesCount < sourceCategoriesCount) differences.push(`categories count: sqlite ${sqliteTotals.categoriesCount} < source ${sourceCategoriesCount}`);
  if (sqliteTotals.salesTotalCents !== sourceSalesTotalCents) differences.push(`sales total cents: sqlite ${sqliteTotals.salesTotalCents} != source ${sourceSalesTotalCents}`);
  if (sqliteTotals.customerBalancesCents !== sourceCustomerBalancesCents) differences.push(`customer balances cents: sqlite ${sqliteTotals.customerBalancesCents} != source ${sourceCustomerBalancesCents}`);
  if (sqliteTotals.expenseTotalCents !== sourceExpenseTotalCents) differences.push(`expense total cents: sqlite ${sqliteTotals.expenseTotalCents} != source ${sourceExpenseTotalCents}`);
  if (sqliteTotals.stockTotal !== sourceStockTotal) differences.push(`stock total: sqlite ${sqliteTotals.stockTotal} != source ${sourceStockTotal}`);
  const balanced = differences.length === 0;
  return NextResponse.json({ ok: true, balanced, isBalanced: balanced, sourceTotals, sqliteTotals, differences });
}

