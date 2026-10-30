/**
 * Selwick POS – SQLite Settings Repository
 *
 * Implements key-value storage scoped per business in the `settings` table,
 * with typed mapping to and from the domain `StoreSettings` model.
 */

import { DatabaseSync } from 'node:sqlite';
import type { StoreSettings } from '@/types/pos';

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  storeName: 'Selwick Store',
  tagline: 'Point of Sale',
  phone: '',
  address: '',
  terminalId: 'POS-01',
  version: '1.0.0',
  currencySymbol: 'Rs',
  taxRate: 0,
  enableTax: false,
  defaultDiscount: 0,
  receiptHeader: 'Thank you for shopping with us!',
  receiptFooter: 'Please come again.',
  soundEnabled: true,
  printerPaperWidth: '80mm',
  theme: 'light',
};

interface SettingRow {
  business_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export class SettingsRepository {
  /**
   * Gets a single raw setting value for a business.
   */
  static get(db: DatabaseSync, businessId: string, key: string): string | null {
    const row = db.prepare(`
      SELECT value FROM settings
      WHERE business_id = ? AND key = ?
    `).get(businessId, key) as { value: string } | undefined;

    return row ? row.value : null;
  }

  /**
   * Sets or updates a single setting value.
   */
  static set(db: DatabaseSync, businessId: string, key: string, value: string): void {
    db.prepare(`
      INSERT INTO settings (business_id, key, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(business_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(businessId, key, value);
  }

  /**
   * Deletes a setting key for a business.
   */
  static delete(db: DatabaseSync, businessId: string, key: string): boolean {
    const res = db.prepare(`
      DELETE FROM settings
      WHERE business_id = ? AND key = ?
    `).run(businessId, key);

    return Number(res.changes) > 0;
  }

  /**
   * Returns all key-value settings for a business as a dictionary.
   */
  static getAll(db: DatabaseSync, businessId: string): Record<string, string> {
    const rows = db.prepare(`
      SELECT key, value FROM settings
      WHERE business_id = ?
    `).all(businessId) as SettingRow[];

    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  /**
   * Retrieves typed StoreSettings for a business, merged with defaults.
   */
  static getStoreSettings(db: DatabaseSync, businessId: string): StoreSettings {
    const all = this.getAll(db, businessId);

    // If pos_settings JSON blob is present (from migration), use it as base
    let baseBlob: Partial<StoreSettings> = {};
    if (all['pos_settings']) {
      try {
        baseBlob = JSON.parse(all['pos_settings']);
      } catch {}
    }

    return {
      storeName: all['storeName'] ?? baseBlob.storeName ?? DEFAULT_STORE_SETTINGS.storeName,
      tagline: all['tagline'] ?? baseBlob.tagline ?? DEFAULT_STORE_SETTINGS.tagline,
      phone: all['phone'] ?? baseBlob.phone ?? DEFAULT_STORE_SETTINGS.phone,
      address: all['address'] ?? baseBlob.address ?? DEFAULT_STORE_SETTINGS.address,
      terminalId: all['terminalId'] ?? baseBlob.terminalId ?? DEFAULT_STORE_SETTINGS.terminalId,
      version: all['version'] ?? baseBlob.version ?? DEFAULT_STORE_SETTINGS.version,
      currencySymbol: all['currencySymbol'] ?? baseBlob.currencySymbol ?? DEFAULT_STORE_SETTINGS.currencySymbol,
      taxRate: all['taxRate'] !== undefined
        ? parseFloat(all['taxRate'])
        : (baseBlob.taxRate ?? DEFAULT_STORE_SETTINGS.taxRate),
      enableTax: all['enableTax'] !== undefined
        ? all['enableTax'] === 'true'
        : (baseBlob.enableTax ?? DEFAULT_STORE_SETTINGS.enableTax),
      defaultDiscount: all['defaultDiscount'] !== undefined
        ? parseFloat(all['defaultDiscount'])
        : (baseBlob.defaultDiscount ?? DEFAULT_STORE_SETTINGS.defaultDiscount),
      receiptHeader: all['receiptHeader'] ?? baseBlob.receiptHeader ?? DEFAULT_STORE_SETTINGS.receiptHeader,
      receiptFooter: all['receiptFooter'] ?? baseBlob.receiptFooter ?? DEFAULT_STORE_SETTINGS.receiptFooter,
      soundEnabled: all['soundEnabled'] !== undefined
        ? all['soundEnabled'] === 'true'
        : (baseBlob.soundEnabled ?? DEFAULT_STORE_SETTINGS.soundEnabled),
      printerPaperWidth: (all['printerPaperWidth'] as StoreSettings['printerPaperWidth']) ??
        baseBlob.printerPaperWidth ?? DEFAULT_STORE_SETTINGS.printerPaperWidth,
      theme: (all['theme'] as StoreSettings['theme']) ??
        baseBlob.theme ?? DEFAULT_STORE_SETTINGS.theme,
      businessType: all['businessType'] ?? baseBlob.businessType,
    };
  }

  /**
   * Updates multiple StoreSettings in a single transaction.
   */
  static updateStoreSettings(
    db: DatabaseSync,
    businessId: string,
    updates: Partial<StoreSettings>,
  ): StoreSettings {
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) {
          this.set(db, businessId, k, String(v));
        }
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return this.getStoreSettings(db, businessId);
  }
}
