/**
 * Selwick POS – SQLite Customer Repository
 *
 * Implements business-scoped, parameterized, transactional operations on the `customers` table.
 * All balance and spending metrics are stored as integer minor units (paisa/cents).
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { assertValidCents, fromCents, toCents, add } from '@/lib/money';
import { NotFoundError, ValidationError } from './errors';
import type { Customer } from '@/types/pos';

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

export interface CreateCustomerInput {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  balanceCents?: number;
  balance?: number;
  loyaltyPoints?: number;
  totalOrders?: number;
  totalSpentCents?: number;
  totalSpent?: number;
  createdAt?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  email?: string | null;
  address?: string | null;
  balanceCents?: number;
  balance?: number;
  loyaltyPoints?: number;
  totalOrders?: number;
  totalSpentCents?: number;
  totalSpent?: number;
}

/**
 * Maps a SQLite CustomerRow to domain Customer interface.
 */
export function toDomainCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    balance: fromCents(row.balance_cents, true),
    loyaltyPoints: row.loyalty_points,
    totalOrders: row.total_orders,
    totalSpent: fromCents(row.total_spent_cents, false),
    createdAt: row.created_at,
  };
}

export class CustomerRepository {
  /**
   * Finds a customer by ID within a specific business scope.
   */
  static findById(db: DatabaseSync, businessId: string, id: string): CustomerRow | null {
    const row = db.prepare(`
      SELECT * FROM customers
      WHERE id = ? AND business_id = ?
    `).get(id, businessId) as CustomerRow | undefined;

    return row || null;
  }

  /**
   * Finds a customer by phone number within a business scope.
   */
  static findByPhone(db: DatabaseSync, businessId: string, phone: string): CustomerRow | null {
    const cleanPhone = phone?.trim();
    if (!cleanPhone) return null;

    const row = db.prepare(`
      SELECT * FROM customers
      WHERE business_id = ? AND phone = ?
      LIMIT 1
    `).get(businessId, cleanPhone) as CustomerRow | undefined;

    return row || null;
  }

  /**
   * Lists customers for a business with optional search.
   */
  static list(
    db: DatabaseSync,
    businessId: string,
    options?: { search?: string },
  ): CustomerRow[] {
    let sql = 'SELECT * FROM customers WHERE business_id = ?';
    const params: string[] = [businessId];

    if (options?.search) {
      sql += ' AND (lower(name) LIKE ? OR phone LIKE ?)';
      const term = `%${options.search.toLowerCase()}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY name ASC';
    return db.prepare(sql).all(...params) as CustomerRow[];
  }

  /**
   * Inserts a new customer scoped to the business.
   */
  static create(db: DatabaseSync, businessId: string, input: CreateCustomerInput): CustomerRow {
    const name = input.name?.trim();
    const phone = input.phone?.trim();

    if (!name) throw new ValidationError('Customer name is required.');
    if (!phone) throw new ValidationError('Customer phone number is required.');

    const balanceCents = input.balanceCents !== undefined
      ? input.balanceCents
      : input.balance !== undefined
      ? toCents(input.balance, true, 'Customer balance')
      : 0;
    assertValidCents(balanceCents, true, 'Customer balance');

    const totalSpentCents = input.totalSpentCents !== undefined
      ? input.totalSpentCents
      : input.totalSpent !== undefined
      ? toCents(input.totalSpent, false, 'Customer total spent')
      : 0;
    assertValidCents(totalSpentCents, false, 'Customer total spent');

    const loyaltyPoints = input.loyaltyPoints !== undefined ? input.loyaltyPoints : 0;
    const totalOrders = input.totalOrders !== undefined ? input.totalOrders : 0;

    const id = input.id || randomUUID();
    const email = input.email?.trim() || null;
    const address = input.address?.trim() || null;

    db.prepare(`
      INSERT INTO customers (
        id, business_id, name, phone, email, address,
        balance_cents, loyalty_points, total_orders, total_spent_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      businessId,
      name,
      phone,
      email,
      address,
      balanceCents,
      loyaltyPoints,
      totalOrders,
      totalSpentCents,
    );

    const created = this.findById(db, businessId, id);
    if (!created) throw new Error(`Failed to retrieve newly created customer "${id}".`);
    return created;
  }

  /**
   * Updates an existing customer verifying business ownership.
   */
  static update(
    db: DatabaseSync,
    businessId: string,
    id: string,
    input: UpdateCustomerInput,
  ): CustomerRow {
    const existing = this.findById(db, businessId, id);
    if (!existing) {
      throw new NotFoundError('Customer', id, businessId);
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Customer name cannot be empty.');
      updates.push('name = ?');
      params.push(name);
    }

    if (input.phone !== undefined) {
      const phone = input.phone.trim();
      if (!phone) throw new ValidationError('Customer phone cannot be empty.');
      updates.push('phone = ?');
      params.push(phone);
    }

    if (input.email !== undefined) {
      updates.push('email = ?');
      params.push(input.email ? input.email.trim() : null);
    }

    if (input.address !== undefined) {
      updates.push('address = ?');
      params.push(input.address ? input.address.trim() : null);
    }

    if (input.balanceCents !== undefined || input.balance !== undefined) {
      const balanceCents = input.balanceCents !== undefined
        ? input.balanceCents
        : toCents(input.balance!, true, 'Customer balance');
      assertValidCents(balanceCents, true, 'Customer balance');
      updates.push('balance_cents = ?');
      params.push(balanceCents);
    }

    if (input.loyaltyPoints !== undefined) {
      if (!Number.isInteger(input.loyaltyPoints)) {
        throw new ValidationError('Loyalty points must be an integer.');
      }
      updates.push('loyalty_points = ?');
      params.push(input.loyaltyPoints);
    }

    if (input.totalOrders !== undefined) {
      if (!Number.isInteger(input.totalOrders) || input.totalOrders < 0) {
        throw new ValidationError('Total orders must be a non-negative integer.');
      }
      updates.push('total_orders = ?');
      params.push(input.totalOrders);
    }

    if (input.totalSpentCents !== undefined || input.totalSpent !== undefined) {
      const spentCents = input.totalSpentCents !== undefined
        ? input.totalSpentCents
        : toCents(input.totalSpent!, false, 'Customer total spent');
      assertValidCents(spentCents, false, 'Customer total spent');
      updates.push('total_spent_cents = ?');
      params.push(spentCents);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id, businessId);

    db.prepare(`
      UPDATE customers
      SET ${updates.join(', ')}
      WHERE id = ? AND business_id = ?
    `).run(...params);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Customer "${id}" vanished during update.`);
    return updated;
  }

  /**
   * Adjusts customer account balance (e.g. store credit or debt).
   * Positive delta increases balance; negative delta decreases balance.
   */
  static adjustBalance(
    db: DatabaseSync,
    businessId: string,
    id: string,
    deltaCents: number,
  ): CustomerRow {
    assertValidCents(deltaCents, true, 'Balance adjustment delta');

    const customer = this.findById(db, businessId, id);
    if (!customer) {
      throw new NotFoundError('Customer', id, businessId);
    }

    const newBalance = add(customer.balance_cents, deltaCents);
    db.prepare(`
      UPDATE customers
      SET balance_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ?
    `).run(newBalance, id, businessId);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Failed to fetch customer "${id}" after balance adjustment.`);
    return updated;
  }

  /**
   * Records a completed order against a customer account.
   */
  static recordOrder(
    db: DatabaseSync,
    businessId: string,
    id: string,
    orderTotalCents: number,
    pointsEarned = 0,
  ): CustomerRow {
    assertValidCents(orderTotalCents, false, 'Order total');
    if (!Number.isInteger(pointsEarned) || pointsEarned < 0) {
      throw new ValidationError('Points earned must be a non-negative integer.');
    }

    const customer = this.findById(db, businessId, id);
    if (!customer) {
      throw new NotFoundError('Customer', id, businessId);
    }

    const newTotalOrders = customer.total_orders + 1;
    const newTotalSpent = add(customer.total_spent_cents, orderTotalCents);
    const newPoints = customer.loyalty_points + pointsEarned;

    db.prepare(`
      UPDATE customers
      SET total_orders = ?, total_spent_cents = ?, loyalty_points = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ?
    `).run(newTotalOrders, newTotalSpent, newPoints, id, businessId);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Failed to fetch customer "${id}" after recording order.`);
    return updated;
  }

  /**
   * Deletes a customer verifying business ownership.
   */
  static delete(db: DatabaseSync, businessId: string, id: string): boolean {
    const existing = this.findById(db, businessId, id);
    if (!existing) return false;

    db.prepare(`
      DELETE FROM customers
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    return true;
  }
}
