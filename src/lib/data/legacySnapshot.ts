/**
 * Collects leftover localStorage POS records for one-time SQLite import.
 * Does not delete source records.
 */

import { BUSINESS_KEYS, scopedKey } from '../offlineBusinessStorage';

export function collectLegacyBusinessSnapshot(businessId: string): {
  format: 'selwick-localstorage-v1';
  businessId: string;
  capturedAt: string;
  data: Record<string, string>;
  hasOperationalData: boolean;
} {
  const data: Record<string, string> = {};
  let hasOperationalData = false;

  for (const key of BUSINESS_KEYS) {
    const scoped = scopedKey(key, businessId);
    const value = localStorage.getItem(scoped);
    if (value !== null) {
      data[scoped] = value;
      if (key === 'pos_products' || key === 'pos_sales' || key === 'pos_customers' || key === 'pos_expenses') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed) && parsed.length > 0) hasOperationalData = true;
        } catch {
          hasOperationalData = true;
        }
      }
    }
  }

  const users = localStorage.getItem('selwick_offline_users_v1');
  if (users) data['selwick_offline_users_v1'] = users;

  return {
    format: 'selwick-localstorage-v1',
    businessId,
    capturedAt: new Date().toISOString(),
    data,
    hasOperationalData,
  };
}
