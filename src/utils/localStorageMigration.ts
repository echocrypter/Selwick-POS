'use client';

export type BackupSummary = {
  totalKeys: number;
  origin?: string;
  exportedAt?: string;
  accounts: { count: number; roles: string[]; usernames: string[] };
  businesses: Record<string, {
    productsCount: number;
    customersCount: number;
    salesCount: number;
    expensesCount: number;
    hasSettings: boolean;
    categoriesCount: number;
  }>;
  unscopedData: {
    productsCount: number;
    customersCount: number;
    salesCount: number;
    hasSettings: boolean;
  };
  keyNames: string[];
  newKeys: string[];
  conflictingKeys: string[];
};

export type FullBackupPayload = {
  format: 'selwick-localstorage-v1';
  exportedAt: string;
  sourceOrigin: string;
  app: 'selwick-pos';
  totalKeys: number;
  data: Record<string, string>;
};

/**
 * Safely exports all keys in window.localStorage as a structured JSON file.
 * Preserves exact key names and string values without transformation.
 */
export function exportAllLocalStorage(): FullBackupPayload {
  if (typeof window === 'undefined') {
    throw new Error('Export is only available in a browser environment.');
  }

  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (value !== null) {
      data[key] = value;
    }
  }

  const payload: FullBackupPayload = {
    format: 'selwick-localstorage-v1',
    exportedAt: new Date().toISOString(),
    sourceOrigin: window.location.origin,
    app: 'selwick-pos',
    totalKeys: Object.keys(data).length,
    data,
  };

  return payload;
}

/**
 * Triggers a browser download of the exported JSON payload.
 */
export function downloadBackupJson(payload: FullBackupPayload | Record<string, string>, filenamePrefix = 'selwick-localstorage-backup'): string {
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${filenamePrefix}-${timestamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return filename;
}

/**
 * Parses and validates an imported JSON string.
 * Supports both Format A (structured full backup) and Format B (flat key-value dictionary like selwick-localstorage-backup.json).
 */
export function validateAndAnalyzeBackup(rawJson: string): {
  data: Record<string, string>;
  summary: BackupSummary;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The backup must be a JSON object containing storage keys.');
  }

  const recordObj = parsed as Record<string, unknown>;
  let dataMap: Record<string, string> = {};
  let origin: string | undefined;
  let exportedAt: string | undefined;

  if (recordObj.format === 'selwick-localstorage-v1' && typeof recordObj.data === 'object' && recordObj.data !== null) {
    // Structured format
    const rawData = recordObj.data as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawData)) {
      if (typeof v === 'string') dataMap[k] = v;
      else if (v !== null && v !== undefined) dataMap[k] = JSON.stringify(v);
    }
    origin = typeof recordObj.sourceOrigin === 'string' ? recordObj.sourceOrigin : undefined;
    exportedAt = typeof recordObj.exportedAt === 'string' ? recordObj.exportedAt : undefined;
  } else {
    // Flat key-value format (like selwick-localstorage-backup.json)
    for (const [k, v] of Object.entries(recordObj)) {
      if (typeof v === 'string') dataMap[k] = v;
      else if (v !== null && v !== undefined) dataMap[k] = JSON.stringify(v);
    }
  }

  const keyNames = Object.keys(dataMap);
  if (keyNames.length === 0) {
    throw new Error('The backup file contains no storage keys.');
  }

  // Verify at least one Selwick / POS key is present to prevent importing random JSON files
  const hasPosKeys = keyNames.some(
    (k) => k.startsWith('pos_') || k.startsWith('selwick_') || k.startsWith('sb-')
  );
  if (!hasPosKeys) {
    throw new Error('The backup does not appear to be a Selwick POS LocalStorage backup.');
  }

  // Validate users JSON if present
  let accountInfo = { count: 0, roles: [] as string[], usernames: [] as string[] };
  if (dataMap['selwick_offline_users_v1']) {
    try {
      const users = JSON.parse(dataMap['selwick_offline_users_v1']);
      if (Array.isArray(users)) {
        accountInfo.count = users.length;
        accountInfo.roles = [...new Set(users.map((u: { role?: string }) => u?.role || 'user'))];
        accountInfo.usernames = users.map((u: { name?: string }) => (u?.name || 'User').trim());
      }
    } catch {
      throw new Error('Corrupted offline accounts in backup: selwick_offline_users_v1 is not valid JSON.');
    }
  }

  // Parse businesses and item counts
  const businesses: BackupSummary['businesses'] = {};
  const businessKeyRegex = /^selwick_business:([^:]+):pos_(products|customers|sales|expenses|settings|categories|held)$/;

  for (const k of keyNames) {
    const match = k.match(businessKeyRegex);
    if (match) {
      const bId = match[1];
      const kind = match[2];
      if (!businesses[bId]) {
        businesses[bId] = {
          productsCount: 0,
          customersCount: 0,
          salesCount: 0,
          expensesCount: 0,
          hasSettings: false,
          categoriesCount: 0,
        };
      }
      try {
        const val = JSON.parse(dataMap[k]);
        if (kind === 'products' && Array.isArray(val)) businesses[bId].productsCount = val.length;
        if (kind === 'customers' && Array.isArray(val)) businesses[bId].customersCount = val.length;
        if (kind === 'sales' && Array.isArray(val)) businesses[bId].salesCount = val.length;
        if (kind === 'expenses' && Array.isArray(val)) businesses[bId].expensesCount = val.length;
        if (kind === 'categories' && Array.isArray(val)) businesses[bId].categoriesCount = val.length;
        if (kind === 'settings') businesses[bId].hasSettings = true;
      } catch {
        // Individual field parsing error warning
      }
    }
  }

  // Unscoped data counts
  const unscopedData: BackupSummary['unscopedData'] = {
    productsCount: 0,
    customersCount: 0,
    salesCount: 0,
    hasSettings: false,
  };
  try {
    if (dataMap['pos_products']) {
      const p = JSON.parse(dataMap['pos_products']);
      if (Array.isArray(p)) unscopedData.productsCount = p.length;
    }
    if (dataMap['pos_customers']) {
      const c = JSON.parse(dataMap['pos_customers']);
      if (Array.isArray(c)) unscopedData.customersCount = c.length;
    }
    if (dataMap['pos_sales']) {
      const s = JSON.parse(dataMap['pos_sales']);
      if (Array.isArray(s)) unscopedData.salesCount = s.length;
    }
    if (dataMap['pos_settings']) {
      unscopedData.hasSettings = true;
    }
  } catch {
    // Non-fatal
  }

  // Check conflicts with current localStorage
  const newKeys: string[] = [];
  const conflictingKeys: string[] = [];
  if (typeof window !== 'undefined') {
    for (const k of keyNames) {
      if (localStorage.getItem(k) !== null) {
        conflictingKeys.push(k);
      } else {
        newKeys.push(k);
      }
    }
  }

  return {
    data: dataMap,
    summary: {
      totalKeys: keyNames.length,
      origin,
      exportedAt,
      accounts: accountInfo,
      businesses,
      unscopedData,
      keyNames: keyNames.sort(),
      newKeys: newKeys.sort(),
      conflictingKeys: conflictingKeys.sort(),
    },
  };
}

/**
 * Writes validated data into localStorage and immediately reads back every key to verify integrity.
 * Returns an array of verified key names.
 */
export function executeLocalStorageImport(data: Record<string, string>): {
  writtenCount: number;
  verifiedCount: number;
  mismatches: string[];
} {
  if (typeof window === 'undefined') {
    throw new Error('Import is only available in a browser environment.');
  }

  const keys = Object.keys(data);
  for (const key of keys) {
    localStorage.setItem(key, data[key]);
  }

  // Post-write verification
  let verifiedCount = 0;
  const mismatches: string[] = [];

  for (const key of keys) {
    const readValue = localStorage.getItem(key);
    if (readValue === data[key]) {
      verifiedCount++;
    } else {
      mismatches.push(key);
    }
  }

  return {
    writtenCount: keys.length,
    verifiedCount,
    mismatches,
  };
}
