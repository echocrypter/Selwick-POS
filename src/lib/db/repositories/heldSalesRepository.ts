/**
 * Selwick POS – SQLite Held Sales Repository
 *
 * Implements business-scoped, parameterized operations on the `held_sales` table.
 * Held sales store parked orders without deducting inventory until checkout.
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from './errors';
import type { HeldSale, CartItem, Customer } from '@/types/pos';

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

export interface CreateHeldSaleInput {
  id?: string;
  invoiceNumber: string;
  dateStr?: string;
  timestamp?: number;
  items: CartItem[];
  customer?: Customer | null;
  note?: string;
}

export interface UpdateHeldSaleInput {
  items?: CartItem[];
  customer?: Customer | null;
  note?: string;
}

/**
 * Maps a SQLite HeldSaleRow to domain HeldSale interface.
 */
export function toDomainHeldSale(row: HeldSaleRow): HeldSale {
  let items: CartItem[] = [];
  try {
    items = JSON.parse(row.items_json);
  } catch {
    items = [];
  }

  let customer: Customer | undefined;
  if (row.customer_json) {
    try {
      customer = JSON.parse(row.customer_json);
    } catch {
      customer = undefined;
    }
  }

  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    dateStr: row.date_str,
    timestamp: row.timestamp,
    items,
    customer,
    note: row.note ?? undefined,
  };
}

export class HeldSalesRepository {
  /**
   * Finds a held sale by ID within business scope.
   */
  static findById(db: DatabaseSync, businessId: string, id: string): HeldSaleRow | null {
    const row = db.prepare(`
      SELECT * FROM held_sales
      WHERE id = ? AND business_id = ?
    `).get(id, businessId) as HeldSaleRow | undefined;

    return row || null;
  }

  /**
   * Lists all held sales for a business ordered by newest first.
   */
  static list(db: DatabaseSync, businessId: string): HeldSaleRow[] {
    return db.prepare(`
      SELECT * FROM held_sales
      WHERE business_id = ?
      ORDER BY timestamp DESC, created_at DESC
    `).all(businessId) as HeldSaleRow[];
  }

  /**
   * Inserts a new parked held sale scoped to the business.
   * Does NOT deduct inventory.
   */
  static create(db: DatabaseSync, businessId: string, input: CreateHeldSaleInput): HeldSaleRow {
    const invoiceNumber = input.invoiceNumber?.trim();
    if (!invoiceNumber) {
      throw new ValidationError('Invoice number is required for held sale.');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ValidationError('Held sale must contain at least one item.');
    }

    const id = input.id || `held-${randomUUID()}`;
    const now = new Date();
    const dateStr = input.dateStr || now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timestamp = input.timestamp || now.getTime();
    const itemsJson = JSON.stringify(input.items);
    const customerJson = input.customer ? JSON.stringify(input.customer) : null;
    const note = input.note ? input.note.trim() : null;

    db.prepare(`
      INSERT INTO held_sales (
        id, business_id, invoice_number, date_str, timestamp, customer_json, note, items_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, businessId, invoiceNumber, dateStr, timestamp, customerJson, note, itemsJson);

    const created = this.findById(db, businessId, id);
    if (!created) throw new Error(`Failed to retrieve newly created held sale "${id}".`);
    return created;
  }

  /**
   * Updates an existing held sale verifying business ownership.
   */
  static update(
    db: DatabaseSync,
    businessId: string,
    id: string,
    input: UpdateHeldSaleInput,
  ): HeldSaleRow {
    const existing = this.findById(db, businessId, id);
    if (!existing) {
      throw new NotFoundError('HeldSale', id, businessId);
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.items !== undefined) {
      if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new ValidationError('Held sale items cannot be empty.');
      }
      updates.push('items_json = ?');
      params.push(JSON.stringify(input.items));
    }

    if (input.customer !== undefined) {
      updates.push('customer_json = ?');
      params.push(input.customer ? JSON.stringify(input.customer) : null);
    }

    if (input.note !== undefined) {
      updates.push('note = ?');
      params.push(input.note ? input.note.trim() : null);
    }

    if (updates.length === 0) return existing;

    params.push(id, businessId);
    db.prepare(`
      UPDATE held_sales
      SET ${updates.join(', ')}
      WHERE id = ? AND business_id = ?
    `).run(...params);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Held sale "${id}" vanished during update.`);
    return updated;
  }

  /**
   * Deletes a held sale upon checkout or cancellation.
   */
  static delete(db: DatabaseSync, businessId: string, id: string): boolean {
    const existing = this.findById(db, businessId, id);
    if (!existing) return false;

    db.prepare(`
      DELETE FROM held_sales
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    return true;
  }
}
