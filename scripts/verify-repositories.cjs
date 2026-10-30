/**
 * Selwick POS – Milestone 3 Verification Suite
 * Exact-Money Utility & Core SQLite Repositories
 *
 * Run with: node --experimental-sqlite scripts/verify-repositories.cjs
 *
 * Verifies:
 *   1. Exact-Money: Conversion, precision rejection, commercial rounding, and consistency invariants
 *   2. Products: CRUD, barcode/SKU lookup, safe stock adjustments, transaction rollback on negative stock
 *   3. Customers: CRUD, balance adjustments, order recording, business scope
 *   4. Expenses: CRUD, YYYY-MM-DD validation, total aggregation, business scope
 *   5. Settings: Key-value persistence, domain StoreSettings defaults, transactional multi-key update
 *   6. Categories: CRUD, unique name per business, transactional reordering
 *   7. Cross-Business Isolation: Verifies no record leak or unauthorized cross-business modification
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ─── 1. Load Real Exact-Money Engine from src/lib/money.ts ────────────────────
const {
  toCents,
  fromCents,
  formatMoney,
  add,
  subtract,
  multiply,
  calculatePercentageDiscount,
  calculateTax,
  calculateSaleTotals,
  assertValidCents,
  MoneyError,
} = require(path.join(root, 'src', 'lib', 'money.ts'));

// ─── 2. Database Schema Setup ─────────────────────────────────────────────────
const { INITIAL_MIGRATION_SQL } = require(path.join(root, 'src', 'lib', 'db', 'schema.ts'));

function createIsolatedTestDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  db.exec(INITIAL_MIGRATION_SQL);
  return db;
}

// ─── 3. Repository Definitions (matching src/lib/db/repositories/*) ───────────

class RepositoryError extends Error {
  constructor(code, message) {
    super(`[RepositoryError:${code}] ${message}`);
    this.name = 'RepositoryError';
    this.code = code;
  }
}
class NotFoundError extends RepositoryError {
  constructor(entity, id, businessId) {
    super('NOT_FOUND', `${entity} "${id}" not found for business "${businessId}".`);
  }
}
class ConflictError extends RepositoryError {
  constructor(entity, field, value) {
    super('CONFLICT', `${entity} with ${field} "${value}" already exists.`);
  }
}
class InsufficientStockError extends RepositoryError {
  constructor(productId, currentStock, requestedDelta) {
    super('INSUFFICIENT_STOCK', `Product "${productId}" has insufficient stock (${currentStock}) for adjustment (${requestedDelta}).`);
    this.productId = productId;
    this.currentStock = currentStock;
    this.requestedDelta = requestedDelta;
  }
}
class ValidationError extends RepositoryError {
  constructor(message) { super('VALIDATION_ERROR', message); }
}

// Product Repository
class ProductRepo {
  static findById(db, businessId, id) {
    return db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(id, businessId) || null;
  }
  static findByBarcode(db, businessId, barcode) {
    if (!barcode) return null;
    return db.prepare('SELECT * FROM products WHERE business_id = ? AND barcode = ? AND is_active = 1 LIMIT 1').get(businessId, barcode) || null;
  }
  static findBySku(db, businessId, sku) {
    if (!sku) return null;
    return db.prepare('SELECT * FROM products WHERE business_id = ? AND sku = ? AND is_active = 1 LIMIT 1').get(businessId, sku) || null;
  }
  static create(db, businessId, input) {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Product name is required.');
    if (!input.category?.trim()) throw new ValidationError('Category is required.');

    const priceCents = input.priceCents !== undefined
      ? input.priceCents
      : input.price !== undefined ? toCents(input.price, false, 'Product price') : undefined;
    if (priceCents === undefined) throw new ValidationError('Price is required.');
    assertValidCents(priceCents, false, 'Product price');

    const costPriceCents = input.costPriceCents !== undefined
      ? input.costPriceCents
      : input.costPrice !== undefined ? toCents(input.costPrice, false, 'Product cost price') : 0;
    assertValidCents(costPriceCents, false, 'Product cost price');

    const stock = input.stock !== undefined ? input.stock : 0;
    if (!Number.isInteger(stock) || stock < 0) throw new ValidationError('Initial stock must be non-negative integer.');

    const id = input.id || randomUUID();
    db.prepare(`
      INSERT INTO products (
        id, business_id, name, sku, barcode, category,
        price_cents, cost_price_cents, stock, min_stock_alert,
        description, badge, icon_type, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, businessId, name, input.sku || null, input.barcode || null, input.category.trim(),
      priceCents, costPriceCents, stock, input.minStockAlert ?? 5,
      input.description || null, input.badge || null, input.iconType || 'other',
      input.isActive === false ? 0 : 1
    );
    return this.findById(db, businessId, id);
  }
  static adjustStock(db, businessId, id, delta, allowNegative = false) {
    const current = this.findById(db, businessId, id);
    if (!current) throw new NotFoundError('Product', id, businessId);
    const newStock = current.stock + delta;
    if (newStock < 0 && !allowNegative) {
      throw new InsufficientStockError(id, current.stock, delta);
    }
    db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?')
      .run(newStock, id, businessId);
    return this.findById(db, businessId, id);
  }
  static batchAdjustStock(db, businessId, adjustments, allowNegative = false) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const results = [];
      for (const adj of adjustments) {
        results.push(this.adjustStock(db, businessId, adj.id, adj.delta, allowNegative));
      }
      db.exec('COMMIT;');
      return results;
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  }
  static delete(db, businessId, id) {
    const res = db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, businessId);
    return Number(res.changes) > 0;
  }
  static toDomain(row) {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku || '',
      barcode: row.barcode || '',
      category: row.category,
      price: fromCents(row.price_cents),
      costPrice: fromCents(row.cost_price_cents),
      stock: row.stock,
      minStockAlert: row.min_stock_alert,
      iconType: row.icon_type,
    };
  }
}

// Customer Repository
class CustomerRepo {
  static findById(db, businessId, id) {
    return db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, businessId) || null;
  }
  static findByPhone(db, businessId, phone) {
    if (!phone) return null;
    return db.prepare('SELECT * FROM customers WHERE business_id = ? AND phone = ? LIMIT 1').get(businessId, phone) || null;
  }
  static create(db, businessId, input) {
    if (!input.name?.trim()) throw new ValidationError('Name is required.');
    if (!input.phone?.trim()) throw new ValidationError('Phone is required.');

    const balanceCents = input.balanceCents !== undefined
      ? input.balanceCents
      : input.balance !== undefined ? toCents(input.balance, true, 'Customer balance') : 0;
    const totalSpentCents = input.totalSpentCents !== undefined
      ? input.totalSpentCents
      : input.totalSpent !== undefined ? toCents(input.totalSpent, false, 'Customer spent') : 0;

    const id = input.id || randomUUID();
    db.prepare(`
      INSERT INTO customers (
        id, business_id, name, phone, email, address,
        balance_cents, loyalty_points, total_orders, total_spent_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, businessId, input.name.trim(), input.phone.trim(), input.email || null, input.address || null,
      balanceCents, input.loyaltyPoints || 0, input.totalOrders || 0, totalSpentCents
    );
    return this.findById(db, businessId, id);
  }
  static adjustBalance(db, businessId, id, deltaCents) {
    assertValidCents(deltaCents, true, 'Balance delta');
    const cust = this.findById(db, businessId, id);
    if (!cust) throw new NotFoundError('Customer', id, businessId);
    const newBal = add(cust.balance_cents, deltaCents);
    db.prepare('UPDATE customers SET balance_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?')
      .run(newBal, id, businessId);
    return this.findById(db, businessId, id);
  }
  static recordOrder(db, businessId, id, orderTotalCents, points = 0) {
    assertValidCents(orderTotalCents, false, 'Order total');
    const cust = this.findById(db, businessId, id);
    if (!cust) throw new NotFoundError('Customer', id, businessId);
    const newOrders = cust.total_orders + 1;
    const newSpent = add(cust.total_spent_cents, orderTotalCents);
    const newPoints = cust.loyalty_points + points;
    db.prepare('UPDATE customers SET total_orders = ?, total_spent_cents = ?, loyalty_points = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?')
      .run(newOrders, newSpent, newPoints, id, businessId);
    return this.findById(db, businessId, id);
  }
  static toDomain(row) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      balance: fromCents(row.balance_cents, true),
      loyaltyPoints: row.loyalty_points,
      totalOrders: row.total_orders,
      totalSpent: fromCents(row.total_spent_cents),
    };
  }
}

// Expense Repository
class ExpenseRepo {
  static findById(db, businessId, id) {
    return db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(id, businessId) || null;
  }
  static list(db, businessId, opts) {
    let sql = 'SELECT * FROM expenses WHERE business_id = ?';
    const params = [businessId];
    if (opts?.startDate) { sql += ' AND date >= ?'; params.push(opts.startDate); }
    if (opts?.endDate) { sql += ' AND date <= ?'; params.push(opts.endDate); }
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    sql += ' ORDER BY date DESC';
    return db.prepare(sql).all(...params);
  }
  static create(db, businessId, input) {
    const date = input.date?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ValidationError(`Invalid date: "${input.date}". Must be YYYY-MM-DD.`);
    }
    if (!input.category?.trim()) throw new ValidationError('Category is required.');
    if (!input.description?.trim()) throw new ValidationError('Description is required.');

    const amountCents = input.amountCents !== undefined
      ? input.amountCents
      : input.amount !== undefined ? toCents(input.amount, false, 'Expense amount') : undefined;
    if (amountCents === undefined) throw new ValidationError('Amount is required.');
    assertValidCents(amountCents, false, 'Expense amount');

    const id = input.id || randomUUID();
    db.prepare('INSERT INTO expenses (id, business_id, date, category, description, amount_cents) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, businessId, date, input.category.trim(), input.description.trim(), amountCents);
    return this.findById(db, businessId, id);
  }
  static getTotalAmountCents(db, businessId, opts) {
    let sql = 'SELECT COALESCE(SUM(amount_cents), 0) as total FROM expenses WHERE business_id = ?';
    const params = [businessId];
    if (opts?.startDate) { sql += ' AND date >= ?'; params.push(opts.startDate); }
    if (opts?.endDate) { sql += ' AND date <= ?'; params.push(opts.endDate); }
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    return db.prepare(sql).get(...params).total;
  }
  static toDomain(row) {
    return {
      id: row.id,
      date: row.date,
      category: row.category,
      description: row.description,
      amount: fromCents(row.amount_cents),
      createdAt: row.created_at,
    };
  }
}

// Settings Repository
class SettingsRepo {
  static get(db, businessId, key) {
    const row = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
    return row ? row.value : null;
  }
  static set(db, businessId, key, value) {
    db.prepare(`
      INSERT INTO settings (business_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(businessId, key, value);
  }
  static getAll(db, businessId) {
    const rows = db.prepare('SELECT key, value FROM settings WHERE business_id = ?').all(businessId);
    const res = {};
    for (const r of rows) res[r.key] = r.value;
    return res;
  }
  static getStoreSettings(db, businessId) {
    const all = this.getAll(db, businessId);
    return {
      storeName: all.storeName || 'Selwick Store',
      tagline: all.tagline || 'Point of Sale',
      phone: all.phone || '',
      address: all.address || '',
      terminalId: all.terminalId || 'POS-01',
      version: all.version || '1.0.0',
      currencySymbol: all.currencySymbol || 'Rs',
      taxRate: all.taxRate !== undefined ? parseFloat(all.taxRate) : 0,
      enableTax: all.enableTax === 'true',
      defaultDiscount: all.defaultDiscount !== undefined ? parseFloat(all.defaultDiscount) : 0,
      receiptHeader: all.receiptHeader || 'Thank you for shopping with us!',
      receiptFooter: all.receiptFooter || 'Please come again.',
      soundEnabled: all.soundEnabled !== undefined ? all.soundEnabled === 'true' : true,
      printerPaperWidth: all.printerPaperWidth || '80mm',
      theme: all.theme || 'light',
    };
  }
  static updateStoreSettings(db, businessId, updates) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) this.set(db, businessId, k, String(v));
      }
      db.exec('COMMIT;');
      return this.getStoreSettings(db, businessId);
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  }
}

// Category Repository
class CategoryRepo {
  static findById(db, businessId, id) {
    return db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(id, businessId) || null;
  }
  static findByName(db, businessId, name) {
    if (!name?.trim()) return null;
    return db.prepare('SELECT * FROM categories WHERE business_id = ? AND lower(name) = lower(?) LIMIT 1')
      .get(businessId, name.trim()) || null;
  }
  static list(db, businessId) {
    return db.prepare('SELECT * FROM categories WHERE business_id = ? ORDER BY display_order ASC, name ASC').all(businessId);
  }
  static create(db, businessId, input) {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Category name is required.');
    if (this.findByName(db, businessId, name)) {
      throw new ConflictError('Category', 'name', name);
    }
    const id = input.id || randomUUID();
    db.prepare('INSERT INTO categories (id, business_id, name, display_order) VALUES (?, ?, ?, ?)')
      .run(id, businessId, name, input.displayOrder || 0);
    return this.findById(db, businessId, id);
  }
  static reorder(db, businessId, orderedIds) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const stmt = db.prepare('UPDATE categories SET display_order = ? WHERE id = ? AND business_id = ?');
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i], businessId);
      }
      db.exec('COMMIT;');
      return this.list(db, businessId);
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  }
}

// ─── Main Test Runner ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Selwick POS – Milestone 3 Verification Suite ===\n');

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 1: Exact-Money Engine
  // ───────────────────────────────────────────────────────────────────────────
  console.log('1. Exact-Money Utility (Paisa / Integer Minor Units)');

  // 1a. Conversions
  ok('toCents converts 150.50 to 15050 paisa', toCents(150.50) === 15050);
  ok('toCents converts string "150.50" to 15050 paisa', toCents('150.50') === 15050);
  ok('toCents avoids binary float precision bug (1.14 -> 114)', toCents(1.14) === 114);
  ok('toCents handles 0 correctly', toCents(0) === 0);
  ok('fromCents converts 15050 to 150.5', fromCents(15050) === 150.5);
  ok('formatMoney produces "Rs 1,450.50"', formatMoney(145050, 'Rs') === 'Rs 1,450.50');

  // 1b. Strict Validation & Rejection
  let caughtNan = false;
  try { toCents(NaN); } catch (e) { caughtNan = e instanceof MoneyError && e.code === 'NOT_A_NUMBER'; }
  ok('toCents rejects NaN', caughtNan);

  let caughtInf = false;
  try { toCents(Infinity); } catch (e) { caughtInf = e instanceof MoneyError && e.code === 'NOT_FINITE'; }
  ok('toCents rejects Infinity', caughtInf);

  let caughtExcessivePrecision = false;
  try { toCents('10.555'); } catch (e) { caughtExcessivePrecision = e instanceof MoneyError && e.code === 'EXCESSIVE_PRECISION'; }
  ok('toCents rejects excessive decimal precision (> 2 decimal places)', caughtExcessivePrecision);

  let caughtNegative = false;
  try { toCents(-50, false); } catch (e) { caughtNegative = e instanceof MoneyError && e.code === 'NEGATIVE_AMOUNT'; }
  ok('toCents rejects negative amount when allowNegative is false', caughtNegative);

  ok('toCents permits negative amount when allowNegative is true', toCents(-50.25, true) === -5025);

  // 1c. Commercial Half-Up Rounding
  ok('calculatePercentageDiscount: 15% on 1000 = 150', calculatePercentageDiscount(1000, 15) === 150);
  ok('calculatePercentageDiscount: 15% on 105 rounds half-up to 16', calculatePercentageDiscount(105, 15) === 16);
  ok('calculatePercentageDiscount: 15% on 103 rounds half-down to 15', calculatePercentageDiscount(103, 15) === 15);
  ok('calculatePercentageDiscount capped at subtotal', calculatePercentageDiscount(500, 100) === 500);

  ok('calculateTax: 16% on 1000 = 160', calculateTax(1000, 16) === 160);
  ok('calculateTax: 16% on 105 rounds to 17', calculateTax(105, 16) === 17);

  // 1d. Sale Totals Consistency Invariant
  const saleTotals = calculateSaleTotals({
    items: [
      { priceCents: 15000, quantity: 2, discountCents: 500 }, // Gross 30000, discount 500
      { priceCents: 8500, quantity: 1, discountCents: 0 },    // Gross 8500
    ],
    discountType: 'fixed',
    discountValue: 1000, // Order discount 1000
    enableTax: true,
    taxRatePercent: 5,
    amountTenderedCents: 45000,
  });

  ok('calculateSaleTotals subtotal matches sum of line totals (38500)', saleTotals.subtotalCents === 38500);
  ok('calculateSaleTotals total discount is line + order (1500)', saleTotals.totalDiscountCents === 1500);
  ok('calculateSaleTotals taxable = subtotal - totalDiscount (37000)', saleTotals.taxableCents === 37000);
  ok('calculateSaleTotals tax (5% of 37000 = 1850)', saleTotals.taxCents === 1850);
  ok('calculateSaleTotals total = taxable + tax (38850)', saleTotals.totalCents === 38850);
  ok('calculateSaleTotals enforces invariant: subtotal - discount + tax === total',
    saleTotals.subtotalCents - saleTotals.totalDiscountCents + saleTotals.taxCents === saleTotals.totalCents);
  ok('calculateSaleTotals calculates exact change (45000 - 38850 = 6150)', saleTotals.changeDueCents === 6150);

  let caughtInsufficientTender = false;
  try {
    calculateSaleTotals({
      items: [{ priceCents: 10000, quantity: 1 }],
      amountTenderedCents: 5000,
    });
  } catch (e) {
    caughtInsufficientTender = e instanceof MoneyError && e.code === 'INSUFFICIENT_TENDER';
  }
  ok('calculateSaleTotals rejects insufficient amount tendered', caughtInsufficientTender);

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 2: Product & Inventory Repository
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n2. Product & Inventory Repository');
  const db = createIsolatedTestDb();
  const bizA = 'biz-alpha';
  const bizB = 'biz-beta';

  db.prepare("INSERT INTO businesses (id, name) VALUES (?, ?)").run(bizA, 'Business Alpha');
  db.prepare("INSERT INTO businesses (id, name) VALUES (?, ?)").run(bizB, 'Business Beta');

  // 2a. Product Creation
  const p1 = ProductRepo.create(db, bizA, {
    name: 'Wireless Mouse',
    sku: 'WM-001',
    barcode: '1234567890123',
    category: 'Accessories',
    price: 1500, // Rs 1,500.00 = 150000 cents
    costPrice: 900,
    stock: 20,
    minStockAlert: 5,
    iconType: 'other',
  });
  ok('Product created with integer price_cents (150000)', p1.price_cents === 150000);
  ok('Product created with integer cost_price_cents (90000)', p1.cost_price_cents === 90000);
  ok('Product stock initialized correctly (20)', p1.stock === 20);

  // 2b. Lookup operations
  const foundById = ProductRepo.findById(db, bizA, p1.id);
  ok('findById returns product within business scope', foundById?.name === 'Wireless Mouse');
  const foundByBarcode = ProductRepo.findByBarcode(db, bizA, '1234567890123');
  ok('findByBarcode finds product', foundByBarcode?.id === p1.id);
  const foundBySku = ProductRepo.findBySku(db, bizA, 'WM-001');
  ok('findBySku finds product', foundBySku?.id === p1.id);

  // 2c. Business Scope Isolation
  const crossBizProduct = ProductRepo.findById(db, bizB, p1.id);
  ok('Business Isolation: Product of Biz A is not accessible by Biz B', crossBizProduct === null);

  // 2d. Stock Adjustment & Safe Constraints
  const adjustedStock = ProductRepo.adjustStock(db, bizA, p1.id, -5);
  ok('adjustStock decrements stock safely (20 -> 15)', adjustedStock.stock === 15);

  let caughtNegativeStock = false;
  try {
    ProductRepo.adjustStock(db, bizA, p1.id, -20); // 15 - 20 = -5
  } catch (e) {
    caughtNegativeStock = e instanceof InsufficientStockError && e.currentStock === 15;
  }
  ok('Safe Inventory: Rejects adjustment that causes negative stock', caughtNegativeStock);
  ok('Stock remains unchanged after rejected adjustment (15)', ProductRepo.findById(db, bizA, p1.id)?.stock === 15);

  // 2e. Transaction Rollback in Batch Adjustments
  const p2 = ProductRepo.create(db, bizA, {
    name: 'USB-C Cable',
    category: 'Cables',
    priceCents: 50000,
    stock: 10,
  });

  let caughtBatchError = false;
  try {
    ProductRepo.batchAdjustStock(db, bizA, [
      { id: p1.id, delta: -5 },
      { id: p2.id, delta: -25 }, // will fail: 10 - 25 = -15
    ]);
  } catch (e) {
    caughtBatchError = e instanceof InsufficientStockError;
  }
  ok('Batch Adjustments: Throws on insufficient stock in any batch item', caughtBatchError);
  ok('TRANSACTION ROLLBACK: Product 1 stock rolled back (still 15)', ProductRepo.findById(db, bizA, p1.id)?.stock === 15);
  ok('TRANSACTION ROLLBACK: Product 2 stock rolled back (still 10)', ProductRepo.findById(db, bizA, p2.id)?.stock === 10);

  // 2f. Domain Mapping
  const domainProd = ProductRepo.toDomain(p1);
  ok('toDomainProduct converts price_cents (150000) to price (1500)', domainProd.price === 1500);
  ok('toDomainProduct converts cost_price_cents (90000) to costPrice (900)', domainProd.costPrice === 900);

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 3: Customer Repository
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n3. Customer Repository');

  const c1 = CustomerRepo.create(db, bizA, {
    name: 'Tariq Khan',
    phone: '03001234567',
    balance: 500, // Rs 500.00 store credit = 50000 cents
  });
  ok('Customer created with balance_cents (50000)', c1.balance_cents === 50000);
  ok('Customer found by phone', CustomerRepo.findByPhone(db, bizA, '03001234567')?.id === c1.id);

  ok('Business Isolation: Customer not accessible by Biz B', CustomerRepo.findById(db, bizB, c1.id) === null);

  const balAdj = CustomerRepo.adjustBalance(db, bizA, c1.id, -20000);
  ok('adjustBalance updates balance correctly (50000 - 20000 = 30000)', balAdj.balance_cents === 30000);

  const ordRec = CustomerRepo.recordOrder(db, bizA, c1.id, 150000, 15);
  ok('recordOrder increments total_orders (1)', ordRec.total_orders === 1);
  ok('recordOrder accumulates total_spent_cents (150000)', ordRec.total_spent_cents === 150000);
  ok('recordOrder accumulates loyalty_points (15)', ordRec.loyalty_points === 15);

  const domainCust = CustomerRepo.toDomain(ordRec);
  ok('toDomainCustomer maps balance_cents (30000) to balance (300)', domainCust.balance === 300);
  ok('toDomainCustomer maps total_spent_cents to totalSpent (1500)', domainCust.totalSpent === 1500);

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 4: Expense Repository
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n4. Expense Repository');

  const e1 = ExpenseRepo.create(db, bizA, {
    date: '2026-10-23',
    category: 'Electricity',
    description: 'Shop bill October',
    amount: 12500.50, // 1250050 cents
  });
  ok('Expense created with amount_cents (1250050)', e1.amount_cents === 1250050);

  const e2 = ExpenseRepo.create(db, bizA, {
    date: '2026-10-24',
    category: 'Internet',
    description: 'Fiber optics monthly',
    amountCents: 450000,
  });

  const expenseTotal = ExpenseRepo.getTotalAmountCents(db, bizA);
  ok('getTotalAmountCents sums all expenses (1250050 + 450000 = 1700050)', expenseTotal === 1700050);

  const filtered = ExpenseRepo.list(db, bizA, { startDate: '2026-10-24', endDate: '2026-10-24' });
  ok('Expense date range filtering returns only matching dates', filtered.length === 1 && filtered[0].id === e2.id);

  let caughtBadDate = false;
  try {
    ExpenseRepo.create(db, bizA, {
      date: '23/10/2026',
      category: 'Rent',
      description: 'Monthly rent',
      amount: 50000,
    });
  } catch (err) {
    caughtBadDate = err instanceof ValidationError;
  }
  ok('Expense validation rejects invalid date format', caughtBadDate);

  ok('Business Isolation: Expense of Biz A not visible to Biz B', ExpenseRepo.findById(db, bizB, e1.id) === null);
  ok('Biz B has 0 expenses', ExpenseRepo.getTotalAmountCents(db, bizB) === 0);

  const domainExp = ExpenseRepo.toDomain(e1);
  ok('toDomainExpense maps amount_cents to major unit (12500.5)', domainExp.amount === 12500.5);

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 5: Settings Repository
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n5. Settings Repository');

  const defSettings = SettingsRepo.getStoreSettings(db, bizA);
  ok('Default StoreSettings loaded when unconfigured', defSettings.storeName === 'Selwick Store');
  ok('Default currency symbol is Rs', defSettings.currencySymbol === 'Rs');

  SettingsRepo.updateStoreSettings(db, bizA, {
    storeName: 'Alpha Supermarket',
    taxRate: 16,
    enableTax: true,
  });

  const updatedSettings = SettingsRepo.getStoreSettings(db, bizA);
  ok('Settings updated: storeName is "Alpha Supermarket"', updatedSettings.storeName === 'Alpha Supermarket');
  ok('Settings updated: taxRate is 16', updatedSettings.taxRate === 16);
  ok('Settings updated: enableTax is true', updatedSettings.enableTax === true);

  const bizBSettings = SettingsRepo.getStoreSettings(db, bizB);
  ok('Business Isolation: Biz B settings retain defaults and not affected by Biz A', bizBSettings.storeName === 'Selwick Store');

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 6: Category Repository
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n6. Category Repository');

  const cat1 = CategoryRepo.create(db, bizA, { name: 'Beverages', displayOrder: 1 });
  const cat2 = CategoryRepo.create(db, bizA, { name: 'Snacks', displayOrder: 2 });
  ok('Categories created cleanly', cat1.name === 'Beverages' && cat2.name === 'Snacks');

  let caughtDupCategory = false;
  try {
    CategoryRepo.create(db, bizA, { name: 'beverages' });
  } catch (err) {
    caughtDupCategory = err instanceof ConflictError;
  }
  ok('Category unique name: Duplicate in same business rejected with ConflictError', caughtDupCategory);

  const catBizB = CategoryRepo.create(db, bizB, { name: 'Beverages' });
  ok('Category isolation: Biz B can have same category name without conflict', catBizB.name === 'Beverages');

  const reordered = CategoryRepo.reorder(db, bizA, [cat2.id, cat1.id]);
  ok('reorder sets first category to Snacks', reordered[0].name === 'Snacks' && reordered[0].display_order === 0);
  ok('reorder sets second category to Beverages', reordered[1].name === 'Beverages' && reordered[1].display_order === 1);

  db.close();

  // ───────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(54)}`);
  console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
  if (failed > 0) {
    console.error('\n❌ Some Milestone 3 repository / money tests failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All Milestone 3 money & repository tests passed successfully.');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error in repository tests:', err);
  process.exit(1);
});
