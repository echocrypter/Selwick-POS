/**
 * Selwick POS – Administrative First Owner Bootstrap CLI
 *
 * Usage:
 *   node --experimental-sqlite scripts/create-first-owner.cjs \
 *     --businessId "<id>" \
 *     --businessName "<name>" \
 *     --name "<owner-name>" \
 *     --pin "<4-8-digit-pin>" \
 *     [--env <production|desktop-dev|local-dev|test>]
 *
 * This administrative script bootstraps the first Owner account directly in SQLite.
 * It bypasses HTTP endpoints, ensuring that /api/auth/register remains strictly
 * protected by server-side authentication with zero public bootstrap surface.
 */

'use strict';

const { createHash, randomBytes, pbkdf2 } = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

const pbAsync = promisify(pbkdf2);
const root = path.resolve(__dirname, '..');

async function hashPin(pin, saltHex) {
  const saltBuffer = Buffer.from(saltHex, 'hex');
  const derived = await pbAsync(Buffer.from(pin, 'utf8'), saltBuffer, 150_000, 32, 'sha256');
  return derived.toString('hex');
}

function generateSalt() {
  return randomBytes(16).toString('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function resolveDbPath(env) {
  if (env === 'test') {
    const testDir = path.join(root, '.data', 'test');
    fs.mkdirSync(testDir, { recursive: true });
    return path.join(testDir, 'selwick-test.db');
  }
  if (env === 'production') {
    const userData = process.env.SELWICK_USER_DATA_PATH || 
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS') : '');
    if (!userData) {
      throw new Error('Production user data path not available.');
    }
    const dbDir = path.join(userData, 'database');
    fs.mkdirSync(dbDir, { recursive: true });
    return path.join(dbDir, 'selwick.db');
  }
  if (env === 'desktop-dev') {
    const devUserData = process.env.SELWICK_USER_DATA_PATH ||
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS Dev') : '');
    if (devUserData) {
      const dbDir = path.join(devUserData, 'database');
      fs.mkdirSync(dbDir, { recursive: true });
      return path.join(dbDir, 'selwick-dev.db');
    }
  }
  // Default to local-dev
  const localDir = path.join(root, '.data');
  fs.mkdirSync(localDir, { recursive: true });
  return path.join(localDir, 'selwick-local-dev.db');
}

async function main() {
  console.log('\n=== Selwick POS – Administrative Owner Bootstrap ===\n');

  const args = parseArgs();
  const env = args.env || process.env.SELWICK_ENV || 'local-dev';

  const businessId = args.businessId || (await prompt('Enter Business ID (e.g. default-biz): '));
  const businessName = args.businessName || (await prompt('Enter Business Name: '));
  const ownerName = args.name || (await prompt('Enter Owner Name (e.g. Administrator): '));
  const pin = args.pin || (await prompt('Enter Owner PIN (4-8 digits): '));

  if (!businessId || !businessName || !ownerName || !pin) {
    console.error('❌ Error: All fields (businessId, businessName, name, pin) are required.');
    process.exit(1);
  }

  if (!/^\d{4,8}$/.test(pin)) {
    console.error('❌ Error: PIN must be 4 to 8 digits.');
    process.exit(1);
  }

  const dbPath = resolveDbPath(env);
  console.log(`Target environment: ${env}`);
  console.log(`Database file:      ${dbPath}\n`);

  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  // Ensure migrations ledger and core tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL DEFAULT 'retail',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'cashier')),
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      identity_key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER NOT NULL,
      last_failed_at INTEGER NOT NULL,
      locked_until INTEGER
    );
  `);

  // Check if owner already exists
  const existingOwner = db.prepare(
    "SELECT id, name FROM users WHERE business_id = ? AND role = 'owner'"
  ).get(businessId);

  if (existingOwner) {
    console.log(`⚠️ An Owner account ("${existingOwner.name}") already exists for business "${businessId}".`);
    const proceed = await prompt('Do you want to add another Owner account? (y/N): ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('Aborted.');
      db.close();
      process.exit(0);
    }
  }

  // Upsert business
  db.prepare(`
    INSERT INTO businesses (id, name, business_type)
    VALUES (?, ?, 'retail')
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP
  `).run(businessId, businessName);

  // Generate credentials
  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  const userId = `usr-${randomBytes(8).toString('hex')}`;

  db.prepare(`
    INSERT INTO users (id, business_id, name, role, salt, hash)
    VALUES (?, ?, ?, 'owner', ?, ?)
  `).run(userId, businessId, ownerName, salt, hash);

  console.log('✅ Owner account created successfully:');
  console.log(`   User ID:     ${userId}`);
  console.log(`   Owner Name:  ${ownerName}`);
  console.log(`   Business ID: ${businessId}`);
  console.log(`   Role:        owner\n`);

  db.close();
}

main().catch((err) => {
  console.error('\n❌ Bootstrap error:', err);
  process.exit(1);
});
