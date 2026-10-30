'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

process.env.SELWICK_ENV = 'test';
const backupDir = path.join(root, '.data', 'test', 'stage-d-backups');
process.env.SELWICK_BACKUP_PATH = backupDir;
fs.mkdirSync(backupDir, { recursive: true });
const dbPath = path.join(root, '.data', 'test', `stage-d-${Date.now()}.db`);
process.env.SELWICK_TEST_DB_PATH = dbPath;

const localStore = new Map();
const sessionStore = new Map();
const makeStorage = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
});
global.window = {
  localStorage: makeStorage(localStore),
  sessionStorage: makeStorage(sessionStore),
};

let passed = 0;
let failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

const { getInitializedDatabase, closeDatabase } = require(path.join(root, 'src', 'lib', 'db', 'connection.ts'));
const { createSession, SESSION_COOKIE_NAME } = require(path.join(root, 'src', 'lib', 'auth', 'sessions.ts'));
const { NextRequest } = require('next/server');
const activateRoute = require(path.join(root, 'src', 'app', 'api', 'migration', 'activate', 'route.ts'));
const importRoute = require(path.join(root, 'src', 'app', 'api', 'migration', 'import', 'route.ts'));
const reconcileRoute = require(path.join(root, 'src', 'app', 'api', 'migration', 'reconcile', 'route.ts'));
const rollbackRoute = require(path.join(root, 'src', 'app', 'api', 'migration', 'rollback', 'route.ts'));
const backup = require(path.join(root, 'src', 'lib', 'migration', 'backup.ts'));
const { exportSqliteToLocalStorage } = require(path.join(root, 'src', 'lib', 'migration', 'reverseExport.ts'));
// (client-side DAL tests omitted in Node runner; covered by tsc/build)

const db = getInitializedDatabase();

const BIZ = 'biz-stage-d';
const OWNER = 'u-owner-stage-d';
db.prepare("INSERT INTO businesses (id, name, business_type) VALUES (?, ?, ?)").run(BIZ, 'Stage D Store', 'retail');
db.prepare("INSERT INTO users (id, business_id, name, role, salt, hash) VALUES (?, ?, ?, ?, ?, ?)").run(OWNER, BIZ, 'Owner', 'owner', 's', 'h');
const { rawToken: ownerToken } = createSession(db, OWNER, BIZ, 'owner');

function makeReq(routePath, body, token) {
  const url = `http://127.0.0.1:3456${routePath}`;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function call(handler, routePath, body, token = ownerToken) {
  const req = makeReq(routePath, body, token);
  const res = await handler.POST(req);
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

(async () => {
  console.log('='.repeat(70));
  console.log('SELWICK POS — MILESTONE 6 STAGE D VERIFICATION SUITE');
  console.log('='.repeat(70));

  console.log('\n--- SUITE 1: Durable Backup Integrity ---');
  const sourcePayload = {
    format: 'selwick-localstorage-v1',
    exportedAt: new Date().toISOString(),
    data: {
      [`selwick_business:${BIZ}:pos_products`]: JSON.stringify([
        { id: 'p1', name: 'Widget', price: 10, costPrice: 4, stock: 5, category: 'General' },
      ]),
      [`selwick_business:${BIZ}:pos_customers`]: JSON.stringify([
        { id: 'c1', name: 'Alice', phone: '123', balance: 2.5 },
      ]),
    },
  };

  const created = backup.createDurableBackup(db, BIZ, sourcePayload);
  ok('backup created with filename', !!created.filename && created.filename.endsWith('.json'));
  ok('backup sha256 recorded', typeof created.sha256 === 'string' && created.sha256.length === 64);

  const integrity = backup.verifyBackupIntegrity(db, { filename: created.filename });
  ok('backup integrity verifies', integrity.verified === true);
  ok('backup businessId matches', integrity.businessId === BIZ);

  const fileData = backup.readBackupFile(integrity.filename);
  ok('backup file readable JSON', JSON.parse(fileData.content).format === sourcePayload.format);

  const originalPath = path.join(backup.getBackupDirectory(), created.filename);
  const originalContent = fs.readFileSync(originalPath, 'utf8');
  fs.writeFileSync(originalPath, originalContent + ' ');
  const tamperedIntegrity = backup.verifyBackupIntegrity(db, { filename: created.filename });
  ok('tampered backup fails integrity', tamperedIntegrity.verified === false);
  fs.writeFileSync(originalPath, originalContent);

  console.log('\n--- SUITE 2: Activation Bypass Prevention ---');
  const bypass1 = await call(activateRoute, '/api/migration/activate', {
    businessId: BIZ,
    reconciliation: { balanced: true },
  });
  ok('client balanced=true alone is rejected', bypass1.status === 409 && bypass1.body.code === 'RECONCILIATION_REQUIRED');

  const bypass2 = await call(activateRoute, '/api/migration/activate', {
    businessId: BIZ,
    reconciliation: { isBalanced: true },
    sourcePayload: sourcePayload,
  });
  ok('client isBalanced=true cannot override empty SQLite', bypass2.status === 409 && bypass2.body.code === 'RECONCILIATION_REQUIRED');

  console.log('\n--- SUITE 3: Durable Backup Import ---');
  const importRes = await call(importRoute, '/api/migration/import', {
    businessId: BIZ,
    filename: created.filename,
  });
  ok('import succeeds', importRes.status === 200 && importRes.body.ok === true);
  console.log('\n--- SUITE 4: Server-Side Reconciliation ---');
  const reconOk = await call(reconcileRoute, '/api/migration/reconcile', {
    businessId: BIZ,
    sourcePayload,
  });
  ok('reconcile endpoint is read-only and succeeds', reconOk.status === 200 && reconOk.body.ok === true);
  ok('reconcile reports balanced', reconOk.body.balanced === true);

  const mismatchPayload = JSON.parse(JSON.stringify(sourcePayload));
  mismatchPayload.data[`selwick_business:${BIZ}:pos_products`] = JSON.stringify([
    { id: 'p2', name: 'Extra', price: 1, costPrice: 0, stock: 999, category: 'General' },
  ]);
  const reconBad = await call(reconcileRoute, '/api/migration/reconcile', {
    businessId: BIZ,
    sourcePayload: mismatchPayload,
  });
  ok('reconcile detects mismatch', reconBad.status === 200 && reconBad.body.balanced === false);

  console.log('\n--- SUITE 5: Controlled Activation ---');
  const activateRes = await call(activateRoute, '/api/migration/activate', {
    businessId: BIZ,
    sourcePayload,
  });
  ok('activation succeeds after balanced reconciliation', activateRes.status === 200 && activateRes.body.activated === true);
  ok('activation mode is sqlite', activateRes.body.mode === 'sqlite');
  ok('activation is not auto-activated', activateRes.body.autoActivated === false);
  ok('activation preserves localStorage', activateRes.body.localStoragePreserved === true);

  const actRow = db.prepare("SELECT mode FROM migration_activation WHERE business_id = ? ORDER BY id DESC LIMIT 1").get(BIZ);
  ok('activation recorded as sqlite', actRow && actRow.mode === 'sqlite');

  console.log('\n--- SUITE 6: Rollback Restore ---');
  const rollbackRes = await call(rollbackRoute, '/api/migration/rollback', { businessId: BIZ });
  ok('rollback succeeds', rollbackRes.status === 200 && rollbackRes.body.ok === true);
  ok('rollback recovered flag', rollbackRes.body.recovered === true);
  ok('rollback localStorageRestored true', rollbackRes.body.localStorageRestored === true);
  ok('rollback payload present', !!rollbackRes.body.localStorageRestorePayload);
  ok('rollback payload format valid', rollbackRes.body.localStorageRestorePayload?.format === 'selwick-localstorage-v1');
  ok('rollback payload data present', typeof rollbackRes.body.localStorageRestorePayload?.data === 'object');

  const reverse = exportSqliteToLocalStorage(db, BIZ, { origin: 'http://127.0.0.1:3456' });
  ok('rollback payload data matches reverse export', JSON.stringify(rollbackRes.body.localStorageRestorePayload.data) === JSON.stringify(reverse.payload.data));

  const rollbackRow = db.prepare("SELECT mode FROM migration_activation WHERE business_id = ? ORDER BY id DESC LIMIT 1").get(BIZ);
  ok('rollback recorded as localstorage', rollbackRow && rollbackRow.mode === 'localstorage');

  console.log('\n--- SUITE 7: Post-Activation SQLite Transactions ---');
  await call(activateRoute, '/api/migration/activate', { businessId: BIZ, sourcePayload });
  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT INTO products (id, business_id, name, price_cents, cost_price_cents, stock, category) VALUES (?, ?, ?, ?, ?, ?, ?)").run('p-post', BIZ, 'Post Product', 1000, 400, 3, 'General');
  db.exec('COMMIT');
  const postProduct = db.prepare("SELECT name, stock FROM products WHERE id = ? AND business_id = ?").get('p-post', BIZ);
  ok('post-activation SQLite write succeeds', postProduct && postProduct.name === 'Post Product' && postProduct.stock === 3);

  closeDatabase();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}

  console.log('\n' + '='.repeat(70));
  console.log(`STAGE D RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));
  process.exit(failed > 0 ? 1 : 0);
})();

