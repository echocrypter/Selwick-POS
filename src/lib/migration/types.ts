/**
 * Selwick POS – Milestone 4 Migration, Backup, and Rollback Types.
 */

import { type OfflineMember } from '../offlineUsers.ts';
import { type Product, type Customer, type Sale, type HeldSale, type StoreSettings } from '../../types/pos.ts';

export interface ExpenseRecord {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
}

export interface CategoryRecord {
  id?: string;
  name: string;
  displayOrder?: number;
}

export interface MigrationSourcePayload {
  format?: string;
  businessId: string;
  businessName?: string;
  businessType?: string;
  users?: OfflineMember[];
  categories?: (string | CategoryRecord)[];
  products?: Product[];
  customers?: Customer[];
  expenses?: ExpenseRecord[];
  sales?: Sale[];
  heldSales?: HeldSale[];
  settings?: StoreSettings | Record<string, unknown>;
  rawLocalStorage?: Record<string, string>;
}

export interface RemappedInvoice {
  saleId: string;
  originalInvoice: string;
  remappedInvoice: string;
  reason: string;
}

export interface QuarantinedRecord {
  collection: 'products' | 'customers' | 'sales' | 'sale_items' | 'expenses' | 'users' | 'settings' | 'categories' | 'held_sales';
  recordId: string;
  record: unknown;
  reason: string;
}

export interface MigrationCollectionCounts {
  users: number;
  categories: number;
  products: number;
  customers: number;
  sales: number;
  saleItems: number;
  expenses: number;
  heldSales: number;
  settings: number;
}

export interface MigrationFinancialTotals {
  stockTotal: number;
  inventoryValueCents: number;
  salesTotalCents: number;
  customerBalancesCents: number;
  expenseTotalCents: number;
}

export interface MigrationConflictRecord {
  collection: string;
  recordId: string;
  field?: string;
  existingValue?: string;
  importedValue?: string;
  resolution: 'PRESERVED_SQLITE_RECORD' | 'REMAPPED' | 'SKIPPED';
  detail: string;
}

export interface MigrationVerificationReport {
  success: boolean;
  businessId: string;
  sourceCounts: MigrationCollectionCounts;
  migratedCounts: MigrationCollectionCounts;
  financialTotals: MigrationFinancialTotals;
  remappedInvoices: RemappedInvoice[];
  quarantinedRecords: QuarantinedRecord[];
  conflicts: MigrationConflictRecord[];
  checksums: {
    productsHash: string;
    customersHash: string;
    salesHash: string;
    overallHash: string;
  };
  migratedAt: string;
  idempotent: boolean;
}

export interface BackupLedgerEntry {
  id: string;
  business_id: string;
  filename: string;
  sha256_hash: string;
  total_records: number;
  created_at: string;
}

export interface BackupIntegrityResult {
  verified: boolean;
  backupId?: string;
  businessId?: string;
  filename: string;
  filePath: string;
  expectedSha256?: string;
  actualSha256: string;
  totalRecords?: number;
  error?: string;
}

export interface RestoreValidationResult {
  valid: boolean;
  filename?: string;
  sha256: string;
  totalRecords: number;
  detectedFormat: string;
  businessId: string;
  errors: string[];
  warnings: string[];
  sourceCounts: MigrationCollectionCounts;
  quarantinedRecords: QuarantinedRecord[];
}

export interface ReverseExportReport {
  success: boolean;
  businessId: string;
  payload: {
    format: 'selwick-localstorage-v1';
    exportedAt: string;
    sourceOrigin: string;
    app: 'selwick-pos';
    totalKeys: number;
    data: Record<string, string>;
  };
  exportedCounts: MigrationCollectionCounts;
  unrepresentableData: Array<{
    itemType: string;
    itemId: string;
    field: string;
    detail: string;
  }>;
}
