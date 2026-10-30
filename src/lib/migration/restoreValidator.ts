/**
 * Selwick POS – Safe Backup Restore Validation and Recovery Tooling.
 *
 * Verifies backup integrity, JSON format compliance, financial sanity,
 * and restore readiness before allowing any restore or migration operation.
 */

import { type DatabaseSync } from 'node:sqlite';
import { readBackupFile, calculateSha256 } from './backup';
import { normalizeMigrationPayload } from './migrationEngine';
import { toCents } from '@/lib/money';
import {
  type RestoreValidationResult,
  type QuarantinedRecord,
  type MigrationCollectionCounts,
} from './types';

export interface RestoreValidationOptions {
  filename?: string;
  rawJson?: string;
  parsedPayload?: unknown;
  expectedSha256?: string;
}

/**
 * Validates a backup file or payload for restore readiness without modifying any state.
 */
export function validateBackupForRestore(
  options: RestoreValidationOptions,
  db?: DatabaseSync,
): RestoreValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const quarantinedRecords: QuarantinedRecord[] = [];

  let content = '';
  let filename = options.filename;

  // 1. Load content
  if (filename) {
    try {
      const readRes = readBackupFile(filename);
      content = readRes.content;
      filename = readRes.filePath;
    } catch (err: unknown) {
      errors.push(`Failed to read backup file: ${err instanceof Error ? err.message : String(err)}`);
      return {
        valid: false,
        filename,
        sha256: '',
        totalRecords: 0,
        detectedFormat: 'unknown',
        businessId: 'unknown',
        errors,
        warnings,
        sourceCounts: { users: 0, categories: 0, products: 0, customers: 0, sales: 0, saleItems: 0, expenses: 0, heldSales: 0, settings: 0 },
        quarantinedRecords,
      };
    }
  } else if (typeof options.rawJson === 'string') {
    content = options.rawJson;
  } else if (options.parsedPayload && typeof options.parsedPayload === 'object') {
    content = JSON.stringify(options.parsedPayload);
  } else {
    errors.push('No backup filename, raw JSON, or parsed payload provided.');
    return {
      valid: false,
      sha256: '',
      totalRecords: 0,
      detectedFormat: 'unknown',
      businessId: 'unknown',
      errors,
      warnings,
      sourceCounts: { users: 0, categories: 0, products: 0, customers: 0, sales: 0, saleItems: 0, expenses: 0, heldSales: 0, settings: 0 },
      quarantinedRecords,
    };
  }

  // 2. SHA-256 Calculation & Integrity Check
  const sha256 = calculateSha256(content);
  if (options.expectedSha256 && options.expectedSha256 !== sha256) {
    errors.push(`Integrity verification failed: computed SHA-256 (${sha256}) does not match expected hash (${options.expectedSha256}).`);
  }

  // Check ledger if DB provided and filename present
  if (db && options.filename) {
    try {
      const stmt = db.prepare('SELECT sha256_hash, total_records FROM durable_backup_ledger WHERE filename = ? ORDER BY created_at DESC LIMIT 1');
      const ledgerEntry = stmt.get(options.filename) as { sha256_hash: string; total_records: number } | undefined;
      if (ledgerEntry && ledgerEntry.sha256_hash !== sha256) {
        errors.push(`Tampering detected: file content hash (${sha256}) differs from recorded ledger hash (${ledgerEntry.sha256_hash}).`);
      }
    } catch {
      // Ledger check is opportunistic
    }
  }

  // 3. JSON Parsing
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (err: unknown) {
    errors.push(`Invalid JSON syntax in backup content: ${err instanceof Error ? err.message : String(err)}`);
    return {
      valid: false,
      filename: options.filename,
      sha256,
      totalRecords: 0,
      detectedFormat: 'corrupt-json',
      businessId: 'unknown',
      errors,
      warnings,
      sourceCounts: { users: 0, categories: 0, products: 0, customers: 0, sales: 0, saleItems: 0, expenses: 0, heldSales: 0, settings: 0 },
      quarantinedRecords,
    };
  }

  // 4. Payload Normalization
  let normalizedPayload;
  try {
    normalizedPayload = normalizeMigrationPayload(parsedJson);
  } catch (err: unknown) {
    errors.push(`Payload normalization failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      valid: false,
      filename: options.filename,
      sha256,
      totalRecords: 0,
      detectedFormat: 'invalid-schema',
      businessId: 'unknown',
      errors,
      warnings,
      sourceCounts: { users: 0, categories: 0, products: 0, customers: 0, sales: 0, saleItems: 0, expenses: 0, heldSales: 0, settings: 0 },
      quarantinedRecords,
    };
  }

  const businessId = normalizedPayload.businessId;
  const sourceCounts: MigrationCollectionCounts = {
    users: normalizedPayload.users?.length || 0,
    categories: normalizedPayload.categories?.length || 0,
    products: normalizedPayload.products?.length || 0,
    customers: normalizedPayload.customers?.length || 0,
    sales: normalizedPayload.sales?.length || 0,
    saleItems: (normalizedPayload.sales || []).reduce((acc, s) => acc + (s.items?.length || 0), 0),
    expenses: normalizedPayload.expenses?.length || 0,
    heldSales: normalizedPayload.heldSales?.length || 0,
    settings: normalizedPayload.settings ? 1 : 0,
  };

  const totalRecords =
    sourceCounts.users +
    sourceCounts.categories +
    sourceCounts.products +
    sourceCounts.customers +
    sourceCounts.sales +
    sourceCounts.expenses +
    sourceCounts.heldSales +
    sourceCounts.settings;

  if (totalRecords === 0) {
    errors.push('Backup is empty: contains zero products, customers, sales, expenses, categories, or users.');
  }

  // 5. Dry-run Financial and Schema Validation
  // Validate products
  for (const p of normalizedPayload.products || []) {
    try {
      if (!p || typeof p !== 'object' || !p.name) throw new Error('Missing product name.');
      toCents(p.price, false, 'Product price');
      if (p.costPrice) toCents(p.costPrice, false, 'Product costPrice');
      if (typeof p.stock !== 'number' || !Number.isFinite(p.stock) || !Number.isInteger(p.stock)) {
        throw new Error(`Invalid stock quantity: ${p.stock}`);
      }
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'products',
        recordId: p?.id || 'unknown',
        record: p,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Validate customers
  for (const c of normalizedPayload.customers || []) {
    try {
      if (!c || typeof c !== 'object' || !c.name || !c.phone) throw new Error('Missing customer name or phone.');
      if (c.balance !== undefined) toCents(c.balance, true, 'Customer balance');
      if (c.totalSpent !== undefined) toCents(c.totalSpent, false, 'Customer totalSpent');
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'customers',
        recordId: c?.id || 'unknown',
        record: c,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Validate expenses
  for (const e of normalizedPayload.expenses || []) {
    try {
      if (!e || typeof e !== 'object' || !e.date || !e.amount) throw new Error('Missing expense date or amount.');
      const amountCents = toCents(e.amount, false, 'Expense amount');
      if (amountCents <= 0) throw new Error('Expense amount must be positive.');
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'expenses',
        recordId: e?.id || 'unknown',
        record: e,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Validate sales
  for (const s of normalizedPayload.sales || []) {
    try {
      if (!s || typeof s !== 'object' || !s.invoiceNumber) throw new Error('Missing sale invoiceNumber.');
      const subtotalCents = toCents(s.subtotal, false, 'Sale subtotal');
      const discountCents = toCents(s.discount || 0, false, 'Sale discount');
      const taxCents = toCents(s.tax || 0, false, 'Sale tax');
      const totalCents = toCents(s.total, false, 'Sale total');
      if (subtotalCents - discountCents + taxCents !== totalCents) {
        throw new Error(`Inconsistent sale totals: subtotal - discount + tax !== total.`);
      }
      for (const item of s.items || []) {
        if (!item || typeof item !== 'object' || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error('Invalid cart item quantity in sale.');
        }
      }
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'sales',
        recordId: s?.id || s?.invoiceNumber || 'unknown',
        record: s,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (quarantinedRecords.length > 0) {
    warnings.push(`Backup contains ${quarantinedRecords.length} malformed records that require quarantine.`);
  }

  return {
    valid: errors.length === 0,
    filename: options.filename,
    sha256,
    totalRecords,
    detectedFormat: normalizedPayload.format || 'selwick-localstorage-v1',
    businessId,
    errors,
    warnings,
    sourceCounts,
    quarantinedRecords,
  };
}
