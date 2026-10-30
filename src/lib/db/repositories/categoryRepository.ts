/**
 * Selwick POS – SQLite Category Repository
 *
 * Implements business-scoped, parameterized operations on the `categories` table.
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { NotFoundError, ConflictError, ValidationError } from './errors';

export interface CategoryRow {
  id: string;
  business_id: string;
  name: string;
  display_order: number;
}

export interface CreateCategoryInput {
  id?: string;
  name: string;
  displayOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  displayOrder?: number;
}

export class CategoryRepository {
  /**
   * Finds a category by ID within a business scope.
   */
  static findById(db: DatabaseSync, businessId: string, id: string): CategoryRow | null {
    const row = db.prepare(`
      SELECT * FROM categories
      WHERE id = ? AND business_id = ?
    `).get(id, businessId) as CategoryRow | undefined;

    return row || null;
  }

  /**
   * Finds a category by name within a business scope (case-insensitive).
   */
  static findByName(db: DatabaseSync, businessId: string, name: string): CategoryRow | null {
    const clean = name?.trim();
    if (!clean) return null;

    const row = db.prepare(`
      SELECT * FROM categories
      WHERE business_id = ? AND lower(name) = lower(?)
      LIMIT 1
    `).get(businessId, clean) as CategoryRow | undefined;

    return row || null;
  }

  /**
   * Lists all categories for a business ordered by display order then name.
   */
  static list(db: DatabaseSync, businessId: string): CategoryRow[] {
    return db.prepare(`
      SELECT * FROM categories
      WHERE business_id = ?
      ORDER BY display_order ASC, name ASC
    `).all(businessId) as CategoryRow[];
  }

  /**
   * Inserts a new category scoped to the business.
   */
  static create(db: DatabaseSync, businessId: string, input: CreateCategoryInput): CategoryRow {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Category name is required.');

    const existing = this.findByName(db, businessId, name);
    if (existing) {
      throw new ConflictError('Category', 'name', name);
    }

    const id = input.id || randomUUID();
    const displayOrder = input.displayOrder !== undefined ? input.displayOrder : 0;

    db.prepare(`
      INSERT INTO categories (id, business_id, name, display_order)
      VALUES (?, ?, ?, ?)
    `).run(id, businessId, name, displayOrder);

    const created = this.findById(db, businessId, id);
    if (!created) throw new Error(`Failed to retrieve newly created category "${id}".`);
    return created;
  }

  /**
   * Updates an existing category verifying business ownership.
   */
  static update(
    db: DatabaseSync,
    businessId: string,
    id: string,
    input: UpdateCategoryInput,
  ): CategoryRow {
    const existing = this.findById(db, businessId, id);
    if (!existing) {
      throw new NotFoundError('Category', id, businessId);
    }

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Category name cannot be empty.');
      
      const dup = this.findByName(db, businessId, name);
      if (dup && dup.id !== id) {
        throw new ConflictError('Category', 'name', name);
      }

      updates.push('name = ?');
      params.push(name);
    }

    if (input.displayOrder !== undefined) {
      if (!Number.isInteger(input.displayOrder)) {
        throw new ValidationError('Display order must be an integer.');
      }
      updates.push('display_order = ?');
      params.push(input.displayOrder);
    }

    if (updates.length === 0) return existing;

    params.push(id, businessId);
    db.prepare(`
      UPDATE categories
      SET ${updates.join(', ')}
      WHERE id = ? AND business_id = ?
    `).run(...params);

    const updated = this.findById(db, businessId, id);
    if (!updated) throw new Error(`Category "${id}" vanished during update.`);
    return updated;
  }

  /**
   * Updates display order for a list of category IDs in a single transaction.
   */
  static reorder(db: DatabaseSync, businessId: string, orderedIds: string[]): CategoryRow[] {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const stmt = db.prepare(`
        UPDATE categories
        SET display_order = ?
        WHERE id = ? AND business_id = ?
      `);

      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i], businessId);
      }

      db.exec('COMMIT;');
      return this.list(db, businessId);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Deletes a category verifying business ownership.
   */
  static delete(db: DatabaseSync, businessId: string, id: string): boolean {
    const existing = this.findById(db, businessId, id);
    if (!existing) return false;

    db.prepare(`
      DELETE FROM categories
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    return true;
  }
}
