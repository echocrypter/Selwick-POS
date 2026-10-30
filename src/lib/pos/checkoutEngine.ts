/**
 * Selwick POS – Atomic, Idempotent Checkout Engine
 *
 * Implements single-transaction, server-side validated checkout:
 *   1. Authenticated session & business isolation
 *   2. Server-side price, discount, tax, and total recalculation
 *   3. Strict stock verification and atomic inventory deduction
 *   4. Business-scoped collision-free invoice number generation
 *   5. Idempotency key tracking (replay caching & payload mismatch detection)
 *   6. Customer history, loyalty points, and credit accounting
 *   7. Full atomic rollback on any failure
 */

import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { type SessionPayload } from '../auth/sessions';
import {
  toCents,
  fromCents,
  calculateSaleTotals,
  type SaleTotals,
  type SaleLineItemInput,
} from '../money';
import { type CartItem, type Sale } from '../../types/pos';
import {
  type CheckoutRequest,
  type CheckoutResult,
  type PosPaymentMethod,
} from './types';
import {
  PosError,
  PosValidationError,
  PosNotFoundError,
  InsufficientStockError,
  IdempotencyConflictError,
} from './errors';

const VALID_PAYMENT_METHODS: PosPaymentMethod[] = [
  'cash',
  'card',
  'wallet',
  'bank_transfer',
  'sadapay',
  'easypaisa',
  'nayapay',
  'jazzcash',
  'raast',
  'credit',
];

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string;
  price_cents: number;
  cost_price_cents: number;
  stock: number;
  min_stock_alert: number;
  is_active: number;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  balance_cents: number;
  loyalty_points: number;
  total_orders: number;
  total_spent_cents: number;
}

/**
 * Computes deterministic canonical SHA-256 hash of a checkout request.
 * Normalizes item ordering and includes all financially/operationally meaningful fields.
 */
export function computeCheckoutRequestHash(businessId: string, req: CheckoutRequest): string {
  const sortedItems = [...(req.items || [])].map((i) => ({
    productId: String(i.productId).trim(),
    quantity: Number(i.quantity),
    discountCents: i.discountCents !== undefined ? Number(i.discountCents) : 0,
    customPriceCents: i.customPriceCents !== undefined && i.customPriceCents !== null ? Number(i.customPriceCents) : null,
  })).sort((a, b) => {
    const cmp = a.productId.localeCompare(b.productId);
    if (cmp !== 0) return cmp;
    const cmpPrice = (a.customPriceCents ?? 0) - (b.customPriceCents ?? 0);
    if (cmpPrice !== 0) return cmpPrice;
    return a.discountCents - b.discountCents;
  });

  const canonical = {
    businessId: String(businessId).trim(),
    items: sortedItems,
    discountType: req.discountType === 'percent' ? 'percent' : 'fixed',
    discountValue: Number(req.discountValue || 0),
    taxRatePercent: Number(req.taxRatePercent || 0),
    enableTax: Boolean(req.enableTax),
    paymentMethod: String(req.paymentMethod).toLowerCase().trim(),
    amountTenderedCents: req.amountTenderedCents !== undefined && req.amountTenderedCents !== null ? Number(req.amountTenderedCents) : null,
    customerId: req.customerId ? String(req.customerId).trim() : null,
    customerName: req.customerName ? String(req.customerName).trim() : null,
    customerPhone: req.customerPhone ? String(req.customerPhone).trim() : null,
    terminalId: req.terminalId ? String(req.terminalId).trim() : null,
    transactionRef: req.transactionRef ? String(req.transactionRef).trim() : null,
    notes: req.notes ? String(req.notes).trim() : '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Generates a business-scoped, date-based, collision-free unique invoice number.
 * Backed by invoice_sequences table supporting > 9,999 invoices/day, remapped
 * invoices, and multi-tenant isolation.
 */
export function generateNextInvoiceNumber(db: DatabaseSync, businessId: string, dateStr: string): string {
  const cleanDate = dateStr.replace(/[^0-9]/g, '');
  const prefix = `INV-${cleanDate}-`;

  // 1. Ensure sequence row exists for this business and date
  db.prepare(`
    INSERT OR IGNORE INTO invoice_sequences (business_id, date_str, current_seq)
    VALUES (?, ?, 0)
  `).run(businessId, dateStr);

  const seqRow = db.prepare(`
    SELECT current_seq FROM invoice_sequences WHERE business_id = ? AND date_str = ?
  `).get(businessId, dateStr) as { current_seq: number };

  let currentSeq = seqRow.current_seq;

  // 2. If sequence is 0, initialize by scanning existing sales for today
  if (currentSeq === 0) {
    const existingSales = db.prepare(`
      SELECT invoice_number FROM sales
      WHERE business_id = ? AND (date_str = ? OR invoice_number LIKE ?)
    `).all(businessId, dateStr, `${prefix}%`) as Array<{ invoice_number: string }>;

    let maxFound = 0;
    for (const row of existingSales) {
      if (row.invoice_number.startsWith(prefix)) {
        const suffix = row.invoice_number.slice(prefix.length);
        const match = suffix.match(/^(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!Number.isNaN(num) && num > maxFound) {
            maxFound = num;
          }
        }
      }
    }
    currentSeq = maxFound;
  }

  // 3. Increment sequence and probe to guarantee uniqueness against remapped/imported sales
  const checkExistsStmt = db.prepare('SELECT 1 FROM sales WHERE business_id = ? AND invoice_number = ?');
  let candidate = '';
  let attempts = 0;

  while (attempts < 1000) {
    currentSeq++;
    const seqStr = currentSeq < 10000 ? String(currentSeq).padStart(4, '0') : String(currentSeq);
    candidate = `${prefix}${seqStr}`;

    const exists = checkExistsStmt.get(businessId, candidate);
    if (!exists) {
      break;
    }
    attempts++;
  }

  // Persist updated sequence
  db.prepare(`
    UPDATE invoice_sequences
    SET current_seq = ?, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = ? AND date_str = ?
  `).run(currentSeq, businessId, dateStr);

  return candidate;
}

/**
 * Executes an atomic, idempotent checkout operation.
 */
export function executeCheckout(
  db: DatabaseSync,
  session: SessionPayload,
  request: CheckoutRequest,
): CheckoutResult {
  const targetBusinessId = request.businessId || session.businessId;
  if (session.businessId !== targetBusinessId) {
    throw new PosError('FORBIDDEN', `Session business "${session.businessId}" does not match target business "${targetBusinessId}".`, 403);
  }

  // 1. Basic Request Validation
  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new PosValidationError('Checkout requires at least one line item.');
  }

  const paymentMethod = String(request.paymentMethod).toLowerCase() as PosPaymentMethod;
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new PosValidationError(`Unsupported payment method "${paymentMethod}". Permitted: ${VALID_PAYMENT_METHODS.join(', ')}.`);
  }

  if (paymentMethod === 'credit' && !request.customerId) {
    throw new PosValidationError('Customer ID is required for credit payments.');
  }

  // 2. Mandatory Client-Generated Idempotency Key
  const rawKey = request.idempotencyKey ? String(request.idempotencyKey).trim() : '';
  if (!rawKey || rawKey.length < 4 || rawKey.length > 128) {
    throw new PosValidationError('Checkout requires a valid, client-generated idempotency key (header "Idempotency-Key" or field "idempotencyKey" of 4-128 chars).');
  }
  const idempotencyKey = rawKey;
  const requestHash = computeCheckoutRequestHash(targetBusinessId, request);

  // 2b. Check Idempotency Ledger within Authenticated Business Scope (Pre-flight Fast Path)
  const existing = db.prepare(`
    SELECT key, business_id, request_hash, response_code, response_body
    FROM idempotency_keys
    WHERE key = ? AND business_id = ?
  `).get(idempotencyKey, targetBusinessId) as {
    key: string;
    business_id: string;
    request_hash: string | null;
    response_code: number;
    response_body: string;
  } | undefined;

  if (existing) {
    if (existing.request_hash && existing.request_hash !== requestHash) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    try {
      const cachedPayload = JSON.parse(existing.response_body);
      return {
        ...cachedPayload,
        idempotentReplay: true,
      };
    } catch {
      // Fall through to re-execute if cache was unparseable
    }
  }

  // 3. Execute Single SQLite Transaction with Bounded Retry on SQLITE_BUSY
  const MAX_BUSY_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_BUSY_RETRIES; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      break;
    } catch (err: unknown) {
      const isBusy = (err as { code?: string; errcode?: number })?.errcode === 5 ||
                     (err as { message?: string })?.message?.includes('busy');
      if (isBusy && attempt < MAX_BUSY_RETRIES) {
        const sleepMs = 15 * attempt;
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
        } catch {
          const start = Date.now();
          while (Date.now() - start < sleepMs) {}
        }
        continue;
      }
      throw err;
    }
  }

  try {
    // 3a. Authoritative Idempotency Check Inside Write Lock
    // Resolves simultaneous requests using the same idempotency key across connections
    const existingInLock = db.prepare(`
      SELECT key, business_id, request_hash, response_code, response_body
      FROM idempotency_keys
      WHERE key = ? AND business_id = ?
    `).get(idempotencyKey, targetBusinessId) as {
      key: string;
      business_id: string;
      request_hash: string | null;
      response_code: number;
      response_body: string;
    } | undefined;

    if (existingInLock) {
      db.exec('ROLLBACK');
      if (existingInLock.request_hash && existingInLock.request_hash !== requestHash) {
        throw new IdempotencyConflictError(idempotencyKey);
      }
      try {
        const cachedPayload = JSON.parse(existingInLock.response_body);
        return {
          ...cachedPayload,
          idempotentReplay: true,
        };
      } catch {}
    }

    // 3b. Read Store Settings (Tax & Terminal)
    const settingsRows = db.prepare('SELECT key, value FROM settings WHERE business_id = ?').all(targetBusinessId) as Array<{ key: string; value: string }>;
    const settingsMap = new Map<string, unknown>();
    for (const r of settingsRows) {
      try { settingsMap.set(r.key, JSON.parse(r.value)); } catch { settingsMap.set(r.key, r.value); }
    }

    const defaultTaxRate = typeof settingsMap.get('taxRate') === 'number' ? Number(settingsMap.get('taxRate')) : 0;
    const defaultEnableTax = Boolean(settingsMap.get('enableTax'));
    const defaultTerminal = String(settingsMap.get('terminalId') || request.terminalId || 'term-01');

    const enableTax = request.enableTax !== undefined ? Boolean(request.enableTax) : defaultEnableTax;
    const taxRatePercent = request.taxRatePercent !== undefined ? Number(request.taxRatePercent) : defaultTaxRate;

    // 3c. Validate Products and Check Inventory Availability
    const productStmt = db.prepare(`
      SELECT id, name, sku, barcode, category, price_cents, cost_price_cents, stock, min_stock_alert, is_active
      FROM products
      WHERE id = ? AND business_id = ?
    `);

    interface ValidatedItem {
      product: ProductRow;
      quantity: number;
      priceCents: number;
      costPriceCents: number;
      discountCents: number;
      customPriceCents?: number;
    }

    const validatedItems: ValidatedItem[] = [];
    const totalsInputItems: SaleLineItemInput[] = [];
    const priceOverrideAudits: string[] = [];

    for (let i = 0; i < request.items.length; i++) {
      const item = request.items[i];
      if (!item || typeof item !== 'object') {
        throw new PosValidationError(`Invalid line item at index ${i}.`);
      }
      if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new PosValidationError(`Item at index ${i} has invalid quantity: "${item.quantity}". Must be a positive integer.`);
      }

      const prod = productStmt.get(item.productId, targetBusinessId) as ProductRow | undefined;
      if (!prod) {
        throw new PosNotFoundError('Product', item.productId);
      }
      if (prod.is_active === 0) {
        throw new PosValidationError(`Product "${prod.name}" (${prod.id}) is inactive.`);
      }
      if (prod.stock < item.quantity) {
        throw new InsufficientStockError(prod.id, prod.stock, item.quantity);
      }

      let linePriceCents = prod.price_cents;
      let customPriceCents: number | undefined;

      if (item.customPriceCents !== undefined && item.customPriceCents !== null) {
        if (session.role !== 'owner' && session.role !== 'manager') {
          throw new PosError(
            'INSUFFICIENT_ROLE',
            `Cashier role is not authorized to override product prices. Manager or Owner approval required.`,
            403,
          );
        }
        if (!Number.isInteger(item.customPriceCents) || item.customPriceCents < 0) {
          throw new PosValidationError(`Custom price for "${prod.name}" must be a non-negative integer.`);
        }
        customPriceCents = item.customPriceCents;
        linePriceCents = item.customPriceCents;
        priceOverrideAudits.push(`[PRICE_OVERRIDE by ${session.role} (${session.userId}): ${prod.name} standard ${prod.price_cents} -> ${item.customPriceCents}]`);
      }

      const discountCents = item.discountCents || 0;
      if (!Number.isInteger(discountCents) || discountCents < 0) {
        throw new PosValidationError(`Line discount for "${prod.name}" must be a non-negative integer.`);
      }

      validatedItems.push({
        product: prod,
        quantity: item.quantity,
        priceCents: linePriceCents,
        costPriceCents: prod.cost_price_cents,
        discountCents,
        customPriceCents,
      });

      totalsInputItems.push({
        priceCents: linePriceCents,
        quantity: item.quantity,
        discountCents,
        customPriceCents,
      });
    }

    // 3c. Calculate Exact Monetary Totals
    const totals: SaleTotals = calculateSaleTotals({
      items: totalsInputItems,
      discountType: request.discountType || 'fixed',
      discountValue: request.discountValue || 0,
      taxRatePercent,
      enableTax,
    });

    // 3d. Validate Tendered Amount and Change
    let amountTenderedCents = 0;
    let changeDueCents = 0;
    let unpaidCreditCents = 0;

    if (paymentMethod === 'cash') {
      amountTenderedCents = request.amountTenderedCents !== undefined
        ? request.amountTenderedCents
        : totals.totalCents;

      if (!Number.isInteger(amountTenderedCents) || amountTenderedCents < totals.totalCents) {
        throw new PosValidationError(
          `Amount tendered (${amountTenderedCents} paisa) is less than sale total (${totals.totalCents} paisa).`
        );
      }
      changeDueCents = amountTenderedCents - totals.totalCents;
    } else if (paymentMethod === 'credit') {
      amountTenderedCents = request.amountTenderedCents || 0;
      if (amountTenderedCents > totals.totalCents) {
        throw new PosValidationError('Credit sale cannot tender more than sale total.');
      }
      unpaidCreditCents = totals.totalCents - amountTenderedCents;
      changeDueCents = 0;
    } else {
      // Electronic payments: full exact tender
      amountTenderedCents = totals.totalCents;
      changeDueCents = 0;
    }

    // 3e. Verify Customer Record if Attached
    let customerRow: CustomerRow | undefined;
    let customerName = request.customerName ? String(request.customerName).trim() : 'Walk-in Customer';
    let customerPhone = request.customerPhone ? String(request.customerPhone).trim() : null;

    if (request.customerId) {
      customerRow = db.prepare(`
        SELECT id, name, phone, balance_cents, loyalty_points, total_orders, total_spent_cents
        FROM customers
        WHERE id = ? AND business_id = ?
      `).get(request.customerId, targetBusinessId) as CustomerRow | undefined;

      if (!customerRow) {
        throw new PosNotFoundError('Customer', request.customerId);
      }
      customerName = customerRow.name;
      customerPhone = customerRow.phone;
    }

    // 3f. Generate Unique Invoice Number
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timestampStr = now.toISOString();
    const invoiceNumber = generateNextInvoiceNumber(db, targetBusinessId, dateStr);
    const saleId = `sale-${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`;

    const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(session.userId) as { name: string } | undefined;
    const cashierName = userRow?.name || session.userId;

    const finalSaleNotes = [
      request.notes ? String(request.notes).trim() : null,
      ...priceOverrideAudits,
      request.transactionRef ? `[TX_REF: ${String(request.transactionRef).trim()}]` : null,
    ].filter(Boolean).join('\n') || null;

    // 3g. Insert Sale Record
    db.prepare(`
      INSERT INTO sales (
        id, business_id, invoice_number, idempotency_key, timestamp, date_str,
        subtotal_cents, discount_cents, discount_type, tax_cents, total_cents,
        payment_method, amount_tendered_cents, change_due_cents,
        customer_id, customer_name, customer_phone, notes, terminal_id,
        cashier_id, cashier_name, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      saleId,
      targetBusinessId,
      invoiceNumber,
      idempotencyKey,
      timestampStr,
      dateStr,
      totals.subtotalCents,
      totals.totalDiscountCents,
      request.discountType || 'fixed',
      totals.taxCents,
      totals.totalCents,
      paymentMethod,
      amountTenderedCents,
      changeDueCents,
      request.customerId || null,
      customerName,
      customerPhone,
      finalSaleNotes,
      defaultTerminal,
      session.userId,
      cashierName,
      'completed',
    );

    // 3h. Insert Sale Items and Deduct Inventory
    const insItemStmt = db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, product_name, product_sku, product_barcode,
        category, quantity, price_cents, cost_price_cents, discount_cents, custom_price_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deductStockStmt = db.prepare(`
      UPDATE products
      SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ? AND stock >= ?
    `);

    const cartItems: CartItem[] = [];

    for (const v of validatedItems) {
      const itemId = `item-${crypto.randomUUID()}`;
      insItemStmt.run(
        itemId,
        saleId,
        v.product.id,
        v.product.name,
        v.product.sku,
        v.product.barcode,
        v.product.category,
        v.quantity,
        v.priceCents,
        v.costPriceCents,
        v.discountCents,
        v.customPriceCents !== undefined ? v.customPriceCents : null,
      );

      const updateResult = deductStockStmt.run(v.quantity, v.product.id, targetBusinessId, v.quantity);
      if (updateResult.changes === 0) {
        throw new InsufficientStockError(v.product.id, v.product.stock, v.quantity);
      }

      cartItems.push({
        product: {
          id: v.product.id,
          name: v.product.name,
          sku: v.product.sku || '',
          barcode: v.product.barcode || '',
          category: v.product.category,
          price: fromCents(v.priceCents),
          costPrice: fromCents(v.costPriceCents),
          stock: v.product.stock - v.quantity,
          minStockAlert: v.product.min_stock_alert,
          iconType: 'other',
        },
        quantity: v.quantity,
        discount: fromCents(v.discountCents),
        customPrice: v.customPriceCents !== undefined ? fromCents(v.customPriceCents) : undefined,
      });
    }

    // 3i. Update Customer Metrics & Khata Balance
    if (customerRow) {
      const loyaltyEarned = Math.floor(fromCents(totals.totalCents) / 100);
      const newOrders = customerRow.total_orders + 1;
      const newSpent = customerRow.total_spent_cents + totals.totalCents;
      const newPoints = customerRow.loyalty_points + loyaltyEarned;
      const newBalance = customerRow.balance_cents + unpaidCreditCents;

      db.prepare(`
        UPDATE customers
        SET total_orders = ?, total_spent_cents = ?, loyalty_points = ?, balance_cents = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ?
      `).run(newOrders, newSpent, newPoints, newBalance, customerRow.id, targetBusinessId);

      // Track credit sale debt in credit_sales_ledger
      if (paymentMethod === 'credit' && unpaidCreditCents > 0) {
        db.prepare(`
          INSERT INTO credit_sales_ledger (
            sale_id, business_id, customer_id, original_credit_cents, settled_cents, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, 'open', ?, ?)
        `).run(saleId, targetBusinessId, customerRow.id, unpaidCreditCents, timestampStr, timestampStr);
      }
    }

    // 3j. Assemble Result Payload
    const completedSale: Sale = {
      id: saleId,
      invoiceNumber,
      timestamp: timestampStr,
      dateStr,
      items: cartItems,
      subtotal: fromCents(totals.subtotalCents),
      discount: fromCents(totals.totalDiscountCents),
      discountType: request.discountType === 'percent' ? 'percent' : 'fixed',
      tax: fromCents(totals.taxCents),
      total: fromCents(totals.totalCents),
      paymentMethod: paymentMethod as Sale['paymentMethod'],
      amountTendered: fromCents(amountTenderedCents),
      changeDue: fromCents(changeDueCents),
      customerId: request.customerId || undefined,
      customerName,
      customerPhone: customerPhone || undefined,
      notes: finalSaleNotes || undefined,
      terminalId: defaultTerminal,
      status: 'completed',
    };

    const checkoutResult: CheckoutResult = {
      sale: completedSale,
      invoiceNumber,
      totals,
      idempotentReplay: false,
    };

    // 3k. Record Idempotency Key in Database Ledger
    if (idempotencyKey) {
      db.prepare(`
        INSERT INTO idempotency_keys (key, business_id, endpoint, request_hash, response_code, response_body)
        VALUES (?, ?, '/api/pos/checkout', ?, 201, ?)
      `).run(idempotencyKey, targetBusinessId, requestHash, JSON.stringify(checkoutResult));
    }

    db.exec('COMMIT');
    return checkoutResult;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
