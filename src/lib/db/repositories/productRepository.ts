/**
 * Selwick POS – SQLite Product and Inventory Repository
 *
 * Implements business-scoped, parameterized, transactional operations on the `products` table.
 * All prices and costs are stored strictly as integer minor units (paisa/cents).
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { assertValidCents, fromCents, toCents } from '@/lib/money';
import {
  NotFoundError,
  InsufficientStockError,
  ValidationError,
} from './errors';
import type { Product } from '@/types/pos';

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

export interface CreateProductInput {
  id?: string;
  name: string;
  sku?: string;
  barcode?: string;
  category: string;
  priceCents?: number;
  price?: number; // Major units alternative
  costPriceCents?: number;
  costPrice?: number;
  stock?: number;
  minStockAlert?: number;
  description?: string;
  badge?: string;
  iconType?: Product['iconType'];
  isActive?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  priceCents?: number;
  price?: number;
  costPriceCents?: number;
  costPrice?: number;
  stock?: number;
  minStockAlert?: number;
  description?: string | null;
  badge?: string | null;
  iconType?: Product['iconType'];
  isActive?: boolean;
}

/**
 * Maps a SQLite ProductRow (with integer cents) to the domain Product interface.
 */
export function toDomainProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? '',
    barcode: row.barcode ?? '',
    category: row.category,
    price: fromCents(row.price_cents),
    costPrice: fromCents(row.cost_price_cents),
    stock: row.stock,
    minStockAlert: row.min_stock_alert,
    description: row.description ?? undefined,
    badge: row.badge ?? undefined,
    iconType: (row.icon_type as Product['iconType']) || 'other',
  };
}

export class ProductRepository {
  /**
   * Finds a product by ID within a specific business scope.
   */
  static findById(db: DatabaseSync, businessId: string, id: string): ProductRow | null {
    const row = db.prepare(`
      SELECT * FROM products
      WHERE id = ? AND business_id = ?
    `).get(id, businessId) as ProductRow | undefined;

    return row || null;
  }

  /**
   * Finds a product by barcode within a business scope.
   */
  static findByBarcode(db: DatabaseSync, businessId: string, barcode: string): ProductRow | null {
    if (!barcode) return null;
    const row = db.prepare(`
      SELECT * FROM products
      WHERE business_id = ? AND barcode = ? AND is_active = 1
      LIMIT 1
    `).get(businessId, barcode) as ProductRow | undefined;

    return row || null;
  }

  /**
   * Finds a product by SKU within a business scope.
   */
  static findBySku(db: DatabaseSync, businessId: string, sku: string): ProductRow | null {
    if (!sku) return null;
    const row = db.prepare(`
      SELECT * FROM products
      WHERE business_id = ? AND sku = ? AND is_active = 1
      LIMIT 1
    `).get(businessId, sku) as ProductRow | undefined;

    return row || null;
  }

  /**
   * Lists products for a business with optional filtering.
   */
  static list(
    db: DatabaseSync,
    businessId: string,
    options?: {
      category?: string;
      activeOnly?: boolean;
      search?: string;
    },
  ): ProductRow[] {
    let sql = 'SELECT * FROM products WHERE business_id = ?';
    const params: (string | number)[] = [businessId];

    if (options?.activeOnly !== false) {
      sql += ' AND is_active = 1';
    }

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    if (options?.search) {
      sql += ' AND (lower(name) LIKE ? OR lower(barcode) LIKE ? OR lower(sku) LIKE ?)';
      const term = `%${options.search.toLowerCase()}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY name ASC';
    return db.prepare(sql).all(...params) as ProductRow[];
  }

  /**
   * Inserts a new product scoped to the business.
   */
  static create(db: DatabaseSync, businessId: string, input: CreateProductInput): ProductRow {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Product name is required.');
    if (!input.category?.trim()) throw new ValidationError('Product category is required.');

    const priceCents = input.priceCents !== undefined
      ? input.priceCents
      : input.price !== undefined
      ? toCents(input.price, false, 'Product price')
      : undefined;

    if (priceCents === undefined) {
      throw new ValidationError('Product price or priceCents is required.');
    }
    assertValidCents(priceCents, false, 'Product price');

    const costPriceCents = input.costPriceCents !== undefined
      ? input.costPriceCents
      : input.costPrice !== undefined
      ? toCents(input.costPrice, false, 'Product cost price')
      : 0;
    assertValidCents(costPriceCents, false, 'Product cost price');

    const stock = input.stock !== undefined ? input.stock : 0;
    if (!Number.isInteger(stock) || stock < 0) {
      throw new ValidationError('Initial stock must be a non-negative integer.');
    }

    const minStockAlert = input.minStockAlert !== undefined ? input.minStockAlert : 5;
    const id = input.id || randomUUID();
    const sku = input.sku?.trim() || null;
    const barcode = input.barcode?.trim() || null;
    const description = input.description?.trim() || null;
    const badge = input.badge?.trim() || null;
    const iconType = input.iconType || 'other';
    const isActive = input.isActive === false ? 0 : 1;

    db.prepare(`
      INSERT INTO products (
        id, business_id, name, sku, barcode, category,
        price_cents, cost_price_cents, stock, min_stock_alert,
        description, badge, icon_type, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      businessId,
      name,
      sku,
      barcode,
      input.category.trim(),
      priceCents,
      costPriceCents,
      stock,
      minStockAlert,
      description,
      badge,
      iconType,
      isActive,
    );

    const created = this.findById(db, businessId, id);
    if (!created) throw new Error(`Failed to retrieve newly created product "${id}".`);
    return created;
  }

  /**
   * Updates an existing product verifying business ownership.
   */
  static update(
    db: DatabaseSync,
    businessId: string,
    id: string,
    input: UpdateProductInput,
  ): ProductRow {
    const existing = this.findById(db, businessId, id);
    if (!existing) {
      throw new NotFoundError('Product', id, businessId);
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Product name cannot be empty.');
      updates.push('name = ?');
      params.push(name);
    }

    if (input.sku !== undefined) {
      updates.push('sku = ?');
      params.push(input.sku.trim() || null);
    }

    if (input.barcode !== undefined) {
      updates.push('barcode = ?');
      params.push(input.barcode.trim() || null);
    }

    if (input.category !== undefined) {
      const category = input.category.trim();
      if (!category) throw new ValidationError('Category cannot be empty.');
      updates.push('category = ?');
      params.push(category);
    }

    if (input.priceCents !== undefined || input.price !== undefined) {
      const priceCents = input.priceCents !== undefined
        ? input.priceCents
        : toCents(input.price!, false, 'Product price');
      assertValidCents(priceCents, false, 'Product price');
      updates.push('price_cents = ?');
      params.push(priceCents);
    }

    if (input.costPriceCents !== undefined || input.costPrice !== undefined) {
      const costPriceCents = input.costPriceCents !== undefined
        ? input.costPriceCents
        : toCents(input.costPrice!, false, 'Product cost price');
      assertValidCents(costPriceCents, false, 'Product cost price');
      updates.push('cost_price_cents = ?');
      params.push(costPriceCents);
    }

    if (input.stock !== undefined) {
      if (!Number.isInteger(input.stock) || input.stock < 0) {
        throw new ValidationError('Stock must be a non-negative integer.');
      }
      updates.push('stock = ?');
      params.push(input.stock);
    }

    if (input.minStockAlert !== undefined) {
      if (!Number.isInteger(input.minStockAlert) || input.minStockAlert < 0) {
        throw new ValidationError('minStockAlert must be a non-negative integer.');
      }
      updates.push('min_stock_alert = ?');
      params.push(input.minStockAlert);
    }

    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description ? input.description.trim() : null);
    }

    if (input.badge !== undefined) {
      updates.push('badge = ?');
      params.push(input.badge ? input.badge.trim() : null);
    }

    if (input.iconType !== undefined) {
      updates.push('icon_type = ?');
      params.push(input.iconType);
    }

    if (input.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id, businessId);

    db.prepare(`
      UPDATE products
      SET ${updates.join(', ')}
      WHERE id = ? AND business_id = ?
    `).run(...params);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Product "${id}" vanished during update.`);
    return updated;
  }

  /**
   * Adjusts inventory stock for a product.
   * If delta is negative, ensures stock does not drop below zero unless explicitly allowed.
   */
  static adjustStock(
    db: DatabaseSync,
    businessId: string,
    id: string,
    deltaQuantity: number,
    allowNegative = false,
  ): ProductRow {
    if (!Number.isInteger(deltaQuantity)) {
      throw new ValidationError(`Stock adjustment delta must be an integer: ${deltaQuantity}`);
    }

    const current = this.findById(db, businessId, id);
    if (!current) {
      throw new NotFoundError('Product', id, businessId);
    }

    const newStock = current.stock + deltaQuantity;
    if (newStock < 0 && !allowNegative) {
      throw new InsufficientStockError(id, current.stock, deltaQuantity);
    }

    db.prepare(`
      UPDATE products
      SET stock = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ?
    `).run(newStock, id, businessId);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Failed to fetch product "${id}" after stock adjustment.`);
    return updated;
  }

  /**
   * Atomically adjusts stock for multiple items in a single SQLite transaction.
   * If any item has insufficient stock, the entire transaction rolls back.
   */
  static batchAdjustStock(
    db: DatabaseSync,
    businessId: string,
    adjustments: Array<{ id: string; delta: number }>,
    allowNegative = false,
  ): ProductRow[] {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const results: ProductRow[] = [];
      for (const adj of adjustments) {
        const updated = this.adjustStock(db, businessId, adj.id, adj.delta, allowNegative);
        results.push(updated);
      }
      db.exec('COMMIT;');
      return results;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  /**
   * Deletes a product verifying business ownership.
   */
  static delete(db: DatabaseSync, businessId: string, id: string): boolean {
    const existing = this.findById(db, businessId, id);
    if (!existing) return false;

    db.prepare(`
      DELETE FROM products
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    return true;
  }
}
