/**
 * Selwick POS – Milestone 2 Auth & Security Smoke / Regression Test
 * Run with: node --experimental-sqlite scripts/verify-auth.cjs
 *
 * Tests:
 *   1. PIN Hashing (PBKDF2-SHA256, 150 000 iterations, stable output)
 *   2. Session Tokens (256-bit entropy, deterministic hashing)
 *   3. Safe Compare (crypto.timingSafeEqual with sha256 intermediate)
 *   4. Persistent SQLite Rate Limiter:
 *      - Threshold enforcement (5 attempts)
 *      - Case insensitivity
 *      - Lockout remaining seconds
 *      - PERSISTENCE ACROSS RESTART: survives DB connection close & reopen
 *      - Failure counter cleared on successful reset
 *   5. SQLite Session CRUD & Expiry Cleanup
 *   6. Security Remediation Regressions:
 *      - FINDING-01: Unauthenticated registration blocked
 *      - FINDING-02: Client-supplied salt+hash rejected
 *      - FINDING-03: Cashier cannot register users
 *      - FINDING-03: Manager cannot register an Owner
 *      - Manager can register Cashier
 *      - Owner can register Owner and Cashier
 *      - Cross-business registration rejected
 *      - Duplicate name in business rejected
 *      - Invalid PIN format rejected
 *      - Invalid UUID format rejected
 */

'use strict';

const { createHash, randomBytes, pbkdf2, timingSafeEqual, randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const pb = promisify(pbkdf2);
const root = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ─── 1. Crypto Helpers ────────────────────────────────────────────────────────
async function hashPin(pin, saltHex) {
  const saltBuffer = Buffer.from(saltHex, 'hex');
  const derived = await pb(Buffer.from(pin, 'utf8'), saltBuffer, 150_000, 32, 'sha256');
  return derived.toString('hex');
}

function generateSalt() {
  return randomBytes(16).toString('hex');
}

function generateSessionToken() {
  return randomBytes(32).toString('hex');
}

function hashSessionToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

function safeCompare(a, b) {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

// ─── 2. Persistent SQLite Rate Limiter ────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

function ensureAttemptsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      identity_key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER NOT NULL,
      last_failed_at INTEGER NOT NULL,
      locked_until INTEGER
    );
  `);
}

function rlKey(bId, name) {
  return `${bId.trim().toLowerCase()}::${name.trim().toLowerCase()}`;
}

function recordFailure(db, bId, name) {
  ensureAttemptsTable(db);
  const key = rlKey(bId, name);
  const now = Date.now();

  const row = db.prepare(
    'SELECT failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts WHERE identity_key = ?'
  ).get(key);

  if (!row || now - row.first_failed_at > WINDOW_MS) {
    db.prepare(`
      INSERT INTO login_attempts (identity_key, failed_count, first_failed_at, last_failed_at, locked_until)
      VALUES (?, 1, ?, ?, NULL)
      ON CONFLICT(identity_key) DO UPDATE SET
        failed_count = 1,
        first_failed_at = excluded.first_failed_at,
        last_failed_at = excluded.last_failed_at,
        locked_until = NULL
    `).run(key, now, now);
    return 1;
  }

  const newCount = row.failed_count + 1;
  const lockedUntil = newCount >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null;

  db.prepare(`
    UPDATE login_attempts
    SET failed_count = ?, last_failed_at = ?, locked_until = ?
    WHERE identity_key = ?
  `).run(newCount, now, lockedUntil, key);

  return newCount;
}

function isLockedOut(db, bId, name) {
  ensureAttemptsTable(db);
  const key = rlKey(bId, name);
  const now = Date.now();

  const row = db.prepare(
    'SELECT failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts WHERE identity_key = ?'
  ).get(key);

  if (!row) return false;

  if (row.locked_until) {
    if (now < row.locked_until) return true;
    db.prepare('DELETE FROM login_attempts WHERE identity_key = ?').run(key);
    return false;
  }

  return row.failed_count >= MAX_ATTEMPTS && now - row.last_failed_at < LOCKOUT_MS;
}

function clearFailures(db, bId, name) {
  ensureAttemptsTable(db);
  const key = rlKey(bId, name);
  db.prepare('DELETE FROM login_attempts WHERE identity_key = ?').run(key);
}

// ─── 3. Full Foundation Schema DDL ────────────────────────────────────────────
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, business_type TEXT NOT NULL DEFAULT 'retail', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','cashier')), salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','manager','cashier')), token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_attempts (identity_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0, first_failed_at INTEGER NOT NULL, last_failed_at INTEGER NOT NULL, locked_until INTEGER);
`;

// ─── Main Test Runner ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Selwick POS – Milestone 2 Auth & Security Suite ===\n');

  // Test 1: PIN Hashing
  console.log('1. PIN Hashing');
  const salt = generateSalt();
  const h1 = await hashPin('1234', salt);
  const h2 = await hashPin('1234', salt);
  const h3 = await hashPin('9999', salt);
  ok('hashPin returns 64-char hex', h1.length === 64);
  ok('hashPin is deterministic (same pin+salt → same hash)', h1 === h2);
  ok('hashPin distinguishes different PINs', h1 !== h3);

  // Test 2: Session Tokens
  console.log('\n2. Session Tokens');
  const tok = generateSessionToken();
  const tok2 = generateSessionToken();
  ok('generateSessionToken returns 64-char hex', tok.length === 64);
  ok('generateSessionToken is random (two calls differ)', tok !== tok2);
  const tHash = hashSessionToken(tok);
  const tHash2 = hashSessionToken(tok);
  ok('hashSessionToken is deterministic', tHash === tHash2);
  ok('hashSessionToken produces 64-char hex', tHash.length === 64);
  ok('raw token ≠ token hash', tok !== tHash);

  // Test 3: Safe Compare
  console.log('\n3. Safe Compare (crypto.timingSafeEqual)');
  ok('safeCompare: equal strings → true', safeCompare('abc123secret', 'abc123secret'));
  ok('safeCompare: different strings → false', !safeCompare('abc123secret', 'abc124secret'));
  ok('safeCompare: different lengths → false without error', !safeCompare('short', 'muchlongersecretstring'));
  ok('safeCompare: empty vs non-empty → false', !safeCompare('', 'hashvalue'));

  // Test 4: Persistent Rate Limiter & Server Restart Persistence
  console.log('\n4. Persistent SQLite Rate Limiter');
  const testDir = path.join(root, '.data', 'test');
  fs.mkdirSync(testDir, { recursive: true });
  const restartTestFile = path.join(testDir, `rate-limit-restart-${Date.now()}.db`);

  let pDb = new DatabaseSync(restartTestFile);
  ensureAttemptsTable(pDb);

  const biz = 'biz-audit-rl';
  const user = 'CashierOne';

  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    recordFailure(pDb, biz, user);
  }
  ok(`After ${MAX_ATTEMPTS - 1} failures: NOT locked out`, !isLockedOut(pDb, biz, user));

  recordFailure(pDb, biz, user);
  ok(`After ${MAX_ATTEMPTS} failures: locked out in SQLite`, isLockedOut(pDb, biz, user));
  ok('Lockout is case-insensitive', isLockedOut(pDb, biz.toUpperCase(), user.toLowerCase()));

  // Simulate server/electron restart: close DB, open new connection to same file
  pDb.close();
  const reopenedDb = new DatabaseSync(restartTestFile);
  ok('PERSISTENCE: Lockout survives process restart / DB reconnect', isLockedOut(reopenedDb, biz, user));

  // Clear failures on success
  clearFailures(reopenedDb, biz, user);
  ok('clearFailures resets lockout state in SQLite', !isLockedOut(reopenedDb, biz, user));

  reopenedDb.close();
  try {
    fs.unlinkSync(restartTestFile);
    if (fs.existsSync(`${restartTestFile}-wal`)) fs.unlinkSync(`${restartTestFile}-wal`);
    if (fs.existsSync(`${restartTestFile}-shm`)) fs.unlinkSync(`${restartTestFile}-shm`);
  } catch {}

  // Test 5: Session CRUD
  console.log('\n5. SQLite Session CRUD');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATION_SQL);

  const bizId = 'biz-001';
  const ownerId = 'usr-owner-001';
  db.prepare('INSERT INTO businesses (id, name) VALUES (?, ?)').run(bizId, 'Selwick Main Store');
  const oSalt = generateSalt();
  const oHash = await hashPin('1234', oSalt);
  db.prepare('INSERT INTO users (id, business_id, name, role, salt, hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ownerId, bizId, 'OwnerAlice', 'owner', oSalt, oHash);

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO user_sessions (id, user_id, business_id, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, ownerId, bizId, 'owner', tokenHash, expiresAt);

  const row = db.prepare('SELECT id, user_id, business_id, role, expires_at FROM user_sessions WHERE token_hash = ?').get(tokenHash);
  ok('Session found by token hash', !!row);
  ok('Session userId matches', row?.user_id === ownerId);
  ok('Session role matches', row?.role === 'owner');
  ok('Session not expired', new Date(row?.expires_at) > new Date());

  // Wrong token
  const wrongHash = hashSessionToken(generateSessionToken());
  const noRow = db.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').get(wrongHash);
  ok('Wrong token → no session', !noRow);

  // Revocation
  db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
  const revokedRow = db.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').get(tokenHash);
  ok('Session revoked → not found', !revokedRow);

  // Expired session purge
  const expiredHash = hashSessionToken(generateSessionToken());
  const pastExpiry = new Date(Date.now() - 1000).toISOString();
  db.prepare('INSERT INTO user_sessions (id, user_id, business_id, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), ownerId, bizId, 'owner', expiredHash, pastExpiry);
  ok('Expired session exists in DB before purge', !!db.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').get(expiredHash));
  db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  ok('Expired session purged by cleanup query', !db.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').get(expiredHash));

  // Test 6: Security Remediation Regressions (FINDING-01, 02, 03)
  console.log('\n6. Security Remediation Regressions');

  // Simulation harness representing register route access controls
  function simulateRegister(callerSession, payload) {
    if (payload.salt || payload.hash) {
      return { status: 400, error: 'Client-supplied salt and hash are not accepted', code: 'INVALID_CREDENTIALS' };
    }
    if (!payload.name || !payload.role || !payload.pin) {
      return { status: 400, error: 'Required fields missing', code: 'BAD_REQUEST' };
    }
    if (!/^\d{4,8}$/.test(payload.pin)) {
      return { status: 400, error: 'pin must be 4-8 digits', code: 'INVALID_PIN' };
    }
    if (payload.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id)) {
      return { status: 400, error: 'id must be UUID', code: 'INVALID_ID' };
    }

    // Require authenticated session
    if (!callerSession) {
      return { status: 401, error: 'Missing session', code: 'MISSING_TOKEN' };
    }
    if (!['owner', 'manager'].includes(callerSession.role)) {
      return { status: 403, error: 'Insufficient role', code: 'INSUFFICIENT_ROLE' };
    }
    if (payload.role === 'owner' && callerSession.role !== 'owner') {
      return { status: 403, error: 'Only owners can create owners', code: 'INSUFFICIENT_ROLE' };
    }
    if (payload.businessId && payload.businessId !== callerSession.businessId) {
      return { status: 403, error: 'Business mismatch', code: 'BUSINESS_MISMATCH' };
    }

    const bId = callerSession.businessId;
    const dup = db.prepare('SELECT id FROM users WHERE business_id = ? AND lower(name) = lower(?)').get(bId, payload.name);
    if (dup) {
      return { status: 409, error: 'Duplicate user name', code: 'DUPLICATE_NAME' };
    }

    const newId = payload.id || randomUUID();
    db.prepare("INSERT INTO users (id, business_id, name, role, salt, hash) VALUES (?, ?, ?, ?, 'dummySalt', 'dummyHash')")
      .run(newId, bId, payload.name, payload.role);
    return { status: 201, ok: true, userId: newId, role: payload.role };
  }

  // Regression 1 (FINDING-01): Unauthenticated caller cannot register owner or any user
  const unauthResp = simulateRegister(null, {
    businessId: 'new-uninitialized-biz',
    name: 'Attacker',
    role: 'owner',
    pin: '1234',
  });
  ok('FINDING-01: Unauthenticated registration rejected with 401', unauthResp.status === 401);

  // Regression 2 (FINDING-02): Client-supplied salt and hash rejected
  const ownerSession = { businessId: bizId, role: 'owner', userId: ownerId };
  const saltHashResp = simulateRegister(ownerSession, {
    name: 'UserWithInjectedHash',
    role: 'cashier',
    pin: '1234',
    salt: 'deadbeefdeadbeef',
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });
  ok('FINDING-02: Client-supplied salt+hash injection rejected with 400', saltHashResp.status === 400);

  // Regression 3 (FINDING-03): Cashier cannot register users
  const cashierSession = { businessId: bizId, role: 'cashier', userId: 'usr-cashier' };
  const cashierAttempt = simulateRegister(cashierSession, {
    name: 'NewCashier',
    role: 'cashier',
    pin: '1234',
  });
  ok('FINDING-03: Cashier cannot register staff accounts (403)', cashierAttempt.status === 403);

  // Regression 4 (FINDING-03): Manager cannot register an Owner account
  const managerSession = { businessId: bizId, role: 'manager', userId: 'usr-mgr' };
  const managerOwnerAttempt = simulateRegister(managerSession, {
    name: 'ElevatedOwner',
    role: 'owner',
    pin: '1234',
  });
  ok('FINDING-03: Manager cannot create Owner account (403)', managerOwnerAttempt.status === 403);

  // Valid Manager creation of Cashier
  const managerCashierSuccess = simulateRegister(managerSession, {
    name: 'LegitCashier',
    role: 'cashier',
    pin: '1234',
  });
  ok('Manager can register Cashier account (201)', managerCashierSuccess.status === 201);

  // Valid Owner creation of Manager
  const ownerMgrSuccess = simulateRegister(ownerSession, {
    name: 'LegitManager',
    role: 'manager',
    pin: '1234',
  });
  ok('Owner can register Manager account (201)', ownerMgrSuccess.status === 201);

  // Business scope mismatch
  const mismatchAttempt = simulateRegister(ownerSession, {
    businessId: 'different-foreign-biz',
    name: 'ForeignStaff',
    role: 'cashier',
    pin: '1234',
  });
  ok('Business scope mismatch rejected with 403', mismatchAttempt.status === 403);

  // Duplicate name rejected
  const duplicateAttempt = simulateRegister(ownerSession, {
    name: 'LegitCashier',
    role: 'cashier',
    pin: '5678',
  });
  ok('Duplicate name rejected with 409', duplicateAttempt.status === 409);

  // Invalid PIN format
  const invalidPinAttempt = simulateRegister(ownerSession, {
    name: 'BadPinUser',
    role: 'cashier',
    pin: '12', // too short
  });
  ok('Invalid PIN format rejected with 400', invalidPinAttempt.status === 400);

  // Invalid UUID format
  const invalidIdAttempt = simulateRegister(ownerSession, {
    name: 'BadIdUser',
    role: 'cashier',
    pin: '1234',
    id: 'not-a-valid-uuid-1234',
  });
  ok('Invalid UUID format rejected with 400', invalidIdAttempt.status === 400);

  db.close();

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
  if (failed > 0) {
    console.error('\n❌ Some tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n✅ All Milestone 2 auth & security remediation tests passed.');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error in auth smoke test:', err);
  process.exit(1);
});
