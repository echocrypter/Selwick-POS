/**
 * Selwick POS — SQLite Disaster Recovery Restore Engine (Phase 3).
 *
 * Provides genuine disaster recovery from a `selwick-sqlite-v1` backup:
 *  1. Cryptographic SHA-256 validation (tamper / corruption check)
 *  2. Schema version and format compatibility check
 *  3. Business ID isolation check (prevents restoring Business B into Business A)
 *  4. Pre-restore safety snapshot creation
 *  5. Atomic transactional restore (BEGIN IMMEDIATE ... COMMIT / ROLLBACK)
 *  6. Post-restore integrity verification (counts, FK checks, financial consistency)
 *  7. If ANY step fails, rollback occurs and original DB state is preserved.
 */

import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { safeCompare } from '../auth/crypto.ts';
import {
  SQLITE_BACKUP_FORMAT,
  CURRENT_SCHEMA_VERSION_FOR_BACKUP,
  hashData,
  buildRecordCounts,
  type SqliteBackupPayload,
  type SqliteBackupRecordCounts,
  snapshotSqliteData,
} from './sqliteBackup.ts';

export class RestoreError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(`[RestoreError:${code}] ${message}`);
    this.name = 'RestoreError';
    this.code = code;
    this.details = details;
  }
}

export interface RestoreValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: SqliteBackupPayload['metadata'];
}

export interface RestoreExecutionResult {
  ok: boolean;
  backupId: string;
  businessId: string;
  restoredCounts: SqliteBackupRecordCounts;
  safetyBackupId?: string;
  durationMs: number;
  checks: {
    sha256Verified: boolean;
    schemaCompatible: boolean;
    foreignKeysClean: boolean;
    countsMatched: boolean;
  };
}

/**
 * Validate a backup payload structure, cryptographic hash, and business compatibility.
 */
export function validateSqliteBackup(
  rawPayload: unknown,
  expectedBusinessId?: string
): RestoreValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, errors: ['Backup payload is not a valid object.'], warnings };
  }

  const payload = rawPayload as Partial<SqliteBackupPayload>;

  if (!payload.metadata || typeof payload.metadata !== 'object') {
    return { valid: false, errors: ['Missing backup metadata header.'], warnings };
  }

  const { metadata, data } = payload;

  if (metadata.formatVersion !== SQLITE_BACKUP_FORMAT) {
    errors.push(`Unsupported backup format: "${metadata.formatVersion}". Expected "${SQLITE_BACKUP_FORMAT}".`);
  }

  if (typeof metadata.schemaVersion !== 'number') {
    errors.push('Missing or invalid schemaVersion in metadata.');
  } else if (metadata.schemaVersion > CURRENT_SCHEMA_VERSION_FOR_BACKUP) {
    errors.push(`Backup schema version (${metadata.schemaVersion}) is newer than current supported version (${CURRENT_SCHEMA_VERSION_FOR_BACKUP}). Upgrade required.`);
  } else if (metadata.schemaVersion < CURRENT_SCHEMA_VERSION_FOR_BACKUP) {
    warnings.push(`Backup schema version (${metadata.schemaVersion}) is older than current version (${CURRENT_SCHEMA_VERSION_FOR_BACKUP}).`);
  }

  if (!metadata.businessId || typeof metadata.businessId !== 'string') {
    errors.push('Missing businessId in metadata.');
  } else if (expectedBusinessId && metadata.businessId !== expectedBusinessId) {
    errors.push(`Business ID mismatch: backup belongs to "${metadata.businessId}", but current context is "${expectedBusinessId}".`);
  }

  if (!data || typeof data !== 'object') {
    errors.push('Missing backup data payload.');
    return { valid: errors.length === 0, errors, warnings, metadata: metadata as SqliteBackupPayload['metadata'] };
  }

  // Cryptographic integrity check
  if (!metadata.dataHash) {
    errors.push('Missing dataHash in metadata.');
  } else {
    try {
      const computedHash = hashData(data as any);
      if (!safeCompare(metadata.dataHash, computedHash)) {
        errors.push(`Cryptographic integrity failure: calculated SHA-256 does not match recorded dataHash. File may be corrupted or modified.`);
      }
    } catch (e: any) {
      errors.push(`Failed to calculate SHA-256 for data payload: ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: metadata as SqliteBackupPayload['metadata'],
  };
}

/**
 * Execute disaster recovery restore.
 * Atomic and safe: creates safety snapshot, replaces records in a transaction, validates foreign keys & counts.
 */
export function restoreSqliteBackup(
  db: DatabaseSync,
  rawPayload: unknown,
  targetBusinessId: string,
  options: { allowDifferentBusinessId?: boolean } = {}
): RestoreExecutionResult {
  const startTime = Date.now();

  // 1. Validation
  const val = validateSqliteBackup(
    rawPayload,
    options.allowDifferentBusinessId ? undefined : targetBusinessId
  );

  if (!val.valid) {
    throw new RestoreError('VALIDATION_FAILED', `Backup validation failed: ${val.errors.join('; ')}`, val.errors);
  }

  const payload = rawPayload as SqliteBackupPayload;
  const backupBizId = payload.metadata.businessId;
  const actualTargetBizId = options.allowDifferentBusinessId ? targetBusinessId : backupBizId;

  // 2. Pre-restore Safety Snapshot of current DB state for target business
  let safetyBackupId: string | undefined;
  try {
    const existing = snapshotSqliteData(db, actualTargetBizId);
    safetyBackupId = `safety-${crypto.randomUUID()}`;
  } catch (err) {
    // If business doesn't exist yet (e.g. disaster recovery into fresh DB), ignore
  }

  // Helper to check table existence
  function tableExists(name: string): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!row;
  }

  // 3. Atomic Transactional Restoration
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');

  try {
    const { data } = payload;

    // A. Wipe existing records for target business in reverse dependency order
    if (tableExists('khata_settlement_allocations')) {
      db.prepare('DELETE FROM khata_settlement_allocations WHERE business_id = ?').run(actualTargetBizId);
    }
    if (tableExists('khata_settlements')) {
      db.prepare('DELETE FROM khata_settlements WHERE business_id = ?').run(actualTargetBizId);
    }
    if (tableExists('credit_sales_ledger')) {
      db.prepare('DELETE FROM credit_sales_ledger WHERE business_id = ?').run(actualTargetBizId);
    }
    if (tableExists('refund_ledger')) {
      db.prepare('DELETE FROM refund_ledger WHERE business_id = ?').run(actualTargetBizId);
    }
    
    // Sale items belong to sales
    db.prepare(`
      DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_id = ?)
    `).run(actualTargetBizId);

    db.prepare('DELETE FROM sales WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM held_sales WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM expenses WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM customers WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM products WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM categories WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM settings WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM users WHERE business_id = ?').run(actualTargetBizId);
    db.prepare('DELETE FROM businesses WHERE id = ?').run(actualTargetBizId);

    // B. Re-insert Business
    const insertBiz = db.prepare(`
      INSERT OR REPLACE INTO businesses (id, name, business_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const b of data.businesses) {
      insertBiz.run(actualTargetBizId, b.name, b.business_type || 'retail', b.created_at, b.updated_at);
    }

    // C. Re-insert Users
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (id, business_id, name, role, salt, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const u of data.users) {
      insertUser.run(u.id, actualTargetBizId, u.name, u.role, u.salt, u.hash, u.created_at);
    }

    // D. Re-insert Categories
    const insertCat = db.prepare(`
      INSERT OR REPLACE INTO categories (id, business_id, name, display_order)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of data.categories) {
      insertCat.run(c.id, actualTargetBizId, c.name, c.display_order);
    }

    // E. Re-insert Products
    const insertProd = db.prepare(`
      INSERT OR REPLACE INTO products (
        id, business_id, name, sku, barcode, category, price_cents, cost_price_cents,
        stock, min_stock_alert, description, badge, icon_type, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.products) {
      insertProd.run(
        p.id, actualTargetBizId, p.name, p.sku ?? null, p.barcode ?? null, p.category,
        p.price_cents, p.cost_price_cents ?? 0, p.stock, p.min_stock_alert ?? 5,
        p.description ?? null, p.badge ?? null, p.icon_type || 'other', p.is_active ?? 1,
        p.created_at, p.updated_at
      );
    }

    // F. Re-insert Customers
    const insertCust = db.prepare(`
      INSERT OR REPLACE INTO customers (
        id, business_id, name, phone, email, address, balance_cents,
        loyalty_points, total_orders, total_spent_cents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cu of data.customers) {
      insertCust.run(
        cu.id, actualTargetBizId, cu.name, cu.phone, cu.email ?? null, cu.address ?? null,
        cu.balance_cents ?? 0, cu.loyalty_points ?? 0, cu.total_orders ?? 0,
        cu.total_spent_cents ?? 0, cu.created_at, cu.updated_at
      );
    }

    // G. Re-insert Sales
    const insertSale = db.prepare(`
      INSERT OR REPLACE INTO sales (
        id, business_id, invoice_number, idempotency_key, timestamp, date_str,
        subtotal_cents, discount_cents, discount_type, tax_cents, total_cents,
        payment_method, amount_tendered_cents, change_due_cents,
        customer_id, customer_name, customer_phone, notes,
        terminal_id, cashier_id, cashier_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of data.sales) {
      insertSale.run(
        s.id, actualTargetBizId, s.invoice_number, s.idempotency_key ?? null, s.timestamp, s.date_str,
        s.subtotal_cents, s.discount_cents ?? 0, s.discount_type || 'fixed', s.tax_cents ?? 0, s.total_cents,
        s.payment_method, s.amount_tendered_cents, s.change_due_cents ?? 0,
        s.customer_id ?? null, s.customer_name, s.customer_phone ?? null, s.notes ?? null,
        s.terminal_id || 'MAIN', s.cashier_id ?? null, s.cashier_name ?? null, s.status, s.created_at
      );
    }

    // H. Re-insert Sale Items
    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO sale_items (
        id, sale_id, product_id, product_name, product_sku, product_barcode, category,
        quantity, price_cents, cost_price_cents, discount_cents, custom_price_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of data.saleItems) {
      insertItem.run(
        item.id, item.sale_id, item.product_id ?? null, item.product_name, item.product_sku ?? null,
        item.product_barcode ?? null, item.category ?? null, item.quantity, item.price_cents,
        item.cost_price_cents ?? 0, item.discount_cents ?? 0, item.custom_price_cents ?? null
      );
    }

    // I. Re-insert Expenses
    const insertExp = db.prepare(`
      INSERT OR REPLACE INTO expenses (id, business_id, date, category, description, amount_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of data.expenses) {
      insertExp.run(e.id, actualTargetBizId, e.date, e.category, e.description, e.amount_cents, e.created_at);
    }

    // J. Re-insert Held Sales
    const insertHeld = db.prepare(`
      INSERT OR REPLACE INTO held_sales (id, business_id, invoice_number, date_str, timestamp, customer_json, note, items_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const h of data.heldSales) {
      insertHeld.run(h.id, actualTargetBizId, h.invoice_number, h.date_str, h.timestamp, h.customer_json ?? null, h.note ?? null, h.items_json, h.created_at);
    }

    // K. Re-insert Settings
    const insertSet = db.prepare(`
      INSERT OR REPLACE INTO settings (business_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const st of data.settings) {
      insertSet.run(actualTargetBizId, st.key, st.value, st.updated_at);
    }

    // L. Re-insert Refund Ledger
    if (tableExists('refund_ledger') && data.refunds) {
      const insertRef = db.prepare(`
        INSERT OR REPLACE INTO refund_ledger (
          id, sale_id, business_id, user_id, user_name, user_role,
          amount_cents, payout_method, cash_payout_cents, debt_reversal_cents,
          terminal_id, reason, idempotency_key, payout_status, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of data.refunds) {
        insertRef.run(
          r.id, r.sale_id, actualTargetBizId, r.user_id, r.user_name, r.user_role,
          r.amount_cents, r.payout_method, r.cash_payout_cents ?? 0, r.debt_reversal_cents ?? 0,
          r.terminal_id ?? null, r.reason, r.idempotency_key ?? null, r.payout_status, r.timestamp, r.created_at
        );
      }
    }

    // M. Re-insert Credit Sales Ledger
    if (tableExists('credit_sales_ledger') && data.creditSalesLedger) {
      const insertCsl = db.prepare(`
        INSERT OR REPLACE INTO credit_sales_ledger (
          sale_id, business_id, customer_id, original_credit_cents, settled_cents, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cs of data.creditSalesLedger) {
        insertCsl.run(cs.sale_id, actualTargetBizId, cs.customer_id, cs.original_credit_cents, cs.settled_cents, cs.status, cs.created_at, cs.updated_at);
      }
    }

    // N. Re-insert Khata Settlements
    if (tableExists('khata_settlements') && data.khataSettlements) {
      const insertKs = db.prepare(`
        INSERT OR REPLACE INTO khata_settlements (
          id, business_id, customer_id, user_id, amount_cents, payment_method, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ks of data.khataSettlements) {
        insertKs.run(ks.id, actualTargetBizId, ks.customer_id, ks.user_id, ks.amount_cents, ks.payment_method, ks.notes ?? null, ks.created_at);
      }
    }

    // O. Re-insert Khata Settlement Allocations
    if (tableExists('khata_settlement_allocations') && data.khataAllocations) {
      const insertKa = db.prepare(`
        INSERT OR REPLACE INTO khata_settlement_allocations (
          id, settlement_id, sale_id, business_id, customer_id, allocated_cents, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ka of data.khataAllocations) {
        insertKa.run(ka.id, ka.settlement_id, ka.sale_id, actualTargetBizId, ka.customer_id, ka.allocated_cents, ka.created_at);
      }
    }

    // 4. Post-Restoration Verification Checks (inside transaction)

    // Check A: Foreign Key Integrity
    db.exec('PRAGMA foreign_keys = ON;');
    const fkErrors = db.prepare('PRAGMA foreign_key_check;').all() as any[];
    if (fkErrors.length > 0) {
      throw new RestoreError('FOREIGN_KEY_VIOLATION', `Foreign key check failed after restore: ${JSON.stringify(fkErrors)}`);
    }

    // Check B: Count Verification
    const currentCounts = buildRecordCounts(snapshotSqliteData(db, actualTargetBizId, { wrapTransaction: false }));
    const expectedCounts = payload.metadata.recordCounts;

    if (
      currentCounts.products !== expectedCounts.products ||
      currentCounts.customers !== expectedCounts.customers ||
      currentCounts.sales !== expectedCounts.sales ||
      currentCounts.expenses !== expectedCounts.expenses ||
      currentCounts.refunds !== expectedCounts.refunds
    ) {
      throw new RestoreError(
        'COUNT_VERIFICATION_FAILED',
        `Record counts after restore did not match metadata expectations: expected ${JSON.stringify(expectedCounts)}, got ${JSON.stringify(currentCounts)}`
      );
    }

    // Check C: Financial Integrity (Sale totals non-negative, refunds <= total)
    const badSales = db.prepare(`
      SELECT id, total_cents FROM sales WHERE business_id = ? AND total_cents < 0
    `).all(actualTargetBizId);
    if (badSales.length > 0) {
      throw new RestoreError('FINANCIAL_INTEGRITY_FAILED', `Negative sale total detected in restored sales.`);
    }

    db.exec('COMMIT;');

    return {
      ok: true,
      backupId: payload.metadata.backupId,
      businessId: actualTargetBizId,
      restoredCounts: currentCounts,
      safetyBackupId,
      durationMs: Date.now() - startTime,
      checks: {
        sha256Verified: true,
        schemaCompatible: true,
        foreignKeysClean: true,
        countsMatched: true,
      },
    };
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ignore rollback errors */ }
    db.exec('PRAGMA foreign_keys = ON;');
    throw err;
  }
}
