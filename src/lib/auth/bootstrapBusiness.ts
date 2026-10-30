/**
 * Creates a new local business and its first owner in SQLite.
 * Used for first-run signup. Never trusts client-supplied password hashes.
 */

import { randomUUID } from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { generateSalt, hashPin } from './crypto.ts';
import { SettingsRepository } from '../db/repositories/settingsRepository.ts';

export class BootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapBusinessInput {
  businessId?: string;
  businessName: string;
  ownerName: string;
  pin: string;
  address?: string;
  phone?: string;
  businessType?: string;
  ownerId?: string;
}

export interface BootstrapBusinessResult {
  created: boolean;
  businessId: string;
  userId: string;
  role: 'owner';
  name: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bootstrapBusiness(
  db: DatabaseSync,
  input: BootstrapBusinessInput,
): Promise<BootstrapBusinessResult> {
  const businessName = (input.businessName || '').trim();
  const ownerName = (input.ownerName || '').trim();
  const pin = (input.pin || '').trim();
  const address = (input.address || '').trim();
  const phone = (input.phone || '').trim();
  const businessType = (input.businessType || 'retail').trim() || 'retail';

  if (!businessName || !ownerName || !pin) {
    throw new BootstrapError('BAD_REQUEST', 'businessName, ownerName, and pin are required.');
  }
  if (!/^\d{4,8}$/.test(pin)) {
    throw new BootstrapError('INVALID_PIN', 'PIN must be 4 to 8 numeric digits.');
  }
  if (ownerName.includes('@') || /\s/.test(ownerName) || ownerName.length < 2) {
    throw new BootstrapError('INVALID_NAME', 'Username must have at least 2 characters, with no spaces or email.');
  }

  let businessId = (input.businessId || '').trim() || randomUUID();
  if (!UUID_REGEX.test(businessId)) {
    throw new BootstrapError('INVALID_ID', 'businessId must be a valid UUID.');
  }

  const existingBusiness = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId) as
    | { id: string }
    | undefined;

  if (existingBusiness) {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE business_id = ?').get(businessId) as { c: number };
    if (Number(userCount?.c || 0) > 0) {
      throw new BootstrapError(
        'BUSINESS_EXISTS',
        'This business already exists. Sign in instead of creating a new owner.',
        409,
      );
    }
  }

  const nameTaken = db.prepare(
    'SELECT id FROM users WHERE business_id = ? AND lower(name) = lower(?)',
  ).get(businessId, ownerName) as { id: string } | undefined;
  if (nameTaken) {
    throw new BootstrapError('DUPLICATE_NAME', 'A user with this name already exists in this business.', 409);
  }

  const userId = (input.ownerId || '').trim() || randomUUID();
  if (!UUID_REGEX.test(userId)) {
    throw new BootstrapError('INVALID_ID', 'ownerId must be a valid UUID.');
  }

  const salt = generateSalt();
  const hash = await hashPin(pin, salt);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (!existingBusiness) {
      db.prepare(`
        INSERT INTO businesses (id, name, business_type)
        VALUES (?, ?, ?)
      `).run(businessId, businessName, businessType);
    } else {
      db.prepare(`
        UPDATE businesses SET name = ?, business_type = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(businessName, businessType, businessId);
    }

    db.prepare(`
      INSERT INTO users (id, business_id, name, role, salt, hash)
      VALUES (?, ?, ?, 'owner', ?, ?)
    `).run(userId, businessId, ownerName, salt, hash);

    SettingsRepository.set(db, businessId, 'storeName', businessName);
    SettingsRepository.set(db, businessId, 'address', address);
    SettingsRepository.set(db, businessId, 'phone', phone);
    SettingsRepository.set(db, businessId, 'businessType', businessType);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    created: true,
    businessId,
    userId,
    role: 'owner',
    name: ownerName,
  };
}
