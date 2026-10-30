/**
 * Selwick POS — License Server Database Subsystem.
 *
 * COMPLETELY SEPARATE from the operational POS database (selwick.db).
 * Manages licenses, customer records, plan limits, and device activations.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

let licenseDbInstance: DatabaseSync | null = null;

export const LICENSE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('trial', 'monthly', 'yearly', 'lifetime')),
  max_devices INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'suspended', 'revoked')) DEFAULT 'active',
  features TEXT NOT NULL DEFAULT '[]', -- JSON string array
  issued_at TEXT NOT NULL,
  expires_at TEXT, -- NULL for lifetime licenses
  payment_reference TEXT,
  payment_provider TEXT,
  payment_status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'deactivated')) DEFAULT 'active',
  ip_address TEXT,
  UNIQUE(license_id, device_id)
);

CREATE TABLE IF NOT EXISTS license_audit_logs (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin',
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_activations_license_device ON activations(license_id, device_id);
CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id);
CREATE INDEX IF NOT EXISTS idx_license_audit_license_id ON license_audit_logs(license_id);
`;

function migrateLicenseSchemaIfNeeded(db: DatabaseSync): void {
  const licenseCols = db.prepare("PRAGMA table_info(licenses)").all() as Array<{ name: string }>;
  const names = new Set(licenseCols.map((c) => c.name));
  
  if (!names.has('payment_reference')) {
    try { db.exec('ALTER TABLE licenses ADD COLUMN payment_reference TEXT;'); } catch {}
  }
  if (!names.has('payment_provider')) {
    try { db.exec('ALTER TABLE licenses ADD COLUMN payment_provider TEXT;'); } catch {}
  }
  if (!names.has('payment_status')) {
    try { db.exec('ALTER TABLE licenses ADD COLUMN payment_status TEXT;'); } catch {}
  }
  if (!names.has('notes')) {
    try { db.exec('ALTER TABLE licenses ADD COLUMN notes TEXT;'); } catch {}
  }

  const auditCols = db.prepare("PRAGMA table_info(license_audit_logs)").all() as Array<{ name: string }>;
  const auditNames = new Set(auditCols.map((c) => c.name));
  if (!auditNames.has('actor')) {
    try { db.exec("ALTER TABLE license_audit_logs ADD COLUMN actor TEXT NOT NULL DEFAULT 'admin';"); } catch {}
  }
}

export function getLicenseDatabase(explicitPath?: string): DatabaseSync {
  if (licenseDbInstance && !explicitPath) return licenseDbInstance;

  const dbPath = explicitPath || process.env.SELWICK_LICENSE_DB_PATH || path.join(process.cwd(), '.data', 'license_server.db');
  
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(LICENSE_SCHEMA_SQL);
  migrateLicenseSchemaIfNeeded(db);

  if (!explicitPath) {
    licenseDbInstance = db;
  }
  return db;
}

export function closeLicenseDatabase(): void {
  if (licenseDbInstance) {
    try {
      licenseDbInstance.close();
    } catch {}
    licenseDbInstance = null;
  }
}
