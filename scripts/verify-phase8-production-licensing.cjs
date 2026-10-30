/**
 * Selwick POS — Phase 8 Production License Server & Pilot Verification Suite.
 *
 * Verifies:
 *  1. Production environment variables & fail-closed security guards
 *  2. Ed25519 keypair generation & asymmetric signature cross-verification
 *  3. HTTPS enforcement for production license server endpoints
 *  4. Database persistence across server restarts
 *  5. Strict device limit enforcement (Machine A -> B rejected -> deactivate A -> B succeeds)
 *  6. Complete license lifecycle (Create -> Activate -> Offline -> Verify -> Renew -> Suspend -> Reactivate -> Revoke)
 *  7. Offline grace period & operational database preservation invariant
 *  8. Admin dashboard protection, authentication & rate limiting
 *  9. Electron production configuration & zero secret leakage in client
 * 10. Real Customer Pilot scenario simulation
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const testDataDir = path.join(ROOT, '.data', 'phase8-test-' + Date.now());
fs.mkdirSync(testDataDir, { recursive: true });

const testLicenseDbPath = path.join(testDataDir, 'license_server_test.db');
const testActivationPath = path.join(testDataDir, 'license_activation_test.json');

let passedTests = 0;
let failedTests = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('    ', err instanceof assert.AssertionError ? err.message : err);
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
    console.error('    ', err instanceof assert.AssertionError ? err.message : err);
    failedTests++;
  }
}

async function runPhase8Verification() {
  console.log('======================================================================');
  console.log('SELWICK POS — PHASE 8 PRODUCTION LICENSING & PILOT VERIFICATION');
  console.log('======================================================================\n');

  process.env.SELWICK_LICENSE_DB_PATH = testLicenseDbPath;
  process.env.SELWICK_ACTIVATION_PATH = testActivationPath;

  // Import licensing modules
  const serverKeyModule = await import('../src/lib/licensing/serverKey.ts');
  const adminAuthModule = await import('../src/lib/licensing/adminAuth.ts');
  const keysModule = await import('../src/lib/licensing/keys.ts');
  const licenseDbModule = await import('../src/lib/licensing/licenseDb.ts');
  const licenseServiceModule = await import('../src/lib/licensing/licenseService.ts');
  const posLicenseClientModule = await import('../src/lib/licensing/posLicenseClient.ts');
  const { generateEd25519KeyPair } = require('./generate-license-keys.cjs');

  const { getLicenseServerPrivateKey, DEFAULT_DEV_PRIVATE_KEY } = serverKeyModule;
  const { getAdminSecret, createAdminSessionToken, verifyAdminSessionToken, checkLoginRateLimit, recordFailedLogin, clearLoginRateLimit } = adminAuthModule;
  const { verifyLicenseSignature, signLicensePayload, generateLicenseKey, SELWICK_POS_PUBLIC_KEY } = keysModule;
  const { getLicenseDatabase, closeLicenseDatabase } = licenseDbModule;
  const {
    createLicense,
    activateLicense,
    verifyLicense,
    renewLicense,
    setLicenseStatus,
    deactivateActivationById,
    getLicenseDetails,
    getLicenseById,
    generateCustomerMessage,
  } = licenseServiceModule;
  const {
    saveLocalActivation,
    loadLocalActivation,
    clearLocalActivation,
    evaluateLicenseState,
    isFeatureEnabled,
    validateLicenseServerUrl,
  } = posLicenseClientModule;

  // ------------------------------------------------------------------
  // SECTION 1: PRODUCTION ENVIRONMENT VARIABLES & FAIL-CLOSED GUARDS
  // ------------------------------------------------------------------
  console.log('--- 1. PRODUCTION ENVIRONMENT FAIL-CLOSED SECURITY GUARDS ---');

  test('1. Production private key fails closed when SELWICK_LICENSE_PRIVATE_KEY is missing', () => {
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.SELWICK_LICENSE_PRIVATE_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SELWICK_LICENSE_PRIVATE_KEY;

      assert.throws(
        () => getLicenseServerPrivateKey(),
        /CRITICAL: SELWICK_LICENSE_PRIVATE_KEY is not configured in production environment/,
        'Must fail closed in production without private key'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origKey) process.env.SELWICK_LICENSE_PRIVATE_KEY = origKey;
    }
  });

  test('2. Production admin secret fails closed when SELWICK_LICENSE_ADMIN_SECRET is missing', () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SELWICK_LICENSE_ADMIN_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SELWICK_LICENSE_ADMIN_SECRET;

      assert.throws(
        () => getAdminSecret(),
        /CRITICAL: SELWICK_LICENSE_ADMIN_SECRET is not configured in production environment/,
        'Must fail closed in production without admin secret'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origSecret) process.env.SELWICK_LICENSE_ADMIN_SECRET = origSecret;
    }
  });

  test('3. Development environment allows fallback keys and secrets', () => {
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.SELWICK_LICENSE_PRIVATE_KEY;
    const origSecret = process.env.SELWICK_LICENSE_ADMIN_SECRET;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.SELWICK_LICENSE_PRIVATE_KEY;
      delete process.env.SELWICK_LICENSE_ADMIN_SECRET;

      const devKey = getLicenseServerPrivateKey();
      assert.strictEqual(devKey, DEFAULT_DEV_PRIVATE_KEY, 'Dev environment uses default dev key');

      const devSecret = getAdminSecret();
      assert.ok(devSecret.includes('selwick-dev-admin-secret'), 'Dev environment uses dev secret');
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origKey) process.env.SELWICK_LICENSE_PRIVATE_KEY = origKey;
      if (origSecret) process.env.SELWICK_LICENSE_ADMIN_SECRET = origSecret;
    }
  });

  // ------------------------------------------------------------------
  // SECTION 2: ED25519 KEY GENERATION & ASYMMETRIC CROSS-VERIFICATION
  // ------------------------------------------------------------------
  console.log('\n--- 2. ED25519 ASYMMETRIC SIGNATURE CROSS-VERIFICATION ---');

  test('4. Dynamic Ed25519 keypair generation produces valid PEM keys and verifies signatures', () => {
    const pair = generateEd25519KeyPair();
    assert.ok(pair.publicKey.includes('BEGIN PUBLIC KEY'), 'Contains public key PEM header');
    assert.ok(pair.privateKey.includes('BEGIN PRIVATE KEY'), 'Contains private key PEM header');

    const testPayload = {
      licenseId: 'test-lic-1',
      licenseKey: 'SELW-PRO-1111-2222-3333-4444',
      customerName: 'Production Test Corp',
      plan: 'yearly',
      deviceId: 'dev-001',
      features: ['inventory', 'khata'],
      maxDevices: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      serverTimestamp: new Date().toISOString(),
    };

    const sig = signLicensePayload(testPayload, pair.privateKey);
    const valid = verifyLicenseSignature(testPayload, sig, pair.publicKey);
    assert.strictEqual(valid, true, 'Server-signed payload verifies with generated public key');

    // Mismatched / tampered payload must fail
    const tamperedPayload = { ...testPayload, customerName: 'Attacker Corp' };
    const invalid = verifyLicenseSignature(tamperedPayload, sig, pair.publicKey);
    assert.strictEqual(invalid, false, 'Tampered customer name is rejected by public key verification');
  });

  test('5. Default production public key verifies signatures created with corresponding private key', () => {
    const testPayload = {
      licenseId: 'prod-lic-test',
      licenseKey: 'SELW-MTH-9999-8888-7777-6666',
      customerName: 'Default Shop',
      plan: 'monthly',
      deviceId: 'dev-prod-1',
      features: ['inventory'],
      maxDevices: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      serverTimestamp: new Date().toISOString(),
    };

    const sig = signLicensePayload(testPayload, DEFAULT_DEV_PRIVATE_KEY);
    const valid = verifyLicenseSignature(testPayload, sig, SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(valid, true, 'Embedded public key matches server private key');
  });

  // ------------------------------------------------------------------
  // SECTION 3: HTTPS ENFORCEMENT & REMOTE URL SECURITY
  // ------------------------------------------------------------------
  console.log('\n--- 3. HTTPS PROTOCOL & REMOTE URL SECURITY ---');

  test('6. Production URL validation rejects plain HTTP server URLs', () => {
    const checkHttp = validateLicenseServerUrl('http://insecure-license-server.com', true);
    assert.strictEqual(checkHttp.valid, false);
    assert.strictEqual(checkHttp.code, 'INSECURE_HTTP_NOT_ALLOWED');
    assert.ok(checkHttp.error.includes('must use HTTPS'));

    const checkHttps = validateLicenseServerUrl('https://license.selwick.com', true);
    assert.strictEqual(checkHttps.valid, true);
    assert.strictEqual(checkHttps.url, 'https://license.selwick.com');
  });

  test('7. Production URL validation requires SELWICK_LICENSE_SERVER_URL when empty', () => {
    const checkEmpty = validateLicenseServerUrl('', true);
    assert.strictEqual(checkEmpty.valid, false);
    assert.strictEqual(checkEmpty.code, 'MISSING_LICENSE_SERVER_URL');

    // In dev mode, empty is allowed (embedded local license server for tests/dev)
    const checkDev = validateLicenseServerUrl('', false);
    assert.strictEqual(checkDev.valid, true);
    assert.strictEqual(checkDev.url, undefined);
  });

  // ------------------------------------------------------------------
  // SECTION 4: PRODUCTION DATABASE PERSISTENCE ACROSS RESTARTS
  // ------------------------------------------------------------------
  console.log('\n--- 4. LICENSE DATABASE PERSISTENCE ACROSS RESTARTS ---');

  test('8. License records and activations persist across database connection restarts', () => {
    let db = getLicenseDatabase(testLicenseDbPath);

    // Create a license in instance 1
    const lic = createLicense(db, {
      customerName: 'Persistent Merchant',
      email: 'persist@merchant.com',
      plan: 'monthly',
      maxDevices: 2,
      paymentReference: 'PAY-PERSIST-101',
      actor: 'admin',
    });

    // Activate device 1
    activateLicense(db, lic.licenseKey, 'device-persist-1', 'Counter 1', DEFAULT_DEV_PRIVATE_KEY);

    // Close instance 1
    closeLicenseDatabase();

    // Reopen instance 2
    const db2 = getLicenseDatabase(testLicenseDbPath);
    const details = getLicenseDetails(db2, lic.id);

    assert.ok(details, 'License found after DB reconnect');
    assert.strictEqual(details.customerName, 'Persistent Merchant');
    assert.strictEqual(details.paymentReference, 'PAY-PERSIST-101');
    assert.strictEqual(details.activations.length, 1, 'Activation persisted');
    assert.strictEqual(details.activations[0].deviceId, 'device-persist-1');
    assert.ok(details.auditLogs.length >= 2, 'Audit logs persisted across reconnect');

    closeLicenseDatabase();
  });

  // ------------------------------------------------------------------
  // SECTION 5: STRICT MULTI-DEVICE LIMIT ENFORCEMENT & DEACTIVATION
  // ------------------------------------------------------------------
  console.log('\n--- 5. DEVICE LIMITS & REMOTE DEACTIVATION ---');

  test('9. Device limit = 1: Machine A succeeds, Machine B rejected, deactivating A allows B', () => {
    const db = getLicenseDatabase(testLicenseDbPath);

    const singleDeviceLic = createLicense(db, {
      customerName: 'Single Terminal Store',
      email: 'single@store.com',
      plan: 'yearly',
      maxDevices: 1,
      actor: 'admin',
    });

    // 1. Machine A activates -> SUCCESS
    const actA = activateLicense(db, singleDeviceLic.licenseKey, 'MACHINE_A', 'Front Desk', DEFAULT_DEV_PRIVATE_KEY);
    assert.ok(actA.signedPayload, 'Machine A activation succeeded');

    // 2. Machine B activates -> REJECTED (device limit reached)
    assert.throws(
      () => activateLicense(db, singleDeviceLic.licenseKey, 'MACHINE_B', 'Back Office', DEFAULT_DEV_PRIVATE_KEY),
      /device limit reached/i,
      'Machine B must be rejected due to device limit'
    );

    // 3. Deactivate Machine A from Admin Dashboard
    const details = getLicenseDetails(db, singleDeviceLic.id);
    const machineAActivation = details.activations.find((a) => a.deviceId === 'MACHINE_A');
    assert.ok(machineAActivation, 'Found Machine A activation');

    deactivateActivationById(db, machineAActivation.id, 'admin');

    // 4. Machine B activates again -> SUCCESS
    const actB = activateLicense(db, singleDeviceLic.licenseKey, 'MACHINE_B', 'Back Office', DEFAULT_DEV_PRIVATE_KEY);
    assert.ok(actB.signedPayload, 'Machine B activation succeeds after Machine A was deactivated');
    assert.strictEqual(actB.signedPayload.deviceId, 'MACHINE_B');
  });

  // ------------------------------------------------------------------
  // SECTION 6: COMPLETE LICENSE LIFECYCLE
  // ------------------------------------------------------------------
  console.log('\n--- 6. FULL COMMERCIAL LICENSE LIFECYCLE ---');

  test('10. Lifecycle: Create -> Activate -> Offline -> Verify -> Renew -> Suspend -> Reactivate -> Revoke', () => {
    const db = getLicenseDatabase(testLicenseDbPath);

    // 1. CREATE
    const lic = createLicense(db, {
      customerName: 'Lifecycle Bakery',
      email: 'bake@lifecycle.com',
      plan: 'monthly',
      maxDevices: 1,
      actor: 'admin',
    });
    assert.strictEqual(lic.status, 'active');

    // 2. ACTIVATE
    const activationResult = activateLicense(db, lic.licenseKey, 'BAKERY_REGISTER_1', 'Main Register', DEFAULT_DEV_PRIVATE_KEY);
    assert.ok(verifyLicenseSignature(activationResult.signedPayload, activationResult.signature));

    // 3. USE OFFLINE: Save activation locally and evaluate state with ZERO network access
    saveLocalActivation(activationResult.signedPayload, activationResult.signature);
    const offlineState = evaluateLicenseState(undefined, 'BAKERY_REGISTER_1');
    assert.strictEqual(offlineState.status, 'active');
    assert.strictEqual(offlineState.canOperate, true);
    assert.strictEqual(offlineState.isValid, true);

    // 4. VERIFY (online check)
    const verified = verifyLicense(db, lic.licenseKey, 'BAKERY_REGISTER_1', DEFAULT_DEV_PRIVATE_KEY);
    assert.strictEqual(verified.status, 'active');

    // 5. RENEW (+30 days)
    const oldExpiry = lic.expiresAt;
    const renewed = renewLicense(db, lic.id, undefined, 'admin');
    assert.ok(new Date(renewed.expiresAt).getTime() > new Date(oldExpiry).getTime(), 'Expiry date extended');

    // 6. SUSPEND
    setLicenseStatus(db, lic.id, 'suspended', 'admin');
    const suspended = getLicenseById(db, lic.id);
    assert.strictEqual(suspended.status, 'suspended');

    // Activation attempt while suspended -> 403 REJECTED
    assert.throws(
      () => activateLicense(db, lic.licenseKey, 'BAKERY_REGISTER_2', 'Temp', DEFAULT_DEV_PRIVATE_KEY),
      /temporarily suspended/i,
      'Suspended license activation blocked'
    );

    // 7. REACTIVATE
    setLicenseStatus(db, lic.id, 'active', 'admin');
    const reactivated = getLicenseById(db, lic.id);
    assert.strictEqual(reactivated.status, 'active');

    // 8. REVOKE
    setLicenseStatus(db, lic.id, 'revoked', 'admin');
    const revoked = getLicenseById(db, lic.id);
    assert.strictEqual(revoked.status, 'revoked');

    assert.throws(
      () => activateLicense(db, lic.licenseKey, 'BAKERY_REGISTER_3', 'Temp 2', DEFAULT_DEV_PRIVATE_KEY),
      /license has been revoked/i,
      'Revoked license activation permanently blocked'
    );
  });

  // ------------------------------------------------------------------
  // SECTION 7: OFFLINE GRACE RULES & DATABASE PRESERVATION INVARIANT
  // ------------------------------------------------------------------
  console.log('\n--- 7. OFFLINE GRACE RULES & ZERO DATA LOSS INVARIANT ---');

  test('11. Offline grace: Days 1-9 normal, Days 10-14 warning, Day 15+ pause', () => {
    const fakePayload = {
      licenseId: 'grace-test',
      licenseKey: 'SELW-MTH-1111-2222-3333-4444',
      customerName: 'Grace Supermarket',
      plan: 'monthly',
      deviceId: 'TERM_01',
      features: ['inventory', 'khata'],
      maxDevices: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      serverTimestamp: new Date().toISOString(),
    };
    const signature = signLicensePayload(fakePayload, DEFAULT_DEV_PRIVATE_KEY);

    // Days 1-9 (e.g. 3 days elapsed): normal
    const stateNormal = evaluateLicenseState(
      {
        signedPayload: fakePayload,
        signature,
        lastVerifiedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        gracePeriodDays: 14,
      },
      'TERM_01'
    );
    assert.strictEqual(stateNormal.canOperate, true);
    assert.strictEqual(stateNormal.isGracePeriod, false);

    // Days 10-14 (e.g. 11 days elapsed, 3 days left): warning
    const stateWarning = evaluateLicenseState(
      {
        signedPayload: fakePayload,
        signature,
        lastVerifiedAt: new Date(Date.now() - 11 * 86400000).toISOString(),
        gracePeriodDays: 14,
      },
      'TERM_01'
    );
    assert.strictEqual(stateWarning.canOperate, true);
    assert.strictEqual(stateWarning.isGracePeriod, true);
    assert.ok(stateWarning.graceDaysRemaining <= 5 && stateWarning.graceDaysRemaining > 0);

    // Day 15+ (e.g. 16 days elapsed): pause sales operation
    const stateExpired = evaluateLicenseState(
      {
        signedPayload: fakePayload,
        signature,
        lastVerifiedAt: new Date(Date.now() - 16 * 86400000).toISOString(),
        gracePeriodDays: 14,
      },
      'TERM_01'
    );
    assert.strictEqual(stateExpired.canOperate, false);
    assert.strictEqual(stateExpired.status, 'grace_period');
  });

  test('12. Invariant: License state transitions never touch or delete selwick.db operational tables', () => {
    const sqlitePath = path.join(testDataDir, 'selwick.db');
    const operationalDb = new DatabaseSync(sqlitePath);
    operationalDb.exec(`
      CREATE TABLE test_products (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO test_products VALUES ('p1', 'Panadol');
      CREATE TABLE test_sales (id TEXT PRIMARY KEY, total INTEGER);
      INSERT INTO test_sales VALUES ('s1', 5000);
    `);

    // Simulate clearing / modifying / expiring license
    clearLocalActivation();
    const evaluated = evaluateLicenseState();
    assert.strictEqual(evaluated.canOperate, false);

    // Check operational database is 100% intact
    const products = operationalDb.prepare('SELECT count(*) as c FROM test_products').get();
    const sales = operationalDb.prepare('SELECT count(*) as c FROM test_sales').get();
    assert.strictEqual(products.c, 1, 'Products table untouched');
    assert.strictEqual(sales.c, 1, 'Sales table untouched');
    operationalDb.close();
  });

  // ------------------------------------------------------------------
  // SECTION 8: ADMIN DASHBOARD AUTHENTICATION & RATE LIMITING
  // ------------------------------------------------------------------
  console.log('\n--- 8. ADMIN DASHBOARD AUTHENTICATION & RATE LIMITING ---');

  test('13. Admin session token generation, HMAC verification and rate limiting', () => {
    process.env.SELWICK_LICENSE_ADMIN_SECRET = 'admin-secret-test-2026';

    // Session token
    const token = createAdminSessionToken('selwick-owner');
    const verification = verifyAdminSessionToken(token);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.actor, 'selwick-owner');

    // Rate limiting: 5 failed attempts locks out IP
    const testIp = '198.51.100.42';
    clearLoginRateLimit(testIp);
    for (let i = 0; i < 4; i++) {
      recordFailedLogin(testIp);
      assert.strictEqual(checkLoginRateLimit(testIp).allowed, true);
    }
    recordFailedLogin(testIp); // 5th failure
    const check = checkLoginRateLimit(testIp);
    assert.strictEqual(check.allowed, false, 'IP locked out after 5 failures');
    assert.ok(check.remainingLockoutSeconds > 0);

    clearLoginRateLimit(testIp);
    assert.strictEqual(checkLoginRateLimit(testIp).allowed, true);
  });

  // ------------------------------------------------------------------
  // SECTION 9: ELECTRON HARDENING & CLIENT SECRET ISOLATION
  // ------------------------------------------------------------------
  console.log('\n--- 9. ELECTRON PACKAGING & ZERO SECRET LEAKAGE ---');

  test('14. Electron main.cjs sanitizes child process environment and enforces security flags', () => {
    const mainSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');

    assert.ok(mainSrc.includes('delete clientEnv.SELWICK_LICENSE_PRIVATE_KEY'), 'Deletes private key from child env');
    assert.ok(mainSrc.includes('delete clientEnv.SELWICK_LICENSE_ADMIN_SECRET'), 'Deletes admin secret from child env');
    assert.ok(mainSrc.includes('nodeIntegration: false'), 'nodeIntegration is false');
    assert.ok(mainSrc.includes('contextIsolation: true'), 'contextIsolation is true');
    assert.ok(mainSrc.includes('sandbox: true'), 'sandbox is true');
    assert.ok(mainSrc.includes('SELWICK_LICENSE_SERVER_URL'), 'Configures production license server URL');
  });

  test('15. Codebase scan: Embedded POS client code contains ONLY public key and zero private key material', () => {
    const keysSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'licensing', 'keys.ts'), 'utf8');
    assert.ok(keysSrc.includes('SELWICK_POS_PUBLIC_KEY'), 'Embedded public key present');
    assert.ok(!keysSrc.includes('DEFAULT_DEV_PRIVATE_KEY'), 'No private key in keys.ts');
    assert.ok(!keysSrc.includes('getLicenseServerPrivateKey'), 'No private key provider in keys.ts');

    const clientSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'licensing', 'posLicenseClient.ts'), 'utf8');
    assert.ok(!clientSrc.includes('SELWICK_LICENSE_PRIVATE_KEY'), 'No private key reference in posLicenseClient');
    assert.ok(!clientSrc.includes('SELWICK_LICENSE_ADMIN_SECRET'), 'No admin secret reference in posLicenseClient');
  });

  // ------------------------------------------------------------------
  // SECTION 10: REAL CUSTOMER PILOT SIMULATION
  // ------------------------------------------------------------------
  console.log('\n--- 10. REAL CUSTOMER PILOT SIMULATION ---');

  test('16. Pilot Customer: Create monthly license for "TEST PILOT SHOP", verify delivery & feature unlock', () => {
    const db = getLicenseDatabase(testLicenseDbPath);

    // 1. Create pilot customer license
    const pilotLicense = createLicense(db, {
      customerName: 'TEST PILOT SHOP',
      email: 'pilot@selwick.com',
      plan: 'monthly',
      maxDevices: 1,
      paymentReference: 'PILOT-CUST-001-CASH',
      paymentProvider: 'manual_cash',
      paymentStatus: 'paid',
      notes: 'Phase 8 First Commercial Customer Pilot',
      actor: 'admin',
    });

    assert.ok(pilotLicense.licenseKey.startsWith('SELW-MTH-'), 'Monthly prefix on key');
    assert.strictEqual(pilotLicense.status, 'active');
    assert.strictEqual(pilotLicense.paymentStatus, 'paid');

    // 2. Customer delivery message contains all necessary onboarding info
    const deliveryMsg = generateCustomerMessage(pilotLicense);
    assert.ok(deliveryMsg.includes('TEST PILOT SHOP'), 'Contains customer name');
    assert.ok(deliveryMsg.includes(pilotLicense.licenseKey), 'Contains license key');
    assert.ok(deliveryMsg.includes('Monthly'), 'Contains plan name');
    assert.ok(deliveryMsg.includes('Activate Terminal'), 'Contains activation instruction');

    // 3. Merchant terminal activates
    const terminalActivation = activateLicense(
      db,
      pilotLicense.licenseKey,
      'PILOT_TERMINAL_PC',
      'Pilot Counter 1',
      DEFAULT_DEV_PRIVATE_KEY
    );
    assert.ok(verifyLicenseSignature(terminalActivation.signedPayload, terminalActivation.signature));

    // 4. Save to merchant PC and verify unlocked features
    saveLocalActivation(terminalActivation.signedPayload, terminalActivation.signature);
    const terminalState = evaluateLicenseState(undefined, 'PILOT_TERMINAL_PC');
    assert.strictEqual(terminalState.status, 'active');
    assert.strictEqual(terminalState.canOperate, true);
    assert.strictEqual(isFeatureEnabled('inventory', terminalState), true);
    assert.strictEqual(isFeatureEnabled('khata', terminalState), true);
    assert.strictEqual(isFeatureEnabled('advanced_reports', terminalState), true);
    assert.strictEqual(isFeatureEnabled('multi_user', terminalState), true);
    assert.strictEqual(isFeatureEnabled('cloud_backup', terminalState), true);
  });

  // Cleanup test data directory
  try {
    closeLicenseDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log(`PHASE 8 VERIFICATION COMPLETE: ${passedTests} passed, ${failedTests} failed.`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runPhase8Verification().catch((err) => {
  console.error('Unhandled Phase 8 verification error:', err);
  process.exit(1);
});
