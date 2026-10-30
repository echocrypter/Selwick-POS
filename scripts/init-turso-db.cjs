/**
 * Selwick POS — Turso Cloud Database Initializer (Phase 8.2)
 *
 * Connects to the real Turso cloud database and creates the necessary tables & indexes
 * for commercial licensing.
 *
 * Automatically loads .env.local if present.
 * Never prints tokens or sensitive secrets to stdout/stderr.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvLocal();

async function main() {
  const url = process.argv[2] || process.env.TURSO_DATABASE_URL;
  const authToken = process.argv[3] || process.env.TURSO_AUTH_TOKEN;

  if (!url || !url.trim()) {
    console.error('❌ Error: Missing TURSO_DATABASE_URL.');
    console.error('Please configure TURSO_DATABASE_URL in .env.local or pass it as an argument.');
    process.exit(1);
  }

  if (!authToken || !authToken.trim()) {
    console.error('❌ Error: Missing TURSO_AUTH_TOKEN.');
    console.error('Please configure TURSO_AUTH_TOKEN in .env.local or pass it as an argument.');
    process.exit(1);
  }

  const cleanUrl = url.trim();
  // Safe display: never display token
  const safeHost = cleanUrl.replace(/libsql:\/\/([^.]+).*/, '$1.turso.io');
  console.log(`Connecting to Turso Cloud Database: [${safeHost}] ...`);

  const client = createClient({ url: cleanUrl, authToken: authToken.trim() });

  console.log('Applying idempotent schema migration...');
  const statements = [
    `CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('trial', 'monthly', 'yearly', 'lifetime')),
      max_devices INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'suspended', 'revoked')) DEFAULT 'active',
      features TEXT NOT NULL DEFAULT '[]',
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      payment_reference TEXT,
      payment_provider TEXT,
      payment_status TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS activations (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'deactivated')) DEFAULT 'active',
      ip_address TEXT,
      UNIQUE(license_id, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS license_audit_logs (
      id TEXT PRIMARY KEY,
      license_id TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'admin',
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key)`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status)`,
    `CREATE INDEX IF NOT EXISTS idx_activations_license_device ON activations(license_id, device_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id)`,
    `CREATE INDEX IF NOT EXISTS idx_license_audit_license_id ON license_audit_logs(license_id)`
  ];

  await client.batch(statements, 'write');

  const res = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const tables = res.rows.map(r => r.name);
  console.log('✅ Tables verified on Turso Cloud Database:', tables.filter(t => !t.startsWith('sqlite_') && !t.startsWith('_')).join(', '));
  
  const idxRes = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name");
  const indexes = idxRes.rows.map(r => r.name);
  console.log('✅ Indexes verified on Turso Cloud Database:', indexes.join(', '));

  client.close();
  console.log('✅ Real Turso Cloud Database initialization completed successfully.');
}

main().catch(err => {
  console.error('❌ Failed to initialize Turso database:', err.message || err);
  process.exit(1);
});
