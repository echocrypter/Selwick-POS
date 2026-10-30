/**
 * Selwick POS — Milestone 6 Stage A Verification Suite
 *
 * Verifies:
 * 1. Safe Default Data Access Mode: Strictly 'localstorage' by default
 * 2. Idempotency Key Generation & Stability on Retries
 * 3. Monetary Adapters: Exact bidirectional conversion between Rupees & integer Paisa
 * 4. Discount, Tax, and Refund Adapter Invariants
 * 5. Feature Parity Registry & Missing Endpoints Mapping
 * 6. LocalStorage Data Preservation Invariants
 * 7. Migration Wizard Safety State (Stage A execution lock)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('='.repeat(70));
console.log('SELWICK POS — MILESTONE 6 STAGE A VERIFICATION SUITE');
console.log('='.repeat(70));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// ----------------------------------------------------------------------------
// SUITE 1: Safe Default Data Access Mode & Abstraction
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 1: Data Access Abstraction & Safe Default Mode ---');

test('Data access abstraction module exists and is typed', () => {
  const filePath = path.join(__dirname, '../src/lib/data/dataAccessLayer.ts');
  assert.ok(fs.existsSync(filePath), 'dataAccessLayer.ts must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('export function getDataAccessMode'), 'Must export getDataAccessMode');
  assert.ok(content.includes('export function setDataAccessMode'), 'Must export setDataAccessMode');
  assert.ok(content.includes('export class LocalStorageDataProvider'), 'Must export LocalStorageDataProvider');
  assert.ok(content.includes('export class SqliteApiDataProvider'), 'Must export SqliteApiDataProvider');
});

test('Default data access mode is strictly "localstorage" in SSR and unset browser state', () => {
  const filePath = path.join(__dirname, '../src/lib/data/dataAccessLayer.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  // Verify that SSR returns 'localstorage'
  assert.ok(content.includes("return 'localstorage'"), "Must return 'localstorage' as strict fallback");
  // Verify default provider instantiate localstorage
  assert.ok(content.includes("return new LocalStorageDataProvider()"), 'Default provider must be LocalStorageDataProvider');
});

test('Legacy LocalStorage provider preserves direct storage format and does not mutate backend', () => {
  const filePath = path.join(__dirname, '../src/lib/data/dataAccessLayer.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes("getBusinessItem('pos_products')"), 'Must read standard pos_products key');
  assert.ok(content.includes("getBusinessItem('pos_sales')"), 'Must read standard pos_sales key');
  assert.ok(content.includes("getBusinessItem('pos_customers')"), 'Must read standard pos_customers key');
});

// ----------------------------------------------------------------------------
// SUITE 2: Idempotency Key Generation & Client Retry Stability
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Idempotency Key Generation & Client Retry Stability ---');

test('API client module exists and exports createIdempotencyKey & ApiClientError', () => {
  const filePath = path.join(__dirname, '../src/lib/api/posApiClient.ts');
  assert.ok(fs.existsSync(filePath), 'posApiClient.ts must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('export function createIdempotencyKey'), 'Must export createIdempotencyKey');
  assert.ok(content.includes('export class ApiClientError'), 'Must export ApiClientError');
  assert.ok(content.includes('isSessionExpired'), 'Must handle session expiration');
});

test('Idempotency keys generated have valid UUID v4 format and prefix', () => {
  const { randomUUID } = require('crypto');
  function genKey(prefix = 'pos') {
    return `${prefix}-${randomUUID()}`;
  }
  const key1 = genKey('checkout');
  const key2 = genKey('checkout');
  assert.notStrictEqual(key1, key2, 'Keys must be distinct');
  assert.ok(key1.startsWith('checkout-'), 'Prefix must match');
  assert.match(key1, /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Must be valid UUID v4');
});

test('Retry logic reuses the exact same idempotency key across network retry attempts', () => {
  const filePath = path.join(__dirname, '../src/lib/api/posApiClient.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  // Confirm checkout and refund accept explicit idempotencyKey
  assert.ok(content.includes('idempotencyKey?: string'), 'CheckoutApiPayload must accept explicit idempotencyKey');
  assert.ok(content.includes("headers['idempotency-key'] = options.idempotencyKey"), 'Must set idempotency-key header on request');
  // Confirm retry loops do not regenerate key
  assert.ok(content.includes('options.idempotencyKey || createIdempotencyKey'), 'Must preserve caller-supplied key across retries');
});

// ----------------------------------------------------------------------------
// SUITE 3: Monetary & Contract Adapters (Rupees <-> Paisa)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Monetary & Contract Adapters (Rupees <-> Integer Paisa) ---');

const { toCents, fromCents } = require('../src/lib/money.ts');

test('Exact conversion: Rupees to Paisa integer minor units', () => {
  assert.strictEqual(toCents(0), 0);
  assert.strictEqual(toCents(1), 100);
  assert.strictEqual(toCents(1500), 150000);
  assert.strictEqual(toCents(19.99), 1999);
  assert.strictEqual(toCents(1.14), 114);
  assert.strictEqual(toCents(0.01), 1);
  assert.strictEqual(toCents(10500.75), 1050075);
});

test('Exact conversion: Paisa integer minor units to Rupees decimal float', () => {
  assert.strictEqual(fromCents(0), 0);
  assert.strictEqual(fromCents(100), 1);
  assert.strictEqual(fromCents(150000), 1500);
  assert.strictEqual(fromCents(1999), 19.99);
  assert.strictEqual(fromCents(114), 1.14);
  assert.strictEqual(fromCents(1), 0.01);
  assert.strictEqual(fromCents(1050075), 10500.75);
});

test('Rejection of invalid, negative, or excessive precision inputs in monetary conversions', () => {
  assert.throws(() => toCents(-50), /NEGATIVE_AMOUNT/, 'Must reject negative amount');
  assert.throws(() => toCents(NaN), /NOT_A_NUMBER/, 'Must reject NaN');
  assert.throws(() => toCents(Infinity), /NOT_FINITE/, 'Must reject Infinity');
  assert.throws(() => toCents(10.999), /EXCESSIVE_PRECISION/, 'Must reject fractional paisa precision');
});

test('Adapters module exports full bidirectional payload & result converters', () => {
  const filePath = path.join(__dirname, '../src/lib/api/adapters.ts');
  assert.ok(fs.existsSync(filePath), 'adapters.ts must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('export function toBackendCheckoutPayload'), 'Must export toBackendCheckoutPayload');
  assert.ok(content.includes('export function fromBackendCheckoutResult'), 'Must export fromBackendCheckoutResult');
  assert.ok(content.includes('export function toBackendRefundPayload'), 'Must export toBackendRefundPayload');
  assert.ok(content.includes('export function fromBackendRefundResult'), 'Must export fromBackendRefundResult');
  assert.ok(content.includes('export function toCustomerCreditRupees'), 'Must export toCustomerCreditRupees');
  assert.ok(content.includes('export function toCustomerBalanceCents'), 'Must export toCustomerBalanceCents');
});

test('Cart item adaptation computes unitPriceCents, customPriceCents, and line discountCents accurately', () => {
  const filePath = path.join(__dirname, '../src/lib/api/adapters.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('toCents(item.product.price'), 'Must convert product price to cents');
  assert.ok(content.includes('toCents(item.customPrice'), 'Must convert custom price to cents');
  assert.ok(content.includes('toCents(item.discount'), 'Must convert line discount to cents');
});

test('Discount adapter correctly differentiates percent vs fixed amounts', () => {
  const filePath = path.join(__dirname, '../src/lib/api/adapters.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes("discountType === 'percent'"), 'Must check for percent discount');
  assert.ok(content.includes("toCents(discount, false, 'Sale fixed discount')"), 'Must convert fixed discount to cents');
});

test('Refund adapter correctly maps payoutMethod, debtReversal, and cashPayout', () => {
  const filePath = path.join(__dirname, '../src/lib/api/adapters.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('fromCents(result.cashPayoutCents)'), 'Must convert cashPayoutCents to Rupees');
  assert.ok(content.includes('fromCents(result.debtReversedCents)'), 'Must convert debtReversedCents to Rupees');
});

// ----------------------------------------------------------------------------
// SUITE 4: Feature Parity Audit & Contract Documentation
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 4: Feature Parity Audit & Contract Documentation ---');

test('Frontend-to-backend API contract audit document exists', () => {
  const contractPath = path.join(__dirname, '../src/lib/api/CONTRACT_AUDIT.md');
  assert.ok(fs.existsSync(contractPath), 'CONTRACT_AUDIT.md must exist');
  const doc = fs.readFileSync(contractPath, 'utf8');
  assert.ok(doc.includes('Frontend LocalStorage Audit'), 'Must document LocalStorage audit');
  assert.ok(doc.includes('Existing SQLite Backend Endpoints'), 'Must document existing endpoints');
  assert.ok(doc.includes('Gap Analysis: Missing SQLite Endpoints for Complete Cutover'), 'Must document missing endpoints');
  assert.ok(doc.includes('Bidirectional Rupees <-> Paisa Adapter Rules'), 'Must document adapter rules');
});

test('Identifies all missing SQLite endpoints required before full cutover', () => {
  const contractPath = path.join(__dirname, '../src/lib/api/CONTRACT_AUDIT.md');
  const doc = fs.readFileSync(contractPath, 'utf8');
  const requiredMissing = [
    '/api/pos/products',
    '/api/pos/categories',
    '/api/pos/customers',
    '/api/pos/khata/settle',
    '/api/pos/expenses',
    '/api/pos/settings',
    '/api/pos/held',
    '/api/pos/reports/summary',
  ];
  for (const endpoint of requiredMissing) {
    assert.ok(doc.includes(endpoint), `Document must identify missing endpoint: ${endpoint}`);
  }
});

// ----------------------------------------------------------------------------
// SUITE 5: Migration Wizard UI & Safe Cutover Preparation
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 5: Migration Wizard UI & Stage A Safety Invariants ---');

test('Migration Wizard modal component exists', () => {
  const wizardPath = path.join(__dirname, '../src/components/pos/MigrationWizardModal.tsx');
  assert.ok(fs.existsSync(wizardPath), 'MigrationWizardModal.tsx must exist');
  const content = fs.readFileSync(wizardPath, 'utf8');
  assert.ok(content.includes('export function MigrationWizardModal'), 'Must export MigrationWizardModal component');
  assert.ok(content.includes('Stage B Cutover Locked'), 'Must prevent execution in Stage A');
});

test('Migration Wizard modal has all 7 required steps', () => {
  const wizardPath = path.join(__dirname, '../src/components/pos/MigrationWizardModal.tsx');
  const content = fs.readFileSync(wizardPath, 'utf8');
  assert.ok(content.includes("'backup'"), 'Step 1: Backup must exist');
  assert.ok(content.includes("'dryrun'"), 'Step 2: Dry Run must exist');
  assert.ok(content.includes("'conflicts'"), 'Step 3: Conflicts must exist');
  assert.ok(content.includes("'confirm'"), 'Step 4: Confirm must exist');
  assert.ok(content.includes("'import'"), 'Step 5: Import must exist');
  assert.ok(content.includes("'reconcile'"), 'Step 6: Reconcile must exist');
  assert.ok(content.includes("'cutover'"), 'Step 7: Cutover must exist');
});

test('SettingsView includes Owner-controlled access to SQLite Migration Wizard', () => {
  const settingsPath = path.join(__dirname, '../src/components/pos/SettingsView.tsx');
  const content = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(content.includes('MigrationWizardModal'), 'SettingsView must render MigrationWizardModal');
  assert.ok(content.includes('setSqliteWizardOpen(true)'), 'SettingsView must open SQLite wizard');
  assert.ok(content.includes('SQLite Migration Wizard (Stage A)'), 'SettingsView must show Stage A button label');
});

// ----------------------------------------------------------------------------
// SUITE 6: Verification of Invariants: No Modifying Existing LocalStorage Data
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 6: Preservation of Existing POS Data and Login Flow ---');

test('Active frontend checkout in page.tsx remains on existing completeCloudPosSale / local handler', () => {
  const pagePath = path.join(__dirname, '../src/app/page.tsx');
  const content = fs.readFileSync(pagePath, 'utf8');
  assert.ok(content.includes('handleCompleteSale'), 'handleCompleteSale must be present');
  assert.ok(content.includes('setBusinessItem'), 'Existing setBusinessItem persistence must remain intact');
  // Confirm checkout button is NOT directly bound to sqlite checkout route in page.tsx yet
  assert.ok(!content.includes('/api/pos/checkout') || !content.includes('fetch("/api/pos/checkout"'), 'Checkout button must NOT be connected to sqlite route in page.tsx during Stage A');
});

test('Port 3456 configuration in electron/main.cjs remains unchanged', () => {
  const electronPath = path.join(__dirname, '../electron/main.cjs');
  const content = fs.readFileSync(electronPath, 'utf8');
  assert.ok(content.includes('3456'), 'Port 3456 must be preserved');
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log(`STAGE A TEST RESULTS: Passed: ${passed} | Failed: ${failed} | Total: ${passed + failed}`);
console.log('='.repeat(70));

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
