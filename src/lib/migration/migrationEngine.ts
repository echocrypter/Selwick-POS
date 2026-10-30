/**
 * Selwick POS – Defensive LocalStorage-to-SQLite Migration Engine.
 *
 * Implements strict transaction safety, financial validation (no silent coercion),
 * duplicate invoice conflict resolution, idempotency, and post-migration verification.
 */

import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { toCents } from '../money.ts';
import { type OfflineMember } from '../offlineUsers.ts';
import { type Product, type Customer, type Sale, type CartItem, type HeldSale, type StoreSettings } from '../../types/pos.ts';
import {
  type MigrationSourcePayload,
  type MigrationVerificationReport,
  type MigrationCollectionCounts,
  type MigrationFinancialTotals,
  type RemappedInvoice,
  type QuarantinedRecord,
  type ExpenseRecord,
  type CategoryRecord,
} from './types.ts';

export class MigrationError extends Error {
  readonly code: string;
  readonly quarantined: QuarantinedRecord[];

  constructor(code: string, message: string, quarantined: QuarantinedRecord[] = []) {
    super(`[MigrationError:${code}] ${message}`);
    this.name = 'MigrationError';
    this.code = code;
    this.quarantined = quarantined;
  }
}

export interface MigrationOptions {
  /**
   * If true, malformed records cause the migration to fail and rollback entirely.
   * If false and quarantineMalformed is true, malformed records are quarantined into the report.
   * Default: true
   */
  strict?: boolean;
  /**
   * If true, rather than aborting, malformed records are skipped and recorded in quarantinedRecords.
   * Default: false
   */
  quarantineMalformed?: boolean;
}

/**
 * Normalizes input from multiple backup representations (structured format or raw flat dictionary)
 * into a typed MigrationSourcePayload.
 */
export function normalizeMigrationPayload(
  rawInput: unknown,
  fallbackBusinessId = 'legacy-installation',
): MigrationSourcePayload {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new MigrationError('INVALID_INPUT', 'Migration input must be a non-null object.');
  }

  const inputObj = rawInput as Record<string, unknown>;
  let dataMap: Record<string, string> = {};

  // Case 1: Structured full backup payload (selwick-localstorage-v1)
  if (inputObj.format === 'selwick-localstorage-v1' && typeof inputObj.data === 'object' && inputObj.data !== null) {
    const rawData = inputObj.data as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawData)) {
      if (typeof v === 'string') dataMap[k] = v;
      else if (v !== null && v !== undefined) dataMap[k] = JSON.stringify(v);
    }
  } else if (inputObj.data && typeof inputObj.data === 'object' && !Array.isArray(inputObj.data)) {
    const rawData = inputObj.data as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawData)) {
      if (typeof v === 'string') dataMap[k] = v;
      else if (v !== null && v !== undefined) dataMap[k] = JSON.stringify(v);
    }
  } else {
    // Case 2: Flat dictionary of LocalStorage keys
    for (const [k, v] of Object.entries(inputObj)) {
      if (typeof v === 'string') dataMap[k] = v;
      else if (v !== null && v !== undefined) dataMap[k] = JSON.stringify(v);
    }
  }

  // Determine business ID: check scoped keys or fallback
  let detectedBusinessId = fallbackBusinessId;
  const businessKeyRegex = /^selwick_business:([^:]+):pos_/;
  for (const k of Object.keys(dataMap)) {
    const match = k.match(businessKeyRegex);
    if (match && match[1]) {
      detectedBusinessId = match[1];
      break;
    }
  }

  // Parse offline users
  const users: OfflineMember[] = [];
  const rawUsersStr = dataMap['selwick_offline_users_v1'] || dataMap['selwick_offline_staff_users'];
  if (rawUsersStr) {
    try {
      const parsedUsers = JSON.parse(rawUsersStr);
      if (Array.isArray(parsedUsers)) {
        for (const u of parsedUsers) {
          if (u && typeof u === 'object' && u.name && u.salt && u.hash) {
            users.push({
              id: String(u.id || crypto.randomUUID()),
              name: String(u.name).trim(),
              role: (['owner', 'manager', 'cashier'].includes(u.role) ? u.role : 'cashier') as OfflineMember['role'],
              salt: String(u.salt),
              hash: String(u.hash),
              businessId: u.businessId ? String(u.businessId) : detectedBusinessId,
            });
          }
        }
      }
    } catch {
      // Handled in validation
    }
  }

  // Parse scoped or unscoped arrays
  const getArrayFromData = <T>(keySuffix: string): T[] => {
    const scopedKey = `selwick_business:${detectedBusinessId}:${keySuffix}`;
    const rawStr = dataMap[scopedKey] || dataMap[keySuffix];
    if (!rawStr) return [];
    try {
      const parsed = JSON.parse(rawStr);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  };

  const getObjectFromData = <T>(keySuffix: string): T | undefined => {
    const scopedKey = `selwick_business:${detectedBusinessId}:${keySuffix}`;
    const rawStr = dataMap[scopedKey] || dataMap[keySuffix];
    if (!rawStr) return undefined;
    try {
      const parsed = JSON.parse(rawStr);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? (parsed as T) : undefined;
    } catch {
      return undefined;
    }
  };

  const products = getArrayFromData<Product>('pos_products');
  const customers = getArrayFromData<Customer>('pos_customers');
  const sales = getArrayFromData<Sale>('pos_sales');
  const expenses = getArrayFromData<ExpenseRecord>('pos_expenses');
  const heldSales = getArrayFromData<HeldSale>('pos_held');
  const categories = getArrayFromData<string | CategoryRecord>('pos_categories');
  const settings = getObjectFromData<StoreSettings>('pos_settings');

  // Business Type
  const businessType = dataMap[`selwick_business:${detectedBusinessId}:selwick_offline_business_type`] ||
    dataMap['selwick_offline_business_type'] || 'retail';

  return {
    format: typeof inputObj.format === 'string' ? inputObj.format : 'selwick-localstorage-v1',
    businessId: detectedBusinessId,
    businessType,
    users,
    categories,
    products,
    customers,
    expenses,
    sales,
    heldSales,
    settings,
    rawLocalStorage: dataMap,
  };
}

/**
 * Executes defensive, transactional LocalStorage-to-SQLite migration.
 */
export function migrateLocalStorageToSqlite(
  db: DatabaseSync,
  rawPayload: unknown,
  options: MigrationOptions = {},
): MigrationVerificationReport {
  const strict = options.strict ?? true;
  const quarantineMalformed = options.quarantineMalformed ?? false;

  const payload = normalizeMigrationPayload(rawPayload);
  const businessId = payload.businessId;
  const quarantinedRecords: QuarantinedRecord[] = [];
  const remappedInvoices: RemappedInvoice[] = [];

  const sourceCounts: MigrationCollectionCounts = {
    users: payload.users?.length || 0,
    categories: payload.categories?.length || 0,
    products: payload.products?.length || 0,
    customers: payload.customers?.length || 0,
    sales: payload.sales?.length || 0,
    saleItems: (payload.sales || []).reduce((acc, s) => acc + (s.items?.length || 0), 0),
    expenses: payload.expenses?.length || 0,
    heldSales: payload.heldSales?.length || 0,
    settings: payload.settings ? 1 : 0,
  };

  // ── Pre-Transaction Validation & Financial Inspection ─────────────────────────
  const validProducts: Array<{
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    category: string;
    priceCents: number;
    costPriceCents: number;
    stock: number;
    minStockAlert: number;
    description: string | null;
    badge: string | null;
    iconType: string;
  }> = [];

  for (const p of payload.products || []) {
    try {
      if (!p || typeof p !== 'object' || !p.name) {
        throw new Error('Missing product name or invalid object.');
      }
      const priceCents = toCents(p.price, false, 'Product price');
      const costPriceCents = toCents(p.costPrice || 0, false, 'Product costPrice');
      
      if (typeof p.stock !== 'number' || !Number.isFinite(p.stock) || !Number.isInteger(p.stock)) {
        throw new Error(`Invalid product stock: "${p.stock}". Must be a finite integer.`);
      }

      validProducts.push({
        id: p.id || crypto.randomUUID(),
        name: String(p.name).trim(),
        sku: p.sku ? String(p.sku).trim() : null,
        barcode: p.barcode ? String(p.barcode).trim() : null,
        category: p.category ? String(p.category).trim() : 'General',
        priceCents,
        costPriceCents,
        stock: p.stock,
        minStockAlert: typeof p.minStockAlert === 'number' && Number.isFinite(p.minStockAlert) ? p.minStockAlert : 5,
        description: p.description ? String(p.description) : null,
        badge: p.badge ? String(p.badge) : null,
        iconType: p.iconType ? String(p.iconType) : 'other',
      });
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'products',
        recordId: p?.id || 'unknown',
        record: p,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const validCustomers: Array<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    balanceCents: number;
    loyaltyPoints: number;
    totalOrders: number;
    totalSpentCents: number;
    createdAt: string;
  }> = [];

  for (const c of payload.customers || []) {
    try {
      if (!c || typeof c !== 'object' || !c.name || !c.phone) {
        throw new Error('Customer requires valid name and phone.');
      }
      const balanceCents = toCents(c.balance || 0, true, 'Customer balance');
      const totalSpentCents = toCents(c.totalSpent || 0, false, 'Customer totalSpent');

      validCustomers.push({
        id: c.id || crypto.randomUUID(),
        name: String(c.name).trim(),
        phone: String(c.phone).trim(),
        email: c.email ? String(c.email).trim() : null,
        address: c.address ? String(c.address).trim() : null,
        balanceCents,
        loyaltyPoints: typeof c.loyaltyPoints === 'number' ? Math.max(0, Math.floor(c.loyaltyPoints)) : 0,
        totalOrders: typeof c.totalOrders === 'number' ? Math.max(0, Math.floor(c.totalOrders)) : 0,
        totalSpentCents,
        createdAt: c.createdAt || new Date().toISOString(),
      });
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'customers',
        recordId: c?.id || 'unknown',
        record: c,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const validExpenses: Array<{
    id: string;
    date: string;
    category: string;
    description: string;
    amountCents: number;
  }> = [];

  for (const e of payload.expenses || []) {
    try {
      if (!e || typeof e !== 'object' || !e.date || !e.category || !e.description) {
        throw new Error('Expense requires date, category, and description.');
      }
      const amountCents = toCents(e.amount, false, 'Expense amount');
      if (amountCents <= 0) {
        throw new Error('Expense amount must be strictly positive.');
      }
      validExpenses.push({
        id: e.id || crypto.randomUUID(),
        date: String(e.date),
        category: String(e.category).trim(),
        description: String(e.description).trim(),
        amountCents,
      });
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'expenses',
        recordId: e?.id || 'unknown',
        record: e,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const validSales: Array<{
    id: string;
    invoiceNumber: string;
    timestamp: string;
    dateStr: string;
    subtotalCents: number;
    discountCents: number;
    discountType: 'fixed' | 'percent';
    taxCents: number;
    totalCents: number;
    paymentMethod: string;
    amountTenderedCents: number;
    changeDueCents: number;
    customerId: string | null;
    customerName: string;
    customerPhone: string | null;
    notes: string | null;
    terminalId: string;
    status: 'completed' | 'refunded' | 'cancelled';
    items: Array<{
      id: string;
      productId: string | null;
      productName: string;
      productSku: string | null;
      productBarcode: string | null;
      category: string | null;
      quantity: number;
      priceCents: number;
      costPriceCents: number;
      discountCents: number;
      customPriceCents: number | null;
    }>;
  }> = [];

  for (const s of payload.sales || []) {
    try {
      if (!s || typeof s !== 'object' || !s.invoiceNumber) {
        throw new Error('Sale missing invoiceNumber or invalid structure.');
      }
      const subtotalCents = toCents(s.subtotal, false, 'Sale subtotal');
      const discountCents = toCents(s.discount || 0, false, 'Sale discount');
      const taxCents = toCents(s.tax || 0, false, 'Sale tax');
      const totalCents = toCents(s.total, false, 'Sale total');
      const amountTenderedCents = toCents(s.amountTendered || 0, false, 'Sale amountTendered');
      const changeDueCents = toCents(s.changeDue || 0, false, 'Sale changeDue');

      // Strict mathematical invariant check
      const expectedTotal = subtotalCents - discountCents + taxCents;
      if (expectedTotal !== totalCents) {
        throw new Error(`Inconsistent sale totals: subtotal(${subtotalCents}) - discount(${discountCents}) + tax(${taxCents}) !== total(${totalCents}). Expected ${expectedTotal}.`);
      }

      if (!s.status || typeof s.status !== 'string' || !['completed', 'refunded', 'cancelled'].includes(s.status)) {
        throw new Error(`Unsupported, missing, or malformed sale status "${s.status}". Allowed historical statuses are: completed, refunded, cancelled.`);
      }
      const status = s.status as 'completed' | 'refunded' | 'cancelled';

      const validItems: typeof validSales[0]['items'] = [];
      for (const item of (s.items || []) as CartItem[]) {
        if (!item || typeof item !== 'object') {
          throw new Error('Malformed cart item in sale.');
        }
        if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
          throw new Error(`Invalid item quantity: "${item.quantity}". Must be positive integer.`);
        }
        const itemPrice = item.customPrice ?? item.product?.price ?? 0;
        const itemPriceCents = toCents(itemPrice, false, 'Item price');
        const itemCostPriceCents = toCents(item.product?.costPrice || 0, false, 'Item costPrice');
        const itemDiscountCents = toCents(item.discount || 0, false, 'Item discount');
        const customPriceCents = item.customPrice !== undefined ? toCents(item.customPrice, false, 'Custom price') : null;

        validItems.push({
          id: crypto.randomUUID(),
          productId: item.product?.id || null,
          productName: item.product?.name ? String(item.product.name).trim() : 'Unnamed Item',
          productSku: item.product?.sku || null,
          productBarcode: item.product?.barcode || null,
          category: item.product?.category || null,
          quantity: item.quantity,
          priceCents: itemPriceCents,
          costPriceCents: itemCostPriceCents,
          discountCents: itemDiscountCents,
          customPriceCents,
        });
      }

      validSales.push({
        id: s.id || crypto.randomUUID(),
        invoiceNumber: String(s.invoiceNumber).trim(),
        timestamp: s.timestamp || new Date().toISOString(),
        dateStr: s.dateStr || (s.timestamp ? s.timestamp.split('T')[0] : new Date().toISOString().split('T')[0]),
        subtotalCents,
        discountCents,
        discountType: s.discountType === 'percent' ? 'percent' : 'fixed',
        taxCents,
        totalCents,
        paymentMethod: s.paymentMethod ? String(s.paymentMethod) : 'cash',
        amountTenderedCents,
        changeDueCents,
        customerId: s.customerId || null,
        customerName: s.customerName ? String(s.customerName).trim() : 'Walk-in Customer',
        customerPhone: s.customerPhone ? String(s.customerPhone).trim() : null,
        notes: s.notes ? String(s.notes) : null,
        terminalId: s.terminalId ? String(s.terminalId) : 'terminal-1',
        status,
        items: validItems,
      });
    } catch (err: unknown) {
      quarantinedRecords.push({
        collection: 'sales',
        recordId: s?.id || s?.invoiceNumber || 'unknown',
        record: s,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Check strict quarantine guard
  if (strict && !quarantineMalformed && quarantinedRecords.length > 0) {
    throw new MigrationError(
      'MALFORMED_FINANCIAL_RECORDS',
      `Migration rejected: found ${quarantinedRecords.length} malformed financial records. Aborting transaction to prevent corrupt data import.`,
      quarantinedRecords,
    );
  }

  const conflicts: import('./types').MigrationConflictRecord[] = [];

  // ── Database Transaction ──────────────────────────────────────────────────────
  db.exec('BEGIN IMMEDIATE');

  try {
    // 1. Business Record
    const checkBizStmt = db.prepare('SELECT id FROM businesses WHERE id = ?');
    const existingBiz = checkBizStmt.get(businessId);
    if (!existingBiz) {
      const insBizStmt = db.prepare(`
        INSERT INTO businesses (id, name, business_type, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      insBizStmt.run(businessId, payload.businessName || 'Selwick Retail', payload.businessType || 'retail');
    }

    // 2. Offline Staff Users (Preserving existing PBKDF2 salt and hash, without overwriting newer SQLite credentials)
    const checkUserStmt = db.prepare('SELECT id, name, role, salt, hash FROM users WHERE id = ?');
    const insUserStmt = db.prepare(`
      INSERT INTO users (id, business_id, name, role, salt, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const u of payload.users || []) {
      const existingUser = checkUserStmt.get(u.id) as { id: string; name: string; role: string; salt: string; hash: string } | undefined;
      if (existingUser) {
        if (existingUser.name !== u.name || existingUser.role !== u.role || existingUser.salt !== u.salt || existingUser.hash !== u.hash) {
          conflicts.push({
            collection: 'users',
            recordId: u.id,
            detail: `User "${u.name}" (${u.id}) has different credentials/role in SQLite. Preserved existing SQLite record without overwrite.`,
            resolution: 'PRESERVED_SQLITE_RECORD',
          });
        }
      } else {
        insUserStmt.run(u.id, businessId, u.name, u.role, u.salt, u.hash);
      }
    }

    // 3. Categories
    const insCatStmt = db.prepare(`
      INSERT INTO categories (id, business_id, name, display_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(business_id, name) DO NOTHING
    `);
    let catIndex = 0;
    for (const cat of payload.categories || []) {
      const catName = typeof cat === 'string' ? cat.trim() : cat.name.trim();
      const catId = (typeof cat === 'object' && cat.id) ? cat.id : crypto.randomUUID();
      const order = (typeof cat === 'object' && typeof cat.displayOrder === 'number') ? cat.displayOrder : catIndex;
      if (catName) {
        insCatStmt.run(catId, businessId, catName, order);
        catIndex++;
      }
    }

    // 4. Products (Idempotent insertion without overwriting newer SQLite edits)
    const insProdStmt = db.prepare(`
      INSERT INTO products (
        id, business_id, name, sku, barcode, category, price_cents,
        cost_price_cents, stock, min_stock_alert, description, badge,
        icon_type, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const p of validProducts) {
      insProdStmt.run(
        p.id,
        businessId,
        p.name,
        p.sku,
        p.barcode,
        p.category,
        p.priceCents,
        p.costPriceCents,
        p.stock,
        p.minStockAlert,
        p.description,
        p.badge,
        p.iconType,
      );
    }

    // 5. Customers
    const insCustStmt = db.prepare(`
      INSERT INTO customers (
        id, business_id, name, phone, email, address, balance_cents,
        loyalty_points, total_orders, total_spent_cents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const c of validCustomers) {
      insCustStmt.run(
        c.id,
        businessId,
        c.name,
        c.phone,
        c.email,
        c.address,
        c.balanceCents,
        c.loyaltyPoints,
        c.totalOrders,
        c.totalSpentCents,
        c.createdAt,
      );
    }

    // 6. Expenses
    const insExpStmt = db.prepare(`
      INSERT INTO expenses (id, business_id, date, category, description, amount_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const e of validExpenses) {
      insExpStmt.run(e.id, businessId, e.date, e.category, e.description, e.amountCents);
    }

    // 7. Sales & Sale Items (With Duplicate Invoice Handling and Remapping)
    const checkInvoiceStmt = db.prepare(`
      SELECT id, business_id, total_cents FROM sales WHERE invoice_number = ?
    `);
    const checkSaleIdStmt = db.prepare(`
      SELECT id FROM sales WHERE id = ?
    `);

    const insSaleStmt = db.prepare(`
      INSERT INTO sales (
        id, business_id, invoice_number, timestamp, date_str, subtotal_cents,
        discount_cents, discount_type, tax_cents, total_cents, payment_method,
        amount_tendered_cents, change_due_cents, customer_id, customer_name,
        customer_phone, notes, terminal_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insSaleItemStmt = db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, product_name, product_sku, product_barcode,
        category, quantity, price_cents, cost_price_cents, discount_cents, custom_price_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of validSales) {
      const existingSaleById = checkSaleIdStmt.get(s.id);
      if (existingSaleById) {
        continue;
      }

      let finalInvoice = s.invoiceNumber;
      let finalNotes = s.notes;

      const conflictingSale = checkInvoiceStmt.get(s.invoiceNumber) as { id: string; business_id: string; total_cents: number } | undefined;
      if (conflictingSale) {
        if (conflictingSale.id === s.id && conflictingSale.business_id === businessId) {
          continue;
        }

        const shortHash = crypto.randomUUID().slice(0, 6).toUpperCase();
        finalInvoice = `${s.invoiceNumber}_MIG_${shortHash}`;
        finalNotes = s.notes
          ? `${s.notes}\n[Migrated: Original Invoice #${s.invoiceNumber}]`
          : `[Migrated: Original Invoice #${s.invoiceNumber}]`;

        remappedInvoices.push({
          saleId: s.id,
          originalInvoice: s.invoiceNumber,
          remappedInvoice: finalInvoice,
          reason: `Invoice number "${s.invoiceNumber}" already exists in SQLite table sales for sale ID "${conflictingSale.id}".`,
        });
      }

      insSaleStmt.run(
        s.id,
        businessId,
        finalInvoice,
        s.timestamp,
        s.dateStr,
        s.subtotalCents,
        s.discountCents,
        s.discountType,
        s.taxCents,
        s.totalCents,
        s.paymentMethod,
        s.amountTenderedCents,
        s.changeDueCents,
        s.customerId,
        s.customerName,
        s.customerPhone,
        finalNotes,
        s.terminalId,
        s.status,
      );

      for (const item of s.items) {
        insSaleItemStmt.run(
          item.id,
          s.id,
          item.productId,
          item.productName,
          item.productSku,
          item.productBarcode,
          item.category,
          item.quantity,
          item.priceCents,
          item.costPriceCents,
          item.discountCents,
          item.customPriceCents,
        );
      }
    }

    // 8. Held Sales
    const insHeldStmt = db.prepare(`
      INSERT INTO held_sales (
        id, business_id, invoice_number, date_str, timestamp, customer_json, note, items_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const h of payload.heldSales || []) {
      if (h && typeof h === 'object' && h.invoiceNumber) {
        insHeldStmt.run(
          h.id || crypto.randomUUID(),
          businessId,
          h.invoiceNumber,
          h.dateStr || new Date().toISOString().split('T')[0],
          typeof h.timestamp === 'number' ? h.timestamp : Date.now(),
          h.customer ? JSON.stringify(h.customer) : null,
          h.note || null,
          JSON.stringify(h.items || []),
        );
      }
    }

    // 9. Store Settings (Key-Value, preserving newer SQLite settings)
    if (payload.settings && typeof payload.settings === 'object') {
      const checkSettingStmt = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?');
      const insSetStmt = db.prepare(`
        INSERT INTO settings (business_id, key, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(business_id, key) DO NOTHING
      `);
      for (const [k, v] of Object.entries(payload.settings)) {
        if (v !== undefined) {
          const serialized = typeof v === 'string' ? v : JSON.stringify(v);
          const existingSetting = checkSettingStmt.get(businessId, k) as { value: string } | undefined;
          if (existingSetting) {
            if (existingSetting.value !== serialized) {
              conflicts.push({
                collection: 'settings',
                recordId: k,
                existingValue: existingSetting.value,
                importedValue: serialized,
                resolution: 'PRESERVED_SQLITE_RECORD',
                detail: `Setting "${k}" already exists in SQLite with value "${existingSetting.value}". Preserved existing SQLite record without overwrite.`,
              });
            }
          } else {
            insSetStmt.run(businessId, k, serialized);
          }
        }
      }
    }

    // ── Pre-Commit Migration Verification & Financial Auditing ──────────────────
    // All verification checks MUST execute INSIDE the transaction before COMMIT.
    const countRow = (sql: string, ...args: unknown[]) => {
      const row = db.prepare(sql).get(...args) as { count: number };
      return row ? Number(row.count) : 0;
    };

    const sumRow = (sql: string, ...args: unknown[]) => {
      const row = db.prepare(sql).get(...args) as { sum: number | null };
      return row && row.sum !== null ? Number(row.sum) : 0;
    };

    const migratedCounts: MigrationCollectionCounts = {
      users: countRow('SELECT count(*) as count FROM users WHERE business_id = ?', businessId),
      categories: countRow('SELECT count(*) as count FROM categories WHERE business_id = ?', businessId),
      products: countRow('SELECT count(*) as count FROM products WHERE business_id = ?', businessId),
      customers: countRow('SELECT count(*) as count FROM customers WHERE business_id = ?', businessId),
      sales: countRow('SELECT count(*) as count FROM sales WHERE business_id = ?', businessId),
      saleItems: countRow('SELECT count(*) as count FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.business_id = ?', businessId),
      expenses: countRow('SELECT count(*) as count FROM expenses WHERE business_id = ?', businessId),
      heldSales: countRow('SELECT count(*) as count FROM held_sales WHERE business_id = ?', businessId),
      settings: countRow('SELECT count(*) as count FROM settings WHERE business_id = ?', businessId),
    };

    // Strict Count & Invariant Assertions before commit
    if (strict) {
      if (migratedCounts.sales < validSales.length) {
        throw new MigrationError(
          'VERIFICATION_FAILURE',
          `Sales count verification failed: expected at least ${validSales.length} sales in SQLite, found ${migratedCounts.sales}.`,
        );
      }
      if (migratedCounts.products < validProducts.length) {
        throw new MigrationError(
          'VERIFICATION_FAILURE',
          `Products count verification failed: expected at least ${validProducts.length} products in SQLite, found ${migratedCounts.products}.`,
        );
      }
      if (migratedCounts.customers < validCustomers.length) {
        throw new MigrationError(
          'VERIFICATION_FAILURE',
          `Customers count verification failed: expected at least ${validCustomers.length} customers in SQLite, found ${migratedCounts.customers}.`,
        );
      }
      if (migratedCounts.expenses < validExpenses.length) {
        throw new MigrationError(
          'VERIFICATION_FAILURE',
          `Expenses count verification failed: expected at least ${validExpenses.length} expenses in SQLite, found ${migratedCounts.expenses}.`,
        );
      }
      if (migratedCounts.categories < (payload.categories?.length || 0)) {
        throw new MigrationError(
          'VERIFICATION_FAILURE',
          `Categories count verification failed: expected at least ${payload.categories?.length || 0} categories in SQLite, found ${migratedCounts.categories}.`,
        );
      }
    }

    const stockTotal = sumRow('SELECT sum(stock) as sum FROM products WHERE business_id = ?', businessId);
    const inventoryValueCents = sumRow('SELECT sum(price_cents * stock) as sum FROM products WHERE business_id = ?', businessId);
    const salesTotalCents = sumRow('SELECT sum(total_cents) as sum FROM sales WHERE business_id = ?', businessId);
    const customerBalancesCents = sumRow('SELECT sum(balance_cents) as sum FROM customers WHERE business_id = ?', businessId);
    const expenseTotalCents = sumRow('SELECT sum(amount_cents) as sum FROM expenses WHERE business_id = ?', businessId);

    const financialTotals: MigrationFinancialTotals = {
      stockTotal,
      inventoryValueCents,
      salesTotalCents,
      customerBalancesCents,
      expenseTotalCents,
    };

    // Checksums
    const productsRows = db.prepare('SELECT id, price_cents, stock FROM products WHERE business_id = ? ORDER BY id').all(businessId);
    const productsHash = crypto.createHash('sha256').update(JSON.stringify(productsRows)).digest('hex');

    const customersRows = db.prepare('SELECT id, balance_cents FROM customers WHERE business_id = ? ORDER BY id').all(businessId);
    const customersHash = crypto.createHash('sha256').update(JSON.stringify(customersRows)).digest('hex');

    const salesRows = db.prepare('SELECT id, invoice_number, total_cents FROM sales WHERE business_id = ? ORDER BY id').all(businessId);
    const salesHash = crypto.createHash('sha256').update(JSON.stringify(salesRows)).digest('hex');

    const overallHash = crypto.createHash('sha256')
      .update(productsHash + customersHash + salesHash)
      .digest('hex');

    // ALL VERIFICATIONS PASSED — COMMIT TRANSACTION NOW
    db.exec('COMMIT');

    return {
      success: true,
      businessId,
      sourceCounts,
      migratedCounts,
      financialTotals,
      remappedInvoices,
      quarantinedRecords,
      conflicts,
      checksums: {
        productsHash,
        customersHash,
        salesHash,
        overallHash,
      },
      migratedAt: new Date().toISOString(),
      idempotent: true,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
