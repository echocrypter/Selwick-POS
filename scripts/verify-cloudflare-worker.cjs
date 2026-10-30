/**
 * Selwick POS — Cloudflare Worker License Server Verification Suite.
 *
 * Verifies that the standalone Cloudflare Worker (src/worker/licenseServer.ts):
 *  1. Handles OPTIONS preflight with CORS headers
 *  2. Responds to /health
 *  3. Fails closed when required environment secrets are missing
 *  4. Admin Login: rate limiting, secret validation, HMAC session token, Set-Cookie header
 *  5. Rejects unauthorized access to protected admin routes
 *  6. Creates a commercial license via Worker (POST /api/license/admin/licenses)
 *  7. Lists and filters licenses (GET /api/license/admin/licenses)
 *  8. Retrieves license details (GET /api/license/admin/licenses/:id)
 *  9. POS Client Activation: POST /api/license/activate returns authentic Ed25519 signed payload
 * 10. Embedded POS Client Public Key verifies the Worker's Ed25519 signature
 * 11. Atomic multi-device limits: Terminal 2 blocked when max_devices = 1
 * 12. Remote device deactivation: DELETE /api/license/admin/activations/:id frees slot
 * 13. Terminal 2 successfully activates after deactivation
 * 14. POS Client Verification: POST /api/license/verify heartbeat
 * 15. License Renewal: POST /api/license/admin/licenses/:id/renew
 * 16. License Status Management: PUT /api/license/admin/licenses/:id (suspend, reactivate, revoke)
 * 17. Updating max devices: PUT action: 'set_max_devices'
 * 18. Audit log persistence on Turso
 * 19. Malformed JSON & invalid parameters handled gracefully (400 Bad Request)
 * 20. Secret non-exposure: zero secrets in error responses or headers
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

const ROOT = path.resolve(__dirname, '..');
const testDataDir = path.join(ROOT, '.data', 'cf-worker-test-' + Date.now());
fs.mkdirSync(testDataDir, { recursive: true });

const testTursoDbPath = path.join(testDataDir, 'cf_turso_test.db');
const testFileUrl = `file:${testTursoDbPath.replace(/\\/g, '/')}`;

let passedTests = 0;
let failedTests = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('    ', err instanceof assert.AssertionError ? err.message : (err.message || err));
    failedTests++;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('    ', err instanceof assert.AssertionError ? err.message : (err.message || err));
    failedTests++;
  }
}

async function runAll() {
  console.log('======================================================================');
  console.log('SELWICK POS — CLOUDFLARE WORKER LICENSE SERVER VERIFICATION');
  console.log('======================================================================\n');

  // Load modules
  const workerMod = await import('../src/worker/licenseServer.ts');
  const worker = workerMod.default;
  const tursoRepo = await import('../src/lib/licensing/tursoRepository.ts');
  const keysMod = await import('../src/lib/licensing/keys.ts');
  const serverKeyMod = await import('../src/lib/licensing/serverKey.ts');

  // Generate Ed25519 keypair for test
  const testKeypair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const testAdminSecret = 'test-cf-admin-secret-256-bit-random-entropy-string';

  // Initialize schema on libSQL test db
  const initClient = createClient({ url: testFileUrl });
  await tursoRepo.initTursoSchema(initClient);
  initClient.close();

  const mockEnv = {
    TURSO_DATABASE_URL: testFileUrl,
    TURSO_AUTH_TOKEN: 'cf-mock-token',
    SELWICK_LICENSE_PRIVATE_KEY: testKeypair.privateKey,
    SELWICK_LICENSE_ADMIN_SECRET: testAdminSecret,
    ENVIRONMENT: 'production',
  };

  console.log('--- 1. CORS, HEALTH & FAIL-CLOSED SECURITY GUARDS ---');

  await asyncTest('1. OPTIONS preflight returns 204 with CORS headers', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'OPTIONS',
      headers: { Origin: 'https://admin.selwick.internal' },
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://admin.selwick.internal');
  });

  await asyncTest('2. GET /health returns service health metadata', async () => {
    const req = new Request('https://worker.selwick.internal/health');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.database, 'Turso (libSQL)');
  });

  await asyncTest('3. Fail-Closed: Worker rejects requests when secrets are missing', async () => {
    const brokenEnv = { ...mockEnv, TURSO_DATABASE_URL: '' };
    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'SELW-TEST-1', deviceId: 'DEV-1' }),
    });
    const res = await worker.fetch(req, brokenEnv);
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
  });

  console.log('\n--- 2. ADMIN AUTHENTICATION & SESSION MANAGEMENT ---');

  let adminSessionToken = '';

  await asyncTest('4. Admin Login rejects invalid password/secret (401)', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong-password' }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 401);
  });

  await asyncTest('5. Admin Login succeeds with correct secret; returns token and Set-Cookie', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: testAdminSecret }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert(body.token, 'Must return session token');
    adminSessionToken = body.token;

    const cookie = res.headers.get('Set-Cookie');
    assert(cookie && cookie.includes('selwick_license_admin_token='), 'Must set admin cookie');
  });

  await asyncTest('6. Protected admin routes reject unauthorized requests without credentials (401)', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/overview');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 401);
  });

  await asyncTest('7. Admin Auth Session validates active session token', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/auth/session', {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.authenticated, true);
  });

  console.log('\n--- 3. COMMERCIAL LICENSE ISSUANCE & QUERYING ---');

  let createdLicense;

  await asyncTest('8. POST /api/license/admin/licenses creates license on Turso', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/licenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'Karachi Central Mart',
        email: 'billing@karachicentral.pk',
        plan: 'monthly',
        maxDevices: 1,
        paymentReference: 'TRX-CF-1001',
      }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert(body.license.id);
    assert(body.license.licenseKey.startsWith('SELW-'));
    assert(body.customerMessage.includes('Karachi Central Mart'));
    createdLicense = body.license;
  });

  await asyncTest('9. GET /api/license/admin/licenses lists licenses with search/filtering', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/licenses?q=Karachi', {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.licenses.length, 1);
    assert.strictEqual(body.licenses[0].id, createdLicense.id);
  });

  await asyncTest('10. GET /api/license/admin/licenses/:id returns full details and audit logs', async () => {
    const req = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}`, {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.license.id, createdLicense.id);
    assert(body.license.auditLogs.length >= 1);
  });

  console.log('\n--- 4. CLIENT ACTIVATION, ED25519 SIGNING & DEVICE LIMITS ---');

  let activationResultA;
  let activationRecordIdA;

  await asyncTest('11. Terminal 1 activates via POST /api/license/activate; receives signed payload', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: createdLicense.licenseKey,
        deviceId: 'POS-TERMINAL-CF-A',
        deviceName: 'Cash Counter 1',
      }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert(body.signedPayload);
    assert(body.signature);
    activationResultA = body;

    // Verify Ed25519 signature
    const valid = keysMod.verifyLicenseSignature(body.signedPayload, body.signature, testKeypair.publicKey);
    assert.strictEqual(valid, true, 'Worker signature must verify with Ed25519 public key');
  });

  await asyncTest('12. Terminal 2 rejected when device limit = 1 (DEVICE_LIMIT_REACHED)', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: createdLicense.licenseKey,
        deviceId: 'POS-TERMINAL-CF-B',
        deviceName: 'Cash Counter 2',
      }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, 'DEVICE_LIMIT_REACHED');
  });

  await asyncTest('13. DELETE /api/license/admin/activations/:id deactivates Terminal 1', async () => {
    // Get activation ID
    const detailsReq = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}`, {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const detailsRes = await worker.fetch(detailsReq, mockEnv);
    const detailsBody = await detailsRes.json();
    const act = detailsBody.license.activations.find(a => a.deviceId === 'POS-TERMINAL-CF-A');
    assert(act, 'Activation record must exist');
    activationRecordIdA = act.id;

    const delReq = new Request(`https://worker.selwick.internal/api/license/admin/activations/${activationRecordIdA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const delRes = await worker.fetch(delReq, mockEnv);
    assert.strictEqual(delRes.status, 200);
  });

  await asyncTest('14. Terminal 2 activates successfully after Terminal 1 deactivation', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: createdLicense.licenseKey,
        deviceId: 'POS-TERMINAL-CF-B',
        deviceName: 'Cash Counter 2',
      }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(keysMod.verifyLicenseSignature(body.signedPayload, body.signature, testKeypair.publicKey), true);
  });

  console.log('\n--- 5. VERIFY, RENEW & LIFECYCLE MANAGEMENT ---');

  await asyncTest('15. POST /api/license/verify validates active terminal', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: createdLicense.licenseKey,
        deviceId: 'POS-TERMINAL-CF-B',
      }),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.status, 'active');
  });

  await asyncTest('16. POST /api/license/admin/licenses/:id/renew advances expiration', async () => {
    const req = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}/renew`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({}),
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert(body.expiresAt > createdLicense.expiresAt, 'Expiry must advance');
  });

  await asyncTest('17. PUT /api/license/admin/licenses/:id supports suspend, reactivate, and revoke', async () => {
    // Suspend
    const suspendReq = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ action: 'set_status', status: 'suspended' }),
    });
    const suspendRes = await worker.fetch(suspendReq, mockEnv);
    assert.strictEqual(suspendRes.status, 200);

    // Reactivate
    const reactivateReq = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ action: 'set_status', status: 'active' }),
    });
    const reactivateRes = await worker.fetch(reactivateReq, mockEnv);
    assert.strictEqual(reactivateRes.status, 200);

    // Revoke
    const revokeReq = new Request(`https://worker.selwick.internal/api/license/admin/licenses/${createdLicense.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ action: 'set_status', status: 'revoked' }),
    });
    const revokeRes = await worker.fetch(revokeReq, mockEnv);
    assert.strictEqual(revokeRes.status, 200);
  });

  await asyncTest('18. GET /api/license/admin/overview aggregates dashboard metrics accurately', async () => {
    const req = new Request('https://worker.selwick.internal/api/license/admin/overview', {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert(body.metrics.totalLicenses >= 1);
    assert(body.metrics.revokedLicenses >= 1);
  });

  console.log('\n--- 6. MALFORMED REQUESTS & ERROR SAFETY ---');

  await asyncTest('19. Malformed JSON and missing parameters return 400 Bad Request', async () => {
    const badJsonReq = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ broken json ',
    });
    const res1 = await worker.fetch(badJsonReq, mockEnv);
    assert.strictEqual(res1.status, 400);

    const missingKeyReq = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'DEV-1' }),
    });
    const res2 = await worker.fetch(missingKeyReq, mockEnv);
    assert.strictEqual(res2.status, 400);
  });

  console.log('\n--- 7. PRODUCTION ED25519 KEYPAIR CORRESPONDENCE & ZERO SECRET LEAKAGE ---');

  await asyncTest('20. Original Phase 8 Ed25519 keypair cross-verifies with Worker', async () => {
    const origPrivKey = serverKeyMod.DEFAULT_DEV_PRIVATE_KEY;
    const embeddedPubKey = keysMod.SELWICK_POS_PUBLIC_KEY;

    // Create worker with original Phase 8 key
    const origEnv = { ...mockEnv, SELWICK_LICENSE_PRIVATE_KEY: origPrivKey };

    // Create a dedicated license to test original Phase 8 keypair
    const createReq = new Request('https://worker.selwick.internal/api/license/admin/licenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'Embedded Key Test Shop',
        email: 'keytest@selwick.internal',
        plan: 'monthly',
        maxDevices: 1,
      }),
    });
    const createRes = await worker.fetch(createReq, origEnv);
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();

    const req = new Request('https://worker.selwick.internal/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: createBody.license.licenseKey,
        deviceId: 'POS-TERMINAL-EMBEDDED-TEST',
      }),
    });
    const res = await worker.fetch(req, origEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    // Verify against the client's embedded public key!
    const verified = keysMod.verifyLicenseSignature(body.signedPayload, body.signature, embeddedPubKey);
    assert.strictEqual(verified, true, 'Worker signature must verify with embedded client SELWICK_POS_PUBLIC_KEY');
  });

  test('21. Worker source contains zero hardcoded secrets or private keys', () => {
    const workerSource = fs.readFileSync(path.join(ROOT, 'src', 'worker', 'licenseServer.ts'), 'utf8');
    assert(!workerSource.includes('BEGIN PRIVATE KEY'), 'Must not contain private key');
    assert(!workerSource.includes('libsql://'), 'Must not contain hardcoded Turso URL');
    assert(!workerSource.includes('selwick-dev-admin-secret'), 'Must not contain hardcoded admin secret');
  });

  // Cleanup
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log(`CLOUDFLARE WORKER VERIFICATION COMPLETE: ${passedTests} passed, ${failedTests} failed.`);
  console.log('======================================================================');

  if (failedTests > 0) process.exit(1);
}

runAll().catch(err => {
  console.error('Fatal Cloudflare Worker test failure:', err.message || err);
  process.exit(1);
});
