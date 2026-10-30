/**
 * Selwick POS — Real Turso Cloud Database Live Persistence & Lifecycle Test Suite.
 *
 * Connects directly to the REAL Turso Cloud database (libsql://...) to verify:
 *  1. Authenticated connection to remote Turso database in AWS AP South (Mumbai)
 *  2. Verification that remote schema tables & indexes are intact
 *  3. Persistence across connection closure and reconnection
 *  4. Full commercial licensing lifecycle on the remote cloud database:
 *     - License creation & storage
 *     - Device activation & Ed25519 payload signing
 *     - Atomic device limit enforcement
 *     - Remote device deactivation
 *     - License verification
 *     - License renewal
 *     - Suspend / Reactivate / Revoke state transitions
 *     - Audit logging verification
 *  5. Cleanup of test artifact
 *
 * Strictly adheres to security rules: Never prints auth tokens or private keys.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

let passed = 0;
let failed = 0;

async function runCheck(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('    ', err instanceof assert.AssertionError ? err.message : (err.message || err));
    failed++;
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  console.log('======================================================================');
  console.log('SELWICK POS — REAL TURSO CLOUD DATABASE LIVE VERIFICATION');
  console.log('======================================================================\n');

  if (!url || !url.trim() || !authToken || !authToken.trim()) {
    console.log('⚠️  TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is not configured in .env.local.');
    console.log('   Please configure your Turso credentials in .env.local to run live tests.');
    process.exit(2);
  }

  // Ensure it is a real remote Turso URL
  assert(url.startsWith('libsql://'), 'TURSO_DATABASE_URL must be a real remote libsql:// URL.');
  const safeHost = url.replace(/libsql:\/\/([^.]+).*/, '$1.turso.io');
  console.log(`Targeting Remote Cloud Host: [${safeHost}] (AWS Mumbai AP-South)\n`);

  const tursoRepo = await import('../src/lib/licensing/tursoRepository.ts');
  const keysMod = await import('../src/lib/licensing/keys.ts');

  // Generate ephemeral test Ed25519 keypair for signing test
  const testKeypair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  let client = createClient({ url: url.trim(), authToken: authToken.trim() });

  console.log('--- SECTION 1: REMOTE SCHEMA & CONNECTION INTEGRITY ---');

  await runCheck('1. Remote connection established & schema tables exist', async () => {
    const res = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const tables = res.rows.map(r => r.name);
    assert(tables.includes('licenses'), 'Remote Turso must contain `licenses` table');
    assert(tables.includes('activations'), 'Remote Turso must contain `activations` table');
    assert(tables.includes('license_audit_logs'), 'Remote Turso must contain `license_audit_logs` table');
  });

  await runCheck('2. Remote indexes verified on Turso cloud database', async () => {
    const res = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name");
    const indexes = res.rows.map(r => r.name);
    assert(indexes.includes('idx_licenses_key'), 'idx_licenses_key must exist');
    assert(indexes.includes('idx_activations_device'), 'idx_activations_device must exist');
  });

  console.log('\n--- SECTION 2: REAL CLOUD PERSISTENCE ACROSS RECONNECTIONS ---');

  let testLicense;
  const testUniqueSuffix = crypto.randomBytes(4).toString('hex');
  const testCustomer = `Real Turso Pilot Test ${testUniqueSuffix}`;

  await runCheck('3. Write test license record to real Turso database', async () => {
    testLicense = await tursoRepo.createLicenseTurso(client, {
      customerName: testCustomer,
      email: `pilot-${testUniqueSuffix}@selwick.internal`,
      plan: 'monthly',
      maxDevices: 1,
      paymentReference: `LIVE-TEST-${testUniqueSuffix}`,
      actor: 'live-test-suite',
    });

    assert(testLicense.id, 'License ID must be returned');
    assert(testLicense.licenseKey.startsWith('SELW-'), 'Key must start with SELW-');
  });

  await runCheck('4. Close connection, reconnect new client, verify persistence', async () => {
    client.close(); // Terminate first client connection

    // Open second completely fresh client
    client = createClient({ url: url.trim(), authToken: authToken.trim() });

    const fetched = await tursoRepo.getLicenseByIdTurso(client, testLicense.id);
    assert.strictEqual(fetched?.id, testLicense.id, 'Record must persist across connection close and reconnect');
    assert.strictEqual(fetched?.customerName, testCustomer, 'Customer name must match exactly');
  });

  console.log('\n--- SECTION 3: REAL LICENSING WORKFLOW ON TURSO CLOUD ---');

  let activationPayload;
  let activationRecordId;

  await runCheck('5. Terminal 1 activates on remote Turso; receives Ed25519 signed payload', async () => {
    const deviceId = `MUMBAI-TEST-DEV-1-${testUniqueSuffix}`;
    const res = await tursoRepo.activateLicenseTurso(
      client,
      testLicense.licenseKey,
      deviceId,
      'Counter 1 (Mumbai)',
      testKeypair.privateKey,
      '203.0.113.195'
    );

    assert(res.signedPayload, 'Signed payload must be generated');
    assert(res.signature, 'Signature must be returned');

    const validSig = keysMod.verifyLicenseSignature(res.signedPayload, res.signature, testKeypair.publicKey);
    assert.strictEqual(validSig, true, 'Remote payload must verify with Ed25519 public key');

    // Retrieve activation ID from Turso
    const details = await tursoRepo.getLicenseDetailsTurso(client, testLicense.id);
    const act = details.activations.find(a => a.deviceId === deviceId);
    assert(act, 'Activation must be stored in remote Turso activations table');
    activationRecordId = act.id;
  });

  await runCheck('6. Terminal 2 rejected due to atomic device limit (max = 1) in Turso transaction', async () => {
    const deviceId2 = `MUMBAI-TEST-DEV-2-${testUniqueSuffix}`;
    let caught = null;
    try {
      await tursoRepo.activateLicenseTurso(
        client,
        testLicense.licenseKey,
        deviceId2,
        'Counter 2',
        testKeypair.privateKey
      );
    } catch (err) {
      caught = err;
    }
    assert(caught, 'Second machine must be blocked');
    assert.strictEqual(caught.code, 'DEVICE_LIMIT_REACHED');
  });

  await runCheck('7. Remote device deactivation frees capacity; Terminal 2 now succeeds', async () => {
    const deactivated = await tursoRepo.deactivateActivationByIdTurso(client, activationRecordId, 'admin');
    assert.strictEqual(deactivated, true);

    const deviceId2 = `MUMBAI-TEST-DEV-2-${testUniqueSuffix}`;
    const res2 = await tursoRepo.activateLicenseTurso(
      client,
      testLicense.licenseKey,
      deviceId2,
      'Counter 2',
      testKeypair.privateKey
    );
    assert(res2.signedPayload);
    assert.strictEqual(keysMod.verifyLicenseSignature(res2.signedPayload, res2.signature, testKeypair.publicKey), true);
  });

  await runCheck('8. Remote verifyLicenseTurso validates active terminal on Turso', async () => {
    const deviceId2 = `MUMBAI-TEST-DEV-2-${testUniqueSuffix}`;
    const verified = await tursoRepo.verifyLicenseTurso(
      client,
      testLicense.licenseKey,
      deviceId2,
      testKeypair.privateKey
    );
    assert.strictEqual(verified.status, 'active');
  });

  await runCheck('9. Remote renewal extends license expiry on Turso', async () => {
    const initialExpiry = testLicense.expiresAt;
    const renewed = await tursoRepo.renewLicenseTurso(client, testLicense.id, undefined, 'billing');
    assert(renewed.expiresAt > initialExpiry, 'Renewed expiry must advance');
  });

  await runCheck('10. Remote suspend, reactivate, and revoke state transitions', async () => {
    await tursoRepo.setLicenseStatusTurso(client, testLicense.id, 'suspended', 'admin');
    let rec = await tursoRepo.getLicenseByIdTurso(client, testLicense.id);
    assert.strictEqual(rec?.status, 'suspended');

    await tursoRepo.setLicenseStatusTurso(client, testLicense.id, 'active', 'admin');
    rec = await tursoRepo.getLicenseByIdTurso(client, testLicense.id);
    assert.strictEqual(rec?.status, 'active');

    await tursoRepo.setLicenseStatusTurso(client, testLicense.id, 'revoked', 'admin');
    rec = await tursoRepo.getLicenseByIdTurso(client, testLicense.id);
    assert.strictEqual(rec?.status, 'revoked');
  });

  await runCheck('11. Remote audit logs verified on Turso', async () => {
    const logs = await client.execute({
      sql: 'SELECT action, actor FROM license_audit_logs WHERE license_id = ? ORDER BY created_at ASC',
      args: [testLicense.id],
    });
    const actions = logs.rows.map(r => r.action);
    assert(actions.includes('create_license'), 'Must include create_license');
    assert(actions.includes('activate_device'), 'Must include activate_device');
    assert(actions.includes('deactivate_device'), 'Must include deactivate_device');
    assert(actions.includes('renew_license'), 'Must include renew_license');
    assert(actions.includes('set_status'), 'Must include set_status');
  });

  // Cleanup test record
  await client.execute({ sql: 'DELETE FROM licenses WHERE id = ?', args: [testLicense.id] });
  client.close();

  console.log('\n======================================================================');
  console.log(`REAL TURSO CLOUD VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('======================================================================');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal live test failure:', err.message || err);
  process.exit(1);
});

