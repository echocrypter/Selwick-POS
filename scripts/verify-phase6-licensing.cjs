#!/usr/bin/env node
/**
 * Selwick POS — Phase 6 Commercial Licensing & Activation Verification Suite
 *
 * Exhaustively validates:
 *  1. Valid activation (creates signed payload, verifies Ed25519 signature)
 *  2. Invalid license key rejected (404 / error)
 *  3. Expired license rejected on activation
 *  4. Revoked license rejected (403)
 *  5. Suspended license rejected (403)
 *  6. Device limit enforcement (e.g. max 1 device: 1st succeeds, 2nd rejected with DEVICE_LIMIT_REACHED)
 *  7. Device deactivation (frees up slot so 2nd device can activate)
 *  8. Signed payload verification with public key (cryptographic integrity)
 *  9. Modified/tampered payload rejection (altering customerName, expiry, plan, or features fails signature)
 * 10. Offline operation (evaluates valid license completely offline with zero network)
 * 11. Temporary license server outage (POS continues operating using locally cached signature)
 * 12. Offline grace period evaluation (warns when nearing grace end, blocks when grace exceeded)
 * 13. License renewal (extending expiry updates status and allows reactivation)
 * 14. Feature flags (isFeatureEnabled correctly checks plan features)
 * 15. Device mismatch rejection (activation from Device A fails if run on Device B)
 * 16. POS SQLite database remains 100% untouched by any licensing error or expiration
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const TEST_DATA_DIR = path.join(ROOT, '.data_test_phase6');

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
  console.log('SELWICK POS — PHASE 6 COMMERCIAL LICENSING VERIFICATION SUITE');
  console.log('='.repeat(70));

  // Ensure clean test directory
  if (fs.existsSync(TEST_DATA_DIR)) {
    try {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  }
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  const testLicenseDbPath = path.join(TEST_DATA_DIR, 'license_server_test.db');
  const testPosDbPath = path.join(TEST_DATA_DIR, 'pos_operational_test.db');
  const testActivationPath = path.join(TEST_DATA_DIR, 'license_activation.json');

  process.env.SELWICK_LICENSE_DB_PATH = testLicenseDbPath;
  process.env.SELWICK_ACTIVATION_PATH = testActivationPath;

  // Import dynamic TypeScript modules
  const keysModule = await import('../src/lib/licensing/keys.ts');
  const dbModule = await import('../src/lib/licensing/licenseDb.ts');
  const serviceModule = await import('../src/lib/licensing/licenseService.ts');
  const clientModule = await import('../src/lib/licensing/posLicenseClient.ts');
  const serverKeyModule = await import('../src/lib/licensing/serverKey.ts');

  const { signLicensePayload, verifyLicenseSignature, canonicalizePayload, SELWICK_POS_PUBLIC_KEY } = keysModule;
  const { getLicenseDatabase, closeLicenseDatabase } = dbModule;
  const {
    createLicense,
    activateLicense,
    deactivateDevice,
    renewLicense,
    setLicenseStatus,
    setMaxDevices,
    getLicenseByKey,
  } = serviceModule;
  const { evaluateLicenseState, isFeatureEnabled, saveLocalActivation, loadLocalActivation, clearLocalActivation } = clientModule;
  const { getLicenseServerPrivateKey } = serverKeyModule;

  const serverPrivateKey = getLicenseServerPrivateKey();
  const licenseDb = getLicenseDatabase(testLicenseDbPath);

  // Setup mock POS operational database to verify non-destruction
  const posDb = new DatabaseSync(testPosDbPath);
  posDb.exec(`
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, price_cents INTEGER);
    CREATE TABLE sales (id TEXT PRIMARY KEY, total_cents INTEGER, created_at TEXT);
    INSERT INTO products VALUES ('prod-1', 'Basmati Rice 5kg', 125000);
    INSERT INTO sales VALUES ('sale-1', 125000, datetime('now'));
  `);

  console.log('\n--- 1. ISSUANCE & CRYPTOGRAPHIC ACTIVATION ---');

  let yearlyLicense;
  let activationResult;

  await asyncTest('1. Valid activation creates signed payload and verifies Ed25519 signature', () => {
    yearlyLicense = createLicense(licenseDb, {
      customerName: 'Al-Rehman Superstore',
      email: 'owner@alrehman.com',
      plan: 'yearly',
      maxDevices: 2,
      durationDays: 365,
    });

    assert.ok(yearlyLicense.licenseKey.startsWith('SELW-YEAR-'), 'License key prefix matches yearly plan');
    assert.strictEqual(yearlyLicense.status, 'active');
    assert.strictEqual(yearlyLicense.customerName, 'Al-Rehman Superstore');

    activationResult = activateLicense(
      licenseDb,
      yearlyLicense.licenseKey,
      'DEVICE-TERMINAL-01',
      'Front Counter Register 1',
      serverPrivateKey
    );

    assert.ok(activationResult.signedPayload, 'Signed payload returned');
    assert.ok(activationResult.signature, 'Ed25519 signature returned');
    assert.strictEqual(activationResult.signedPayload.deviceId, 'DEVICE-TERMINAL-01');
    assert.strictEqual(activationResult.signedPayload.customerName, 'Al-Rehman Superstore');

    const verified = verifyLicenseSignature(
      activationResult.signedPayload,
      activationResult.signature,
      SELWICK_POS_PUBLIC_KEY
    );
    assert.strictEqual(verified, true, 'Cryptographic Ed25519 verification succeeds using public key only');
  });

  await asyncTest('2. Invalid license key rejected (404 error)', () => {
    assert.throws(
      () => {
        activateLicense(
          licenseDb,
          'SELW-FAKE-9999-8888-7777',
          'DEVICE-TERMINAL-01',
          'Terminal',
          serverPrivateKey
        );
      },
      (err) => err.code === 'LICENSE_NOT_FOUND' || err.status === 404
    );
  });

  await asyncTest('3. Expired license rejected on activation', () => {
    const expiredLic = createLicense(licenseDb, {
      customerName: 'Past Due Mart',
      email: 'due@mart.com',
      plan: 'monthly',
      durationDays: -5, // Expired 5 days ago
    });

    assert.throws(
      () => {
        activateLicense(
          licenseDb,
          expiredLic.licenseKey,
          'DEVICE-TERMINAL-01',
          'Terminal',
          serverPrivateKey
        );
      },
      (err) => err.code === 'LICENSE_EXPIRED' || err.status === 403
    );
  });

  await asyncTest('4. Revoked license rejected on activation (403)', () => {
    const revLic = createLicense(licenseDb, {
      customerName: 'Revoked Store',
      email: 'rev@store.com',
      plan: 'yearly',
    });
    setLicenseStatus(licenseDb, revLic.id, 'revoked');

    assert.throws(
      () => {
        activateLicense(
          licenseDb,
          revLic.licenseKey,
          'DEVICE-TERMINAL-01',
          'Terminal',
          serverPrivateKey
        );
      },
      (err) => err.code === 'LICENSE_REVOKED' || err.status === 403
    );
  });

  await asyncTest('5. Suspended license rejected on activation (403)', () => {
    const suspLic = createLicense(licenseDb, {
      customerName: 'Suspended Mart',
      email: 'susp@mart.com',
      plan: 'monthly',
    });
    setLicenseStatus(licenseDb, suspLic.id, 'suspended');

    assert.throws(
      () => {
        activateLicense(
          licenseDb,
          suspLic.licenseKey,
          'DEVICE-TERMINAL-01',
          'Terminal',
          serverPrivateKey
        );
      },
      (err) => err.code === 'LICENSE_SUSPENDED' || err.status === 403
    );
  });

  console.log('\n--- 2. MULTI-DEVICE LIMITS & DEACTIVATION ---');

  let singleDeviceLic;

  await asyncTest('6. Device limit enforcement (max 1 device: 1st succeeds, 2nd rejected)', () => {
    singleDeviceLic = createLicense(licenseDb, {
      customerName: 'Single Terminal Cafe',
      email: 'cafe@pos.com',
      plan: 'trial',
      maxDevices: 1,
    });

    // 1st device activation succeeds
    const act1 = activateLicense(
      licenseDb,
      singleDeviceLic.licenseKey,
      'DEV-CAFE-01',
      'Register 1',
      serverPrivateKey
    );
    assert.ok(act1.signature);

    // 2nd device activation fails
    assert.throws(
      () => {
        activateLicense(
          licenseDb,
          singleDeviceLic.licenseKey,
          'DEV-CAFE-02',
          'Register 2',
          serverPrivateKey
        );
      },
      (err) => err.code === 'DEVICE_LIMIT_REACHED' || err.status === 403
    );
  });

  await asyncTest('7. Device deactivation frees slot allowing second machine to activate', () => {
    // Deactivate DEV-CAFE-01
    const deactivated = deactivateDevice(licenseDb, singleDeviceLic.id, 'DEV-CAFE-01');
    assert.strictEqual(deactivated, true, 'Device deactivation returned true');

    // DEV-CAFE-02 can now activate into the freed slot
    const act2 = activateLicense(
      licenseDb,
      singleDeviceLic.licenseKey,
      'DEV-CAFE-02',
      'Register 2',
      serverPrivateKey
    );
    assert.ok(act2.signature, 'Device 2 successfully activates after Device 1 slot freed');
  });

  console.log('\n--- 3. TAMPER RESISTANCE & SIGNATURE VALIDATION ---');

  await asyncTest('8. Signed payload verification with public key alone (zero private key knowledge)', () => {
    const canonical = canonicalizePayload(activationResult.signedPayload);
    const pubKeyObj = crypto.createPublicKey(SELWICK_POS_PUBLIC_KEY);
    const nativeVerified = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      pubKeyObj,
      Buffer.from(activationResult.signature, 'base64')
    );
    assert.strictEqual(nativeVerified, true, 'Native crypto.verify confirms Ed25519 signature validity');
  });

  await asyncTest('9. Modified/tampered payload rejection (altering customerName, expiry, plan, or features)', () => {
    const original = activationResult.signedPayload;
    const sig = activationResult.signature;

    // Tamper 1: Modify customer name
    const tamperedName = { ...original, customerName: 'Fraudulent Malicious Store' };
    assert.strictEqual(
      verifyLicenseSignature(tamperedName, sig, SELWICK_POS_PUBLIC_KEY),
      false,
      'Tampered customerName rejected'
    );

    // Tamper 2: Extend expiration by 10 years
    const tamperedExpiry = { ...original, expiresAt: '2036-12-31T23:59:59.000Z' };
    assert.strictEqual(
      verifyLicenseSignature(tamperedExpiry, sig, SELWICK_POS_PUBLIC_KEY),
      false,
      'Tampered expiresAt rejected'
    );

    // Tamper 3: Change plan from yearly to lifetime
    const tamperedPlan = { ...original, plan: 'lifetime', expiresAt: null };
    assert.strictEqual(
      verifyLicenseSignature(tamperedPlan, sig, SELWICK_POS_PUBLIC_KEY),
      false,
      'Tampered plan tier rejected'
    );

    // Tamper 4: Inject unauthorized features
    const tamperedFeatures = { ...original, features: [...original.features, 'super_admin_backdoor'] };
    assert.strictEqual(
      verifyLicenseSignature(tamperedFeatures, sig, SELWICK_POS_PUBLIC_KEY),
      false,
      'Tampered feature flags rejected'
    );
  });

  console.log('\n--- 4. OFFLINE DURABILITY & GRACE PERIOD ---');

  await asyncTest('10. Offline operation: POS evaluates authentic signed license with zero network calls', () => {
    const localData = {
      signedPayload: activationResult.signedPayload,
      signature: activationResult.signature,
      lastVerifiedAt: new Date().toISOString(),
      gracePeriodDays: 14,
    };

    const state = evaluateLicenseState(localData, 'DEVICE-TERMINAL-01', SELWICK_POS_PUBLIC_KEY);

    assert.strictEqual(state.isValid, true);
    assert.strictEqual(state.canOperate, true);
    assert.strictEqual(state.status, 'active');
    assert.strictEqual(state.customerName, 'Al-Rehman Superstore');
    assert.strictEqual(state.plan, 'yearly');
    assert.ok(state.features.includes('inventory'));
  });

  await asyncTest('11. Temporary license server outage: POS continues operating uninterrupted', () => {
    // POS saves activation locally
    saveLocalActivation(activationResult.signedPayload, activationResult.signature, 14);

    // Simulate complete server unreachability by evaluating local state directly
    const cachedActivation = loadLocalActivation();
    assert.ok(cachedActivation, 'Local activation loaded from disk');

    const state = evaluateLicenseState(cachedActivation, 'DEVICE-TERMINAL-01', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(state.canOperate, true, 'POS can checkout and conduct sales normally despite server offline');
  });

  await asyncTest('12. Offline grace period evaluation: 14-day grace, warning nearing end, block after exhaustion', () => {
    const now = Date.now();

    // Case A: Last verified 11 days ago (3 days remaining <= 5 days warning threshold) -> warning active but can operate
    const elevenDaysAgo = new Date(now - 11 * 24 * 60 * 60 * 1000).toISOString();
    const graceWarningData = {
      signedPayload: activationResult.signedPayload,
      signature: activationResult.signature,
      lastVerifiedAt: elevenDaysAgo,
      gracePeriodDays: 14,
    };
    const warningState = evaluateLicenseState(graceWarningData, 'DEVICE-TERMINAL-01', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(warningState.canOperate, true, 'Can operate during active offline grace period');
    assert.strictEqual(warningState.isGracePeriod, true, 'Flagged as within grace warning period');
    assert.strictEqual(warningState.graceDaysRemaining, 3, '3 days remaining of grace');
    assert.ok(warningState.message.includes('within 3 day(s)'), 'Warning message informs user to connect');

    // Case B: Last verified 16 days ago (exceeds 14-day grace) -> blocked
    const sixteenDaysAgo = new Date(now - 16 * 24 * 60 * 60 * 1000).toISOString();
    const graceExpiredData = {
      signedPayload: activationResult.signedPayload,
      signature: activationResult.signature,
      lastVerifiedAt: sixteenDaysAgo,
      gracePeriodDays: 14,
    };
    const expiredState = evaluateLicenseState(graceExpiredData, 'DEVICE-TERMINAL-01', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(expiredState.canOperate, false, 'Operation blocked after grace period exhaustion');
    assert.strictEqual(expiredState.status, 'grace_period');
    assert.strictEqual(expiredState.graceDaysRemaining, 0);

    // Case C: Lifetime license never expires
    const lifetimeLic = createLicense(licenseDb, {
      customerName: 'Evergreen Enterprises',
      email: 'evergreen@corp.com',
      plan: 'lifetime',
    });
    const lifeAct = activateLicense(licenseDb, lifetimeLic.licenseKey, 'DEV-LIFE-01', 'Terminal', serverPrivateKey);
    const lifeLocal = {
      signedPayload: lifeAct.signedPayload,
      signature: lifeAct.signature,
      lastVerifiedAt: new Date().toISOString(),
      gracePeriodDays: 14,
    };
    const lifeState = evaluateLicenseState(lifeLocal, 'DEV-LIFE-01', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(lifeState.canOperate, true);
    assert.strictEqual(lifeState.expiresAt, null, 'Lifetime license has null expiration date');
  });

  console.log('\n--- 5. RENEWAL, FEATURE FLAGS & DEVICE BINDING ---');

  await asyncTest('13. License renewal: Extending expiry updates status and allows reactivation', () => {
    const expiringLic = createLicense(licenseDb, {
      customerName: 'Renewable Shop',
      email: 'renew@shop.com',
      plan: 'monthly',
      durationDays: 1,
    });

    const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    renewLicense(licenseDb, expiringLic.id, newExpiry);

    const renewed = getLicenseByKey(licenseDb, expiringLic.licenseKey);
    assert.strictEqual(renewed.status, 'active');
    assert.strictEqual(renewed.expiresAt, newExpiry, 'Expiry date successfully updated on renewal');

    // Can activate with extended expiry
    const newAct = activateLicense(licenseDb, expiringLic.licenseKey, 'DEV-RENEW-01', 'Terminal', serverPrivateKey);
    assert.strictEqual(newAct.signedPayload.expiresAt, newExpiry);
  });

  await asyncTest('14. Feature flags: isFeatureEnabled accurately validates enabled features', () => {
    const trialLic = createLicense(licenseDb, {
      customerName: 'Trial User',
      email: 'trial@user.com',
      plan: 'trial',
      features: ['inventory', 'khata'],
    });
    const trialAct = activateLicense(licenseDb, trialLic.licenseKey, 'DEV-TRIAL-01', 'Terminal', serverPrivateKey);
    const trialState = evaluateLicenseState({
      signedPayload: trialAct.signedPayload,
      signature: trialAct.signature,
      lastVerifiedAt: new Date().toISOString(),
      gracePeriodDays: 14,
    }, 'DEV-TRIAL-01', SELWICK_POS_PUBLIC_KEY);

    assert.strictEqual(isFeatureEnabled('inventory', trialState), true, 'Inventory is enabled');
    assert.strictEqual(isFeatureEnabled('khata', trialState), true, 'Khata is enabled');
    assert.strictEqual(isFeatureEnabled('cloud_backup', trialState), false, 'Cloud backup is disabled on trial');
  });

  await asyncTest('15. Device mismatch rejection: Activation created for Device A fails on Device B', () => {
    const localData = {
      signedPayload: activationResult.signedPayload, // Registered to DEVICE-TERMINAL-01
      signature: activationResult.signature,
      lastVerifiedAt: new Date().toISOString(),
      gracePeriodDays: 14,
    };

    // Evaluate on a copied/stolen terminal (DEVICE-STOLEN-99)
    const mismatchState = evaluateLicenseState(localData, 'DEVICE-STOLEN-99', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(mismatchState.isValid, false, 'Invalid on mismatched device');
    assert.strictEqual(mismatchState.canOperate, false, 'Cannot operate on mismatched device');
    assert.ok(mismatchState.message.includes('bound to another device'), 'Message informs device mismatch');
  });

  console.log('\n--- 6. OPERATIONAL INTEGRITY & SEPARATION AUDIT ---');

  await asyncTest('16. POS SQLite database remains 100% untouched by any licensing error or expiration', () => {
    const tables = posDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('products'), 'Operational products table present');
    assert.ok(tables.includes('sales'), 'Operational sales table present');
    assert.ok(!tables.includes('licenses'), 'Licenses table is NOT in operational POS database');
    assert.ok(!tables.includes('activations'), 'Activations table is NOT in operational POS database');

    clearLocalActivation();
    const unlicensedState = evaluateLicenseState(null, 'ANY-DEVICE', SELWICK_POS_PUBLIC_KEY);
    assert.strictEqual(unlicensedState.canOperate, false);

    const prodCount = posDb.prepare('SELECT COUNT(*) as c FROM products').get().c;
    const saleCount = posDb.prepare('SELECT COUNT(*) as c FROM sales').get().c;
    assert.strictEqual(prodCount, 1, 'Products table untouched');
    assert.strictEqual(saleCount, 1, 'Sales table untouched');

    const integrity = posDb.prepare('PRAGMA integrity_check').get().integrity_check;
    assert.strictEqual(integrity, 'ok', 'Operational POS database integrity is healthy');
  });

  // Cleanup open connections
  try { licenseDb.close(); } catch {}
  closeLicenseDatabase();
  try { posDb.close(); } catch {}

  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch {}

  console.log('\n' + '='.repeat(70));
  console.log(`PHASE 6 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in Phase 6 verification:', err);
  process.exit(1);
});
