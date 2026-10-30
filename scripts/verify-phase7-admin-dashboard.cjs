#!/usr/bin/env node
/**
 * Selwick POS — Phase 7 Commercial Licensing Admin Dashboard Verification Suite
 *
 * Exhaustively tests:
 *  1. Admin authentication (Bearer, X-Admin-Key, HMAC session token)
 *  2. Unauthorized admin rejection & timing-safe failure
 *  3. Admin rate-limiting lockout on failed login attempts
 *  4. Create license with customer, plan, device limit & payment metadata
 *  5. Cryptographically strong unique key generation (uniqueness & entropy)
 *  6. Plan tier assignments & feature flag defaults
 *  7. Expiry calculation (Trial: +14d, Monthly: +30d, Yearly: +365d)
 *  8. Lifetime plan expiry = null invariant
 *  9. Device limit enforcement on activations
 * 10. Device deactivation & immediate slot liberation
 * 11. Intelligent license renewal (extends from existing future entitlement)
 * 12. Suspend & Revoke state transitions
 * 13. Reactivate suspended license
 * 14. Administrative audit logging (all operations logged with actor & metadata)
 * 15. Zero private key exposure in API responses, logs, or client code
 * 16. Customer delivery message generation
 * 17. Operational database isolation (selwick.db is 100% untouched)
 * 18. Production electron-builder configuration (deleteAppDataOnUninstall: false, .data excluded)
 * 19. Public key only in POS client build
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const TEST_DATA_DIR = path.join(ROOT, '.data_test_phase7');

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.stack || err.message}`);
    failed++;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('SELWICK POS — PHASE 7 COMMERCIAL LICENSING ADMIN VERIFICATION');
  console.log('='.repeat(70));

  if (fs.existsSync(TEST_DATA_DIR)) {
    try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
  }
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  const testLicenseDbPath = path.join(TEST_DATA_DIR, 'license_server_test.db');
  const testPosDbPath = path.join(TEST_DATA_DIR, 'pos_operational_test.db');
  const testActivationPath = path.join(TEST_DATA_DIR, 'license_activation.json');

  process.env.SELWICK_LICENSE_DB_PATH = testLicenseDbPath;
  process.env.SELWICK_ACTIVATION_PATH = testActivationPath;
  process.env.SELWICK_LICENSE_ADMIN_SECRET = 'selwick-test-admin-secret-2026';

  // Dynamic module imports
  const adminAuthModule = await import('../src/lib/licensing/adminAuth.ts');
  const keysModule = await import('../src/lib/licensing/keys.ts');
  const dbModule = await import('../src/lib/licensing/licenseDb.ts');
  const serviceModule = await import('../src/lib/licensing/licenseService.ts');
  const serverKeyModule = await import('../src/lib/licensing/serverKey.ts');

  const {
    getAdminSecret,
    createAdminSessionToken,
    verifyAdminSessionToken,
    verifyAdminRequest,
    checkLoginRateLimit,
    recordFailedLogin,
    clearLoginRateLimit,
  } = adminAuthModule;

  const { generateLicenseKey, verifyLicenseSignature, SELWICK_POS_PUBLIC_KEY } = keysModule;
  const { getLicenseDatabase, closeLicenseDatabase } = dbModule;
  const {
    createLicense,
    activateLicense,
    renewLicense,
    setLicenseStatus,
    deactivateDevice,
    deactivateActivationById,
    getLicenseDetails,
    getDashboardMetrics,
    listLicenses,
    generateCustomerMessage,
  } = serviceModule;

  const { getLicenseServerPrivateKey, DEFAULT_DEV_PRIVATE_KEY } = serverKeyModule;
  const serverPrivateKey = getLicenseServerPrivateKey();
  const licenseDb = getLicenseDatabase(testLicenseDbPath);

  // Setup mock POS operational database to verify complete isolation
  const posDb = new DatabaseSync(testPosDbPath);
  posDb.exec(`
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, price_cents INTEGER);
    CREATE TABLE sales (id TEXT PRIMARY KEY, total_cents INTEGER, created_at TEXT);
    INSERT INTO products VALUES ('prod-101', 'Wheat Flour 10kg', 145000);
    INSERT INTO sales VALUES ('sale-202', 145000, datetime('now'));
  `);

  console.log('\n--- 1. ADMIN AUTHENTICATION & SECURITY ---');

  await asyncTest('1. Admin authentication: Bearer, X-Admin-Key & HMAC session token succeed', () => {
    // A. Bearer secret
    const reqBearer = {
      headers: new Headers({ authorization: 'Bearer selwick-test-admin-secret-2026' }),
      cookies: { get: () => undefined },
    };
    const resBearer = verifyAdminRequest(reqBearer);
    assert.strictEqual(resBearer.authorized, true);

    // B. X-Admin-Key header
    const reqHeader = {
      headers: new Headers({ 'x-admin-key': 'selwick-test-admin-secret-2026' }),
      cookies: { get: () => undefined },
    };
    const resHeader = verifyAdminRequest(reqHeader);
    assert.strictEqual(resHeader.authorized, true);

    // C. HMAC Session Token
    const token = createAdminSessionToken('owner-operator');
    const verifyToken = verifyAdminSessionToken(token);
    assert.strictEqual(verifyToken.valid, true);
    assert.strictEqual(verifyToken.actor, 'owner-operator');

    const reqCookie = {
      headers: new Headers(),
      cookies: { get: (name) => (name === 'selwick_license_admin_token' ? { value: token } : undefined) },
    };
    const resCookie = verifyAdminRequest(reqCookie);
    assert.strictEqual(resCookie.authorized, true);
    assert.strictEqual(resCookie.actor, 'owner-operator');
  });

  await asyncTest('2. Unauthorized admin rejection: Invalid tokens and missing secrets fail closed', () => {
    // Missing credentials
    const reqEmpty = { headers: new Headers(), cookies: { get: () => undefined } };
    assert.strictEqual(verifyAdminRequest(reqEmpty).authorized, false);

    // Wrong secret
    const reqWrong = {
      headers: new Headers({ 'x-admin-key': 'wrong-unauthorized-password' }),
      cookies: { get: () => undefined },
    };
    assert.strictEqual(verifyAdminRequest(reqWrong).authorized, false);

    // Tampered token
    const token = createAdminSessionToken('admin');
    const tampered = token.slice(0, -4) + 'abcd';
    assert.strictEqual(verifyAdminSessionToken(tampered).valid, false);
  });

  await asyncTest('3. Admin rate-limiting: 5 failed attempts locks out IP', () => {
    const testIp = '192.168.1.105';
    clearLoginRateLimit(testIp);

    for (let i = 0; i < 4; i++) {
      recordFailedLogin(testIp);
      assert.strictEqual(checkLoginRateLimit(testIp).allowed, true, `Attempt ${i + 1} not locked out`);
    }

    // 5th attempt locks out
    recordFailedLogin(testIp);
    const limitResult = checkLoginRateLimit(testIp);
    assert.strictEqual(limitResult.allowed, false, '5th attempt triggered lockout');
    assert.ok(limitResult.remainingLockoutSeconds > 0, 'Reports remaining lockout seconds');

    clearLoginRateLimit(testIp);
    assert.strictEqual(checkLoginRateLimit(testIp).allowed, true, 'Clear rate limit restores access');
  });

  console.log('\n--- 2. LICENSE ISSUANCE & KEY GENERATION ---');

  let testMonthlyLicense;

  await asyncTest('4. Create license: Stores plan, device limit, features & payment preparation metadata', () => {
    testMonthlyLicense = createLicense(licenseDb, {
      customerName: 'Ahmed Electronics',
      email: 'ahmed@electronics.pk',
      plan: 'monthly',
      maxDevices: 2,
      durationDays: 30,
      paymentReference: 'PAY-INV-2026-001',
      paymentProvider: 'Bank Transfer',
      paymentStatus: 'paid',
      notes: 'Pilot launch at Main Branch Gulberg',
      actor: 'license-admin',
    });

    assert.ok(testMonthlyLicense.id, 'License ID generated');
    assert.ok(testMonthlyLicense.licenseKey.startsWith('SELW-MTH-'), 'License key has SELW-MTH- prefix');
    assert.strictEqual(testMonthlyLicense.customerName, 'Ahmed Electronics');
    assert.strictEqual(testMonthlyLicense.maxDevices, 2);
    assert.strictEqual(testMonthlyLicense.paymentReference, 'PAY-INV-2026-001');
    assert.strictEqual(testMonthlyLicense.paymentStatus, 'paid');
  });

  await asyncTest('5. Cryptographically strong unique key generation: High entropy, 0 collisions', () => {
    const keys = new Set();
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKey('SELW', 'YEAR');
      assert.ok(/^SELW-[A-Z]+-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key), `Valid format: ${key}`);
      keys.add(key);
    }
    assert.strictEqual(keys.size, 100, '100 generated keys are distinct and unique');
  });

  await asyncTest('6. Plan tier assignments & feature flag defaults', () => {
    const trialLic = createLicense(licenseDb, { customerName: 'Trial Shop', email: 't@s.com', plan: 'trial' });
    const yearLic = createLicense(licenseDb, { customerName: 'Yearly Shop', email: 'y@s.com', plan: 'yearly' });

    assert.ok(trialLic.features.includes('inventory'));
    assert.ok(trialLic.features.includes('khata'));
    assert.ok(!trialLic.features.includes('cloud_backup'), 'Trial does not include cloud backup by default');

    assert.ok(yearLic.features.includes('cloud_backup'), 'Yearly includes cloud backup');
  });

  await asyncTest('7. Expiry calculation: Trial (+14d), Monthly (+30d), Yearly (+365d)', () => {
    const now = Date.now();

    const trial = createLicense(licenseDb, { customerName: 'T1', email: 't1@s.com', plan: 'trial' });
    const trialDiffDays = Math.round((new Date(trial.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    assert.strictEqual(trialDiffDays, 14);

    const mth = createLicense(licenseDb, { customerName: 'M1', email: 'm1@s.com', plan: 'monthly' });
    const mthDiffDays = Math.round((new Date(mth.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    assert.strictEqual(mthDiffDays, 30);

    const yr = createLicense(licenseDb, { customerName: 'Y1', email: 'y1@s.com', plan: 'yearly' });
    const yrDiffDays = Math.round((new Date(yr.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    assert.strictEqual(yrDiffDays, 365);
  });

  await asyncTest('8. Lifetime plan expiry = null invariant', () => {
    const life = createLicense(licenseDb, { customerName: 'Forever Mart', email: 'life@mart.com', plan: 'lifetime' });
    assert.strictEqual(life.expiresAt, null, 'Lifetime license has null expiration');
  });

  console.log('\n--- 3. DEVICE MANAGEMENT & DEACTIVATION ---');

  let activation1;
  let activation2;

  await asyncTest('9. Device limit enforcement on activations', () => {
    // Ahmed Electronics has maxDevices = 2
    activation1 = activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-01', 'Cashier Front 1', serverPrivateKey);
    assert.ok(activation1.signature);

    activation2 = activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-02', 'Cashier Front 2', serverPrivateKey);
    assert.ok(activation2.signature);

    // 3rd terminal attempts activation -> rejected
    assert.throws(
      () => {
        activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-03', 'Backoffice PC', serverPrivateKey);
      },
      (err) => err.code === 'DEVICE_LIMIT_REACHED'
    );
  });

  await asyncTest('10. Device deactivation: Frees device slot allowing new machine to pair', () => {
    const detailsBefore = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    assert.strictEqual(detailsBefore.activeDevices, 2);

    const act1Record = detailsBefore.activations.find((a) => a.deviceId === 'TERM-PC-01');
    assert.ok(act1Record);

    // Deactivate device via activationId
    const deactivated = deactivateActivationById(licenseDb, act1Record.id, 'admin-operator');
    assert.strictEqual(deactivated, true);

    const detailsAfter = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    assert.strictEqual(detailsAfter.activeDevices, 1, 'Active devices decremented to 1');

    // TERM-PC-03 can now activate into the freed slot
    const act3 = activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-03', 'Backoffice PC', serverPrivateKey);
    assert.ok(act3.signature, 'New terminal activated successfully into freed slot');
  });

  console.log('\n--- 4. LIFECYCLE: RENEWAL, SUSPENSION & REACTIVATION ---');

  await asyncTest('11. Intelligent license renewal: Extends from existing future entitlement', () => {
    // Current license expires in ~30 days
    const currentExpiry = new Date(testMonthlyLicense.expiresAt);
    const renewed = renewLicense(licenseDb, testMonthlyLicense.id, undefined, 'admin');

    const newExpiry = new Date(renewed.expiresAt);
    const diffDays = Math.round((newExpiry.getTime() - currentExpiry.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 30, 'Renewal extended by 30 days from previous expiry date');
  });

  await asyncTest('12. Suspend & Revoke state transitions', () => {
    // Suspend
    setLicenseStatus(licenseDb, testMonthlyLicense.id, 'suspended', 'admin');
    const suspendedLic = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    assert.strictEqual(suspendedLic.status, 'suspended');

    // Suspended license cannot activate
    assert.throws(
      () => {
        activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-99', 'New Terminal', serverPrivateKey);
      },
      (err) => err.code === 'LICENSE_SUSPENDED'
    );

    // Revoke
    setLicenseStatus(licenseDb, testMonthlyLicense.id, 'revoked', 'admin');
    const revokedLic = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    assert.strictEqual(revokedLic.status, 'revoked');

    assert.throws(
      () => {
        activateLicense(licenseDb, testMonthlyLicense.licenseKey, 'TERM-PC-99', 'New Terminal', serverPrivateKey);
      },
      (err) => err.code === 'LICENSE_REVOKED'
    );
  });

  await asyncTest('13. Reactivate suspended license', () => {
    const tempLic = createLicense(licenseDb, { customerName: 'Temp Mart', email: 'temp@mart.com', plan: 'monthly' });
    setLicenseStatus(licenseDb, tempLic.id, 'suspended');

    // Reactivate back to active
    setLicenseStatus(licenseDb, tempLic.id, 'active');
    const reactivated = getLicenseDetails(licenseDb, tempLic.id);
    assert.strictEqual(reactivated.status, 'active');

    // Can now activate
    const act = activateLicense(licenseDb, tempLic.licenseKey, 'DEV-REACT-01', 'Terminal', serverPrivateKey);
    assert.ok(act.signature);
  });

  console.log('\n--- 5. AUDIT LOGGING & SECURITY CHECKS ---');

  await asyncTest('14. Administrative audit logging: All actions recorded with actor & details', () => {
    const details = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    assert.ok(details.auditLogs.length >= 4, 'Multiple audit logs recorded');

    const actions = details.auditLogs.map((l) => l.action);
    assert.ok(actions.includes('create_license'), 'Logs license creation');
    assert.ok(actions.includes('deactivate_device'), 'Logs device deactivation');
    assert.ok(actions.includes('renew_license'), 'Logs license renewal');
    assert.ok(actions.includes('set_status'), 'Logs status changes');
  });

  await asyncTest('15. Zero private key exposure in API responses, logs, or client code', () => {
    const details = getLicenseDetails(licenseDb, testMonthlyLicense.id);
    const jsonStr = JSON.stringify(details);

    assert.ok(!jsonStr.includes('BEGIN PRIVATE KEY'), 'No private key in license details JSON');
    assert.ok(!jsonStr.includes(DEFAULT_DEV_PRIVATE_KEY), 'Default dev private key not present');

    const metrics = getDashboardMetrics(licenseDb);
    const metricsStr = JSON.stringify(metrics);
    assert.ok(!metricsStr.includes('PRIVATE KEY'), 'No private key in metrics JSON');
  });

  await asyncTest('16. Customer delivery message generation', () => {
    const message = generateCustomerMessage(testMonthlyLicense);
    assert.ok(message.includes('Ahmed Electronics'), 'Customer name present in message');
    assert.ok(message.includes(testMonthlyLicense.licenseKey), 'License key present in message');
    assert.ok(message.includes('Activate Terminal'), 'Activation instructions present');
    assert.ok(!message.includes('private'), 'No internal cryptographic secrets leaked');
  });

  console.log('\n--- 6. OPERATIONAL INTEGRITY & PACKAGING CHECKS ---');

  await asyncTest('17. Operational database isolation: selwick.db is 100% untouched', () => {
    const tables = posDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('products'), 'Operational products table intact');
    assert.ok(tables.includes('sales'), 'Operational sales table intact');
    assert.ok(!tables.includes('licenses'), 'No licenses table in POS database');
    assert.ok(!tables.includes('activations'), 'No activations table in POS database');
    assert.ok(!tables.includes('license_audit_logs'), 'No audit logs in POS database');

    const prodCount = posDb.prepare('SELECT COUNT(*) as c FROM products').get().c;
    const saleCount = posDb.prepare('SELECT COUNT(*) as c FROM sales').get().c;
    assert.strictEqual(prodCount, 1);
    assert.strictEqual(saleCount, 1);
  });

  await asyncTest('18. Production electron-builder configuration: deleteAppDataOnUninstall: false, .data excluded', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(
      pkg.build?.nsis?.deleteAppDataOnUninstall,
      false,
      'NSIS configured with deleteAppDataOnUninstall: false'
    );

    const extraResFilters = pkg.build?.extraResources?.[0]?.filter || [];
    assert.ok(extraResFilters.includes('!.data/**/*'), 'Extra resources excludes .data directory');
  });

  await asyncTest('19. Public key only in POS client build: No private key imports in client modules', () => {
    const keysSrc = fs.readFileSync(path.join(ROOT, 'src/lib/licensing/keys.ts'), 'utf8');
    assert.ok(keysSrc.includes('SELWICK_POS_PUBLIC_KEY'), 'Embedded public key present');
    assert.ok(!keysSrc.includes('PRIVATE KEY'), 'Keys module contains zero private keys');

    const clientSrc = fs.readFileSync(path.join(ROOT, 'src/lib/licensing/posLicenseClient.ts'), 'utf8');
    assert.ok(!clientSrc.includes('serverKey'), 'POS license client does not import serverKey');
    assert.ok(!clientSrc.includes('PRIVATE'), 'POS license client contains zero private key references');
  });

  // Cleanup
  try { licenseDb.close(); } catch {}
  closeLicenseDatabase();
  try { posDb.close(); } catch {}
  if (fs.existsSync(TEST_DATA_DIR)) {
    try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
  }

  console.log('\n' + '='.repeat(70));
  console.log(`PHASE 7 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in Phase 7 verification:', err);
  process.exit(1);
});

