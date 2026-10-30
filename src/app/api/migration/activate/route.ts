/**
 * POST /api/migration/activate
 *
 * Controlled activation endpoint. SQLite mode is never auto-activated; activation is
 * strictly gated on a balanced read-only reconciliation and preserves LocalStorage.
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
  let body: {
    businessId?: string;
    reconciliation?: { balanced?: boolean; isBalanced?: boolean };
    backupId?: string;
    filename?: string;
    sourcePayload?: unknown;
  };
  try { body = await req.json(); } catch { body = {}; }
  const targetBusinessId = body.businessId || session.businessId;
  try { requireBusinessScope(req, targetBusinessId); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    throw e;
  }

  let balanced = false;
  const clientClaimedBalanced =
    body.reconciliation?.balanced === true || body.reconciliation?.isBalanced === true;
  void clientClaimedBalanced;
  if (!balanced && (body.sourcePayload || body.backupId || body.filename)) {
    try {
      const db = getInitializedDatabase();
      let sourcePayload: unknown = body.sourcePayload;
      if (!sourcePayload && (body.backupId || body.filename)) {
        const { readBackupFile, verifyBackupIntegrity } = await import('../../../../lib/migration/backup.ts');
        const integrity = verifyBackupIntegrity(db, { backupId: body.backupId, filename: body.filename });
        if (!integrity.verified) throw new Error('Backup integrity verification failed.');
        const fileData = readBackupFile(integrity.filename);
        sourcePayload = JSON.parse(fileData.content);
      }
      const payload = normalizeMigrationPayload(sourcePayload, targetBusinessId);
      const sourceProductsCount = payload.products?.length || 0;
      const sourceCustomersCount = payload.customers?.length || 0;
      const sourceSalesCount = payload.sales?.length || 0;
      const sourceExpensesCount = payload.expenses?.length || 0;
      const sourceCategoriesCount = payload.categories?.length || 0;
      const sourceSalesTotalCents = (payload.sales || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.total || 0))), 0);
      const sourceCustomerBalancesCents = (payload.customers || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.balance || 0))), 0);
      const sourceExpenseTotalCents = (payload.expenses || []).reduce((s: number, x: any) => s + Math.round(toCents(Number(x.amount || 0))), 0);
      const sourceStockTotal = (payload.products || []).reduce((s: number, x: any) => s + Number(x.stock || 0), 0);
      const countRow = (table: string) => {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE business_id = ?`).get(targetBusinessId) as { c?: number };
        return Number(row?.c || 0);
      };
      const sumRow = (sql: string) => {
        const row = db.prepare(sql).get(targetBusinessId) as { sum?: number | null };
        return Number(row?.sum || 0);
      };
      const sqliteTotals = {
        productsCount: countRow('products'),
        customersCount: countRow('customers'),
        salesCount: countRow('sales'),
        expensesCount: countRow('expenses'),
        categoriesCount: countRow('categories'),
        stockTotal: sumRow('SELECT SUM(stock) as sum FROM products WHERE business_id = ?'),
        salesTotalCents: sumRow('SELECT SUM(total_cents) as sum FROM sales WHERE business_id = ?'),
        customerBalancesCents: sumRow('SELECT SUM(balance_cents) as sum FROM customers WHERE business_id = ?'),
        expenseTotalCents: sumRow('SELECT SUM(amount_cents) as sum FROM expenses WHERE business_id = ?'),
      };
      const differences: string[] = [];
      if (sqliteTotals.productsCount < sourceProductsCount) differences.push('products');
      if (sqliteTotals.customersCount < sourceCustomersCount) differences.push('customers');
      if (sqliteTotals.salesCount < sourceSalesCount) differences.push('sales');
      if (sqliteTotals.expensesCount < sourceExpensesCount) differences.push('expenses');
      if (sqliteTotals.categoriesCount < sourceCategoriesCount) differences.push('categories');
      if (sqliteTotals.salesTotalCents !== sourceSalesTotalCents) differences.push('salesTotal');
      if (sqliteTotals.customerBalancesCents !== sourceCustomerBalancesCents) differences.push('customerBalances');
      if (sqliteTotals.expenseTotalCents !== sourceExpenseTotalCents) differences.push('expenseTotal');
      if (sqliteTotals.stockTotal !== sourceStockTotal) differences.push('stockTotal');
      balanced = differences.length === 0;
    } catch {
      balanced = false;
    }
  }
  if (!balanced) {
    return NextResponse.json({ ok: false, error: 'Reconciliation must be balanced before activation.', code: 'RECONCILIATION_REQUIRED' }, { status: 409 });
  }

  const db = getInitializedDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS migration_activation (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id TEXT NOT NULL, mode TEXT NOT NULL, activated_at TEXT NOT NULL)`);
  db.prepare('INSERT INTO migration_activation (business_id, mode, activated_at) VALUES (?, ?, ?)').run(targetBusinessId, 'sqlite', new Date().toISOString());
  return NextResponse.json({ ok: true, activated: true, mode: 'sqlite', autoActivated: false, localStoragePreserved: true });
}
