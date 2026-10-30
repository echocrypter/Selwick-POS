/**
 * Selwick POS – SQLite Expense Repository
 *
 * Implements business-scoped, parameterized operations on the `expenses` table.
 * All expense amounts are stored strictly as integer minor units (paisa/cents).
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { assertValidCents, fromCents, toCents } from '@/lib/money';
import { NotFoundError, ValidationError } from './errors';
import type { BusinessExpense } from '@/components/pos/ExpensesReportsView';

export interface ExpenseRow {
  id: string;
  business_id: string;
  date: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount_cents: number;
  created_at: string;
}

export interface CreateExpenseInput {
  id?: string;
  date: string;
  category: string;
  description: string;
  amountCents?: number;
  amount?: number; // Major unit alternative
  createdAt?: string;
}

export interface UpdateExpenseInput {
  date?: string;
  category?: string;
  description?: string;
  amountCents?: number;
  amount?: number;
}

/**
 * Maps a SQLite ExpenseRow to the domain BusinessExpense interface.
 */
export function toDomainExpense(row: ExpenseRow): BusinessExpense {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    description: row.description,
    amount: fromCents(row.amount_cents),
    createdAt: row.created_at,
  };
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ExpenseRepository {
  /**
   * Finds an expense by ID within business scope.
   */
  static findById(db: DatabaseSync, businessId: string, id: string): ExpenseRow | null {
    const row = db.prepare(`
      SELECT * FROM expenses
      WHERE id = ? AND business_id = ?
    `).get(id, businessId) as ExpenseRow | undefined;

    return row || null;
  }

  /**
   * Lists expenses for a business with optional date range and category filtering.
   */
  static list(
    db: DatabaseSync,
    businessId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      category?: string;
    },
  ): ExpenseRow[] {
    let sql = 'SELECT * FROM expenses WHERE business_id = ?';
    const params: string[] = [businessId];

    if (options?.startDate) {
      sql += ' AND date >= ?';
      params.push(options.startDate);
    }

    if (options?.endDate) {
      sql += ' AND date <= ?';
      params.push(options.endDate);
    }

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY date DESC, created_at DESC';
    return db.prepare(sql).all(...params) as ExpenseRow[];
  }

  /**
   * Inserts a new expense record scoped to the business.
   */
  static create(db: DatabaseSync, businessId: string, input: CreateExpenseInput): ExpenseRow {
    const date = input.date?.trim();
    const category = input.category?.trim();
    const description = input.description?.trim();

    if (!date || !DATE_REGEX.test(date)) {
      throw new ValidationError(`Expense date must be in YYYY-MM-DD format: "${input.date}".`);
    }
    if (!category) throw new ValidationError('Expense category is required.');
    if (!description) throw new ValidationError('Expense description is required.');

    const amountCents = input.amountCents !== undefined
      ? input.amountCents
      : input.amount !== undefined
      ? toCents(input.amount, false, 'Expense amount')
      : undefined;

    if (amountCents === undefined) {
      throw new ValidationError('Expense amount or amountCents is required.');
    }
    assertValidCents(amountCents, false, 'Expense amount');

    const id = input.id || randomUUID();

    db.prepare(`
      INSERT INTO expenses (id, business_id, date, category, description, amount_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, businessId, date, category, description, amountCents);

    const created = this.findById(db, businessId, id);
    if (!created) throw new Error(`Failed to retrieve newly created expense "${id}".`);
    return created;
  }

  /**
   * Updates an existing expense verifying business ownership.
   */
  static update(
    db: DatabaseSync,
    businessId: string,
    id: string,
    input: UpdateExpenseInput,
  ): ExpenseRow {
    const existing = this.findById(db, businessId, id);
    if (!existing) {
      throw new NotFoundError('Expense', id, businessId);
    }

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.date !== undefined) {
      const date = input.date.trim();
      if (!DATE_REGEX.test(date)) {
        throw new ValidationError(`Expense date must be in YYYY-MM-DD format: "${input.date}".`);
      }
      updates.push('date = ?');
      params.push(date);
    }

    if (input.category !== undefined) {
      const category = input.category.trim();
      if (!category) throw new ValidationError('Expense category cannot be empty.');
      updates.push('category = ?');
      params.push(category);
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) throw new ValidationError('Expense description cannot be empty.');
      updates.push('description = ?');
      params.push(description);
    }

    if (input.amountCents !== undefined || input.amount !== undefined) {
      const amountCents = input.amountCents !== undefined
        ? input.amountCents
        : toCents(input.amount!, false, 'Expense amount');
      assertValidCents(amountCents, false, 'Expense amount');
      updates.push('amount_cents = ?');
      params.push(amountCents);
    }

    if (updates.length === 0) return existing;

    params.push(id, businessId);
    db.prepare(`
      UPDATE expenses
      SET ${updates.join(', ')}
      WHERE id = ? AND business_id = ?
    `).run(...params);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Expense "${id}" vanished during update.`);
    return updated;
  }

  /**
   * Deletes an expense verifying business ownership.
   */
  static delete(db: DatabaseSync, businessId: string, id: string): boolean {
    const existing = this.findById(db, businessId, id);
    if (!existing) return false;

    db.prepare(`
      DELETE FROM expenses
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    return true;
  }

  /**
   * Returns total expenses in integer minor units (paisa) for a period.
   */
  static getTotalAmountCents(
    db: DatabaseSync,
    businessId: string,
    options?: { startDate?: string; endDate?: string; category?: string },
  ): number {
    let sql = 'SELECT COALESCE(SUM(amount_cents), 0) as total FROM expenses WHERE business_id = ?';
    const params: string[] = [businessId];

    if (options?.startDate) {
      sql += ' AND date >= ?';
      params.push(options.startDate);
    }
    if (options?.endDate) {
      sql += ' AND date <= ?';
      params.push(options.endDate);
    }
    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    const row = db.prepare(sql).get(...params) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
