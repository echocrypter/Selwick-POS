/**
 * Selwick POS — SQLite-Native Backup Engine (Phase 3).
 *
 * Reads directly from SQLite (server-side, no client payload) and produces a
 * versioned, cryptographically verified snapshot that covers every table
 * required for full disaster recovery.
 *
 * Format: selwick-sqlite-v1
 * Monetary values: integer cents (stored exactly as in DB, no conversion)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { getBackupDirectory, sanitizeBackupFilename } from './backup.ts';
import { safeCompare } from '../auth/crypto.ts';

// ─── Format constants ─────────────────────────────────────────────────────────

export const SQLITE_BACKUP_FORMAT = 'selwick-sqlite-v1' as const;
export const SQLITE_BACKUP_APP    = 'selwick-pos'       as const;
export const CURRENT_SCHEMA_VERSION_FOR_BACKUP = 6;    // keep in sync with migrations.ts

// ─── Row types (mirror exact SQLite columns) ──────────────────────────────────

export interface BusinessRow {
  id: string;
  name: string;
  business_type: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  business_id: string;
  name: string;
  role: string;
  salt: string;
  hash: string;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  business_id: string;
  name: string;
  display_order: number;
}

export interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string;
  price_cents: number;
  cost_price_cents: number;
  stock: number;
  min_stock_alert: number;
  description: string | null;
  badge: string | null;
  icon_type: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerRow {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  balance_cents: number;
  loyalty_points: number;
  total_orders: number;
  total_spent_cents: number;
  created_at: string;
  updated_at: string;
}

export interface SaleRow {
  id: string;
  business_id: string;
  invoice_number: string;
  idempotency_key: string | null;
  timestamp: string;
  date_str: string;
  subtotal_cents: number;
  discount_cents: number;
  discount_type: string;
  tax_cents: number;
  total_cents: number;
  payment_method: string;
  amount_tendered_cents: number;
  change_due_cents: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  notes: string | null;
  terminal_id: string;
  cashier_id: string | null;
  cashier_name: string | null;
  status: string;
  created_at: string;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  category: string | null;
  quantity: number;
  price_cents: number;
  cost_price_cents: number;
  discount_cents: number;
  custom_price_cents: number | null;
}

export interface ExpenseRow {
  id: string;
  business_id: string;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  created_at: string;
}

export interface HeldSaleRow {
  id: string;
  business_id: string;
  invoice_number: string;
  date_str: string;
  timestamp: number;
  customer_json: string | null;
  note: string | null;
  items_json: string;
  created_at: string;
}

export interface SettingRow {
  business_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface RefundRow {
  id: string;
  sale_id: string;
  business_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  amount_cents: number;
  payout_method: string;
  cash_payout_cents: number;
  debt_reversal_cents: number;
  terminal_id: string | null;
  reason: string;
  idempotency_key: string | null;
  payout_status: string;
  timestamp: string;
  created_at: string;
}

export interface CreditSaleLedgerRow {
  sale_id: string;
  business_id: string;
  customer_id: string;
  original_credit_cents: number;
  settled_cents: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface KhataSettlementRow {
  id: string;
  business_id: string;
  customer_id: string;
  user_id: string;
  amount_cents: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

export interface KhataAllocationRow {
  id: string;
  settlement_id: string;
  sale_id: string;
  business_id: string;
  customer_id: string;
  allocated_cents: number;
  created_at: string;
}

// ─── Backup structures ────────────────────────────────────────────────────────

export interface SqliteBackupRecordCounts {
  businesses: number;
  users: number;
  categories: number;
  products: number;
  customers: number;
  sales: number;
  saleItems: number;
  expenses: number;
  heldSales: number;
  refunds: number;
  settings: number;
  creditSalesLedger: number;
  khataSettlements: number;
  khataAllocations: number;
}

export interface SqliteBackupMetadata {
  backupId: string;
  app: typeof SQLITE_BACKUP_APP;
  formatVersion: typeof SQLITE_BACKUP_FORMAT;
  schemaVersion: number;
  businessId: string;
  createdAt: string;
  recordCounts: SqliteBackupRecordCounts;
  /** SHA-256 hex of JSON.stringify(data) — computed before embedding metadata */
  dataHash: string;
}

export interface SqliteBackupData {
  businesses: BusinessRow[];
  users: UserRow[];
  categories: CategoryRow[];
  products: ProductRow[];
  customers: CustomerRow[];
  sales: SaleRow[];
  saleItems: SaleItemRow[];
  expenses: ExpenseRow[];
  heldSales: HeldSaleRow[];
  refunds: RefundRow[];
  settings: SettingRow[];
  creditSalesLedger: CreditSaleLedgerRow[];
  khataSettlements: KhataSettlementRow[];
  khataAllocations: KhataAllocationRow[];
}

export interface SqliteBackupPayload {
  metadata: SqliteBackupMetadata;
  data: SqliteBackupData;
}

export interface CreateSqliteBackupResult {
  backupId: string;
  businessId: string;
  filename: string;
  filePath: string;
  dataHash: string;
  recordCounts: SqliteBackupRecordCounts;
  createdAt: string;
  formatVersion: string;
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class SqliteBackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[SqliteBackupError:${code}] ${message}`);
    this.name = 'SqliteBackupError';
    this.code = code;
  }
}

// ─── Core: read all tables in a single deferred (read-only) transaction ───────

export function snapshotSqliteData(
  db: DatabaseSync,
  businessId: string,
  options: { wrapTransaction?: boolean } = {}
): SqliteBackupData {
  if (!businessId || typeof businessId !== 'string') {
    throw new SqliteBackupError('INVALID_BUSINESS_ID', 'Business ID is required.');
  }

  const shouldWrap = options.wrapTransaction !== false;

  // Check table existence helper (handles DB that may have older schema)
  function tableExists(name: string): boolean {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { name: string } | undefined;
    return !!row;
  }

  if (shouldWrap) {
    db.exec('BEGIN DEFERRED;');
  }
  try {
    // 1. Businesses
    const businesses = db.prepare(
      'SELECT id, name, business_type, created_at, updated_at FROM businesses WHERE id = ?'
    ).all(businessId) as BusinessRow[];

    // 2. Users (PBKDF2 hash+salt — no plaintext credentials)
    const users = db.prepare(
      'SELECT id, business_id, name, role, salt, hash, created_at FROM users WHERE business_id = ? ORDER BY created_at ASC'
    ).all(businessId) as UserRow[];

    // 3. Categories
    const categories = db.prepare(
      'SELECT id, business_id, name, display_order FROM categories WHERE business_id = ? ORDER BY display_order ASC, name ASC'
    ).all(businessId) as CategoryRow[];

    // 4. Products
    const products = db.prepare(`
      SELECT id, business_id, name, sku, barcode, category, price_cents, cost_price_cents,
             stock, min_stock_alert, description, badge, icon_type, is_active, created_at, updated_at
      FROM products WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as ProductRow[];

    // 5. Customers
    const customers = db.prepare(`
      SELECT id, business_id, name, phone, email, address, balance_cents,
             loyalty_points, total_orders, total_spent_cents, created_at, updated_at
      FROM customers WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as CustomerRow[];

    // 6. Sales
    const sales = db.prepare(`
      SELECT id, business_id, invoice_number, idempotency_key, timestamp, date_str,
             subtotal_cents, discount_cents, discount_type, tax_cents, total_cents,
             payment_method, amount_tendered_cents, change_due_cents,
             customer_id, customer_name, customer_phone, notes,
             terminal_id, cashier_id, cashier_name, status, created_at
      FROM sales WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as SaleRow[];

    // 7. Sale Items (join-filtered by business via sales)
    const saleItems = db.prepare(`
      SELECT si.id, si.sale_id, si.product_id, si.product_name, si.product_sku,
             si.product_barcode, si.category, si.quantity, si.price_cents,
             si.cost_price_cents, si.discount_cents, si.custom_price_cents
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = ?
      ORDER BY si.sale_id ASC
    `).all(businessId) as SaleItemRow[];

    // 8. Expenses
    const expenses = db.prepare(`
      SELECT id, business_id, date, category, description, amount_cents, created_at
      FROM expenses WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as ExpenseRow[];

    // 9. Held Sales
    const heldSales = db.prepare(`
      SELECT id, business_id, invoice_number, date_str, timestamp,
             customer_json, note, items_json, created_at
      FROM held_sales WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as HeldSaleRow[];

    // 10. Settings
    const settings = db.prepare(
      'SELECT business_id, key, value, updated_at FROM settings WHERE business_id = ? ORDER BY key ASC'
    ).all(businessId) as SettingRow[];

    // 11. Refund Ledger (was missing from old backup — now included)
    const refunds = db.prepare(`
      SELECT id, sale_id, business_id, user_id, user_name, user_role,
             amount_cents, payout_method, cash_payout_cents, debt_reversal_cents,
             terminal_id, reason, idempotency_key, payout_status, timestamp, created_at
      FROM refund_ledger WHERE business_id = ? ORDER BY created_at ASC
    `).all(businessId) as RefundRow[];

    // 12. Credit Sales Ledger (Khata)
    const creditSalesLedger: CreditSaleLedgerRow[] = tableExists('credit_sales_ledger')
      ? (db.prepare(`
          SELECT csl.sale_id, csl.business_id, csl.customer_id, csl.original_credit_cents,
                 csl.settled_cents, csl.status, csl.created_at, csl.updated_at
          FROM credit_sales_ledger csl WHERE csl.business_id = ? ORDER BY csl.created_at ASC
        `).all(businessId) as CreditSaleLedgerRow[])
      : [];

    // 13. Khata Settlements
    const khataSettlements: KhataSettlementRow[] = tableExists('khata_settlements')
      ? (db.prepare(`
          SELECT id, business_id, customer_id, user_id, amount_cents,
                 payment_method, notes, created_at
          FROM khata_settlements WHERE business_id = ? ORDER BY created_at ASC
        `).all(businessId) as KhataSettlementRow[])
      : [];

    // 14. Khata Allocation Records
    const khataAllocations: KhataAllocationRow[] = tableExists('khata_settlement_allocations')
      ? (db.prepare(`
          SELECT ksa.id, ksa.settlement_id, ksa.sale_id, ksa.business_id,
                 ksa.customer_id, ksa.allocated_cents, ksa.created_at
          FROM khata_settlement_allocations ksa WHERE ksa.business_id = ? ORDER BY ksa.created_at ASC
        `).all(businessId) as KhataAllocationRow[])
      : [];

    if (shouldWrap) {
      db.exec('COMMIT;');
    }

    return {
      businesses,
      users,
      categories,
      products,
      customers,
      sales,
      saleItems,
      expenses,
      heldSales,
      settings,
      refunds,
      creditSalesLedger,
      khataSettlements,
      khataAllocations,
    };
  } catch (err) {
    if (shouldWrap) {
      try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
    }
    throw err;
  }
}

// ─── Hash helpers ─────────────────────────────────────────────────────────────

export function hashData(data: SqliteBackupData): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

export function buildRecordCounts(data: SqliteBackupData): SqliteBackupRecordCounts {
  return {
    businesses:        data.businesses.length,
    users:             data.users.length,
    categories:        data.categories.length,
    products:          data.products.length,
    customers:         data.customers.length,
    sales:             data.sales.length,
    saleItems:         data.saleItems.length,
    expenses:          data.expenses.length,
    heldSales:         data.heldSales.length,
    refunds:           data.refunds.length,
    settings:          data.settings.length,
    creditSalesLedger: data.creditSalesLedger.length,
    khataSettlements:  data.khataSettlements.length,
    khataAllocations:  data.khataAllocations.length,
  };
}

// ─── Assemble full backup payload ─────────────────────────────────────────────

export function assembleSqliteBackup(
  db: DatabaseSync,
  businessId: string,
): { payload: SqliteBackupPayload; backupId: string } {
  const data      = snapshotSqliteData(db, businessId);
  const dataHash  = hashData(data);
  const backupId  = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const metadata: SqliteBackupMetadata = {
    backupId,
    app: SQLITE_BACKUP_APP,
    formatVersion: SQLITE_BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION_FOR_BACKUP,
    businessId,
    createdAt,
    recordCounts: buildRecordCounts(data),
    dataHash,
  };

  return { payload: { metadata, data }, backupId };
}

// ─── Write payload to disk atomically ─────────────────────────────────────────

export function writeSqliteBackupToFile(
  db: DatabaseSync,
  businessId: string,
  payload: SqliteBackupPayload,
  backupId: string,
): CreateSqliteBackupResult {
  const backupDir = getBackupDirectory();

  const timestamp     = payload.metadata.createdAt.replace(/[:.]/g, '-');
  const safeSlug      = businessId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
  const shortHash     = payload.metadata.dataHash.slice(0, 8);
  const rawFilename   = `selwick-sqlite-${safeSlug}-${timestamp}-${shortHash}.json`;
  const filename      = sanitizeBackupFilename(rawFilename);
  const filePath      = path.join(backupDir, filename);
  const tempPath      = `${filePath}.tmp-${crypto.randomUUID()}`;

  const jsonContent = JSON.stringify(payload, null, 2);

  try {
    fs.writeFileSync(tempPath, jsonContent, 'utf8');

    // Read-back verify before rename
    const readBack   = fs.readFileSync(tempPath, 'utf8');
    const readHash   = crypto.createHash('sha256').update(readBack).digest('hex');
    const writeHash  = crypto.createHash('sha256').update(jsonContent).digest('hex');
    if (!safeCompare(writeHash, readHash)) {
      throw new SqliteBackupError('WRITE_INTEGRITY_MISMATCH', 'File read-back SHA-256 did not match written content.');
    }

    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
    throw err;
  }

  // Log to durable_backup_ledger
  const totalRecords = Object.values(payload.metadata.recordCounts).reduce((a, b) => a + b, 0);
  db.prepare(`
    INSERT INTO durable_backup_ledger (id, business_id, filename, sha256_hash, total_records, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(backupId, businessId, filename, payload.metadata.dataHash, totalRecords, payload.metadata.createdAt);

  return {
    backupId,
    businessId,
    filename,
    filePath,
    dataHash: payload.metadata.dataHash,
    recordCounts: payload.metadata.recordCounts,
    createdAt: payload.metadata.createdAt,
    formatVersion: SQLITE_BACKUP_FORMAT,
  };
}

// ─── Top-level convenience function ───────────────────────────────────────────

export function createSqliteBackup(
  db: DatabaseSync,
  businessId: string,
): CreateSqliteBackupResult {
  const { payload, backupId } = assembleSqliteBackup(db, businessId);
  return writeSqliteBackupToFile(db, businessId, payload, backupId);
}

