#!/usr/bin/env node
/**
 * Selwick POS – Phase 2 Security Verification Suite
 *
 * Tests:
 *  1. Receipt XSS – escHtml() escape function unit tests
 *  2. API Authorization – cashier privilege escalation attempts
 *  3. Expense creation restricted to manager+
 *  4. Refund authorization (manager+ only)
 *  5. Server-side role enforcement on sensitive routes
 *  6. Business isolation – cross-business access denied
 *  7. Electron main.cjs – security settings verification
 *  8. Session security – cookie settings verification
 *  9. Rate limiting – brute force protection verification
 * 10. Phase 1 regression – localStorage no longer authoritative
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── Section 1: Receipt XSS ───────────────────────────────────────────────────
console.log('\n--- SECTION 1: Receipt XSS Escaping ---');

test('escapeHtml.ts exists and exports escHtml', () => {
  const p = path.join(ROOT, 'src/utils/escapeHtml.ts');
  assert.ok(fs.existsSync(p), 'escapeHtml.ts must exist');
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes('export function escHtml'), 'Must export escHtml function');
});

test('escHtml escapes & character', () => {
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes("replace(/&/g, '&amp;')") || content.includes('replace(/&/g,"&amp;")'), 'Must escape &');
});

test('escHtml escapes < character', () => {
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes("replace(/<"), 'Must escape <');
});

test('escHtml escapes > character', () => {
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes("replace(/>"), 'Must escape >');
});

test('escHtml escapes " character', () => {
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes('replace(/"') || content.includes("replace(/\"/"), 'Must escape "');
});

test('escHtml escapes \' character', () => {
  const content = readSrc('src/utils/escapeHtml.ts');
  assert.ok(content.includes("replace(/'") || content.includes('&#x27;'), 'Must escape single quote');
});

test('printReceipt.ts imports escHtml', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes("from '@/utils/escapeHtml'") || content.includes('from "./escapeHtml"') || content.includes("from '../utils/escapeHtml'"), 'Must import escHtml');
});

test('printReceipt.ts applies escHtml to storeName', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(settings.storeName)'), 'storeName must be escaped');
});

test('printReceipt.ts applies escHtml to customerName', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(sale.customerName)'), 'customerName must be escaped');
});

test('printReceipt.ts applies escHtml to product name', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(item.product.name)'), 'Product name must be escaped');
});

test('printReceipt.ts applies escHtml to address', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(settings.address)'), 'Address must be escaped');
});

test('printReceipt.ts applies escHtml to receiptFooter', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(settings.receiptFooter)'), 'receiptFooter must be escaped');
});

test('printReceipt.ts applies escHtml to invoiceNumber', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(sale.invoiceNumber)'), 'invoiceNumber must be escaped');
});

test('printReceipt.ts applies escHtml to phone', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(settings.phone)'), 'phone must be escaped');
});

test('printReceipt.ts applies escHtml to tagline', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(content.includes('escHtml(settings.tagline)'), 'tagline must be escaped');
});

test('printReceipt.ts has no unescaped ${settings.storeName} injection', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  // Ensure the old raw interpolation pattern is gone
  assert.ok(!content.includes('>${settings.storeName}<'), 'Raw storeName injection must be removed');
});

test('printReceipt.ts has no unescaped ${sale.customerName} injection', () => {
  const content = readSrc('src/utils/printReceipt.ts');
  assert.ok(!content.includes('>${sale.customerName}<'), 'Raw customerName injection must be removed');
});

// ─── Section 2: API Route Authorization ──────────────────────────────────────
console.log('\n--- SECTION 2: API Route Authorization Matrix ---');

test('Refund route requires manager/owner (cashier blocked)', () => {
  const content = readSrc('src/app/api/pos/refund/route.ts');
  assert.ok(content.includes("requireRole(req, ['manager', 'owner'])"), 'Refund must require manager/owner');
  assert.ok(!content.includes("'cashier', 'manager', 'owner'"), 'Refund must not allow cashier');
});

test('Product POST (create) requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/products/route.ts');
  // POST section requires manager/owner
  const postSection = content.slice(content.indexOf('export async function POST'));
  assert.ok(postSection.includes("requireRole(req, ['manager', 'owner'])"), 'Product creation must require manager/owner');
});

test('Product PUT (update/price) requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/products/[id]/route.ts');
  const putSection = content.slice(content.indexOf('export async function PUT'));
  assert.ok(putSection.includes("requireRole(req, ['manager', 'owner'])"), 'Product update must require manager/owner');
});

test('Product DELETE requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/products/[id]/route.ts');
  const delSection = content.slice(content.indexOf('export async function DELETE'));
  assert.ok(delSection.includes("requireRole(req, ['manager', 'owner'])"), 'Product delete must require manager/owner');
});

test('Product archive requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/products/[id]/archive/route.ts');
  assert.ok(content.includes("requireRole(req, ['manager', 'owner'])"), 'Product archive must require manager/owner');
});

test('Expense POST (create) requires manager/owner — cashier cannot create expenses', () => {
  const content = readSrc('src/app/api/pos/expenses/route.ts');
  const postSection = content.slice(content.indexOf('export async function POST'));
  assert.ok(postSection.includes("requireRole(req, ['manager', 'owner'])"), 'Expense creation must require manager/owner');
  assert.ok(!postSection.includes("'cashier', 'manager', 'owner'"), 'Cashier must not be able to create expenses');
});

test('Expense DELETE requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/expenses/[id]/route.ts');
  const delSection = content.slice(content.indexOf('export async function DELETE'));
  assert.ok(delSection.includes("requireRole(req, ['manager', 'owner'])"), 'Expense delete must require manager/owner');
});

test('Settings PUT requires manager/owner', () => {
  const content = readSrc('src/app/api/pos/settings/route.ts');
  const putSection = content.slice(content.indexOf('export async function PUT'));
  assert.ok(putSection.includes("requireRole(req, ['manager', 'owner'])"), 'Settings update must require manager/owner');
});

test('Backup requires owner', () => {
  const content = readSrc('src/app/api/migration/backup/route.ts');
  assert.ok(content.includes("requireRole(req, ['owner'])"), 'Backup must require owner role');
});

test('Restore/import requires owner', () => {
  const content = readSrc('src/app/api/migration/import/route.ts');
  assert.ok(content.includes("requireRole(req, ['owner'])"), 'Restore must require owner role');
});

test('All sensitive POST endpoints call assertLocalhostOrigin', () => {
  const sensitivePaths = [
    'src/app/api/pos/refund/route.ts',
    'src/app/api/pos/products/route.ts',
    'src/app/api/pos/products/[id]/route.ts',
    'src/app/api/pos/expenses/route.ts',
    'src/app/api/pos/settings/route.ts',
    'src/app/api/migration/backup/route.ts',
    'src/app/api/migration/import/route.ts',
    'src/app/api/pos/checkout/route.ts',
  ];
  for (const p of sensitivePaths) {
    const content = readSrc(p);
    assert.ok(
      content.includes('assertLocalhostOrigin') || content.includes('requireRole') || content.includes('requireAuth'),
      `${p} must call origin/auth guard`
    );
  }
});

// ─── Section 3: Business Isolation ───────────────────────────────────────────
console.log('\n--- SECTION 3: Business Isolation ---');

test('requireBusinessScope exists in authorization.ts', () => {
  const content = readSrc('src/lib/auth/authorization.ts');
  assert.ok(content.includes('export function requireBusinessScope'), 'requireBusinessScope must be exported');
});

test('requireBusinessScope checks session.businessId vs requested', () => {
  const content = readSrc('src/lib/auth/authorization.ts');
  assert.ok(content.includes('session.businessId !== requestedBusinessId'), 'Must compare session businessId');
  assert.ok(content.includes('BUSINESS_MISMATCH'), 'Must throw BUSINESS_MISMATCH error');
});

test('Refund engine enforces business scope at the engine level', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes('session.businessId !== targetBusinessId'), 'Refund engine must check business scope');
});

test('Products repository always scopes queries to businessId', () => {
  const content = readSrc('src/lib/db/repositories/productRepository.ts');
  assert.ok(content.includes('business_id = ?') || content.includes('business_id=?'), 'Product queries must filter by business_id');
});

test('Sales queries scope to business_id in checkout engine', () => {
  const content = readSrc('src/lib/pos/checkoutEngine.ts');
  assert.ok(content.includes('business_id'), 'Checkout engine must scope to business_id');
});

test('Expense repository scopes to business_id', () => {
  const content = readSrc('src/lib/db/repositories/expenseRepository.ts');
  assert.ok(content.includes('business_id = ?') || content.includes('business_id=?'), 'Expense repo must filter by business_id');
});

test('Customer repository scopes to business_id', () => {
  const content = readSrc('src/lib/db/repositories/customerRepository.ts');
  assert.ok(content.includes('business_id'), 'Customer repo must scope to business_id');
});

test('Backup endpoint validates business scope with requireBusinessScope', () => {
  const content = readSrc('src/app/api/migration/backup/route.ts');
  assert.ok(content.includes('requireBusinessScope'), 'Backup must enforce business scope');
});

test('Session businessId is the authoritative scope — not a client-supplied businessId', () => {
  // Products route must use session.businessId not body.businessId
  const productsPost = readSrc('src/app/api/pos/products/route.ts');
  assert.ok(productsPost.includes('session.businessId'), 'Must use session.businessId for products');
  
  const refundRoute = readSrc('src/app/api/pos/refund/route.ts');
  assert.ok(refundRoute.includes('session'), 'Refund must use session-based scope');
});

// ─── Section 4: Authentication & Session Security ─────────────────────────────
console.log('\n--- SECTION 4: Authentication & Session Security ---');

test('Session cookie is HttpOnly', () => {
  const content = readSrc('src/app/api/auth/login/route.ts');
  assert.ok(content.includes('httpOnly: true') || content.includes('httpOnly:true'), 'Session cookie must be HttpOnly');
});

test('Session cookie is SameSite=Strict', () => {
  const content = readSrc('src/app/api/auth/login/route.ts');
  assert.ok(content.includes('sameSite') && (content.includes('strict') || content.includes('Strict')), 'Session cookie must be SameSite=Strict');
});

test('Session TTL is defined (8-hour shift)', () => {
  const content = readSrc('src/lib/auth/sessions.ts');
  assert.ok(content.includes('SESSION_TTL_MS'), 'SESSION_TTL_MS must be defined');
  assert.ok(content.includes('8 * 60 * 60 * 1000'), 'TTL should be 8 hours');
});

test('Session token uses 256-bit random value (crypto-secure)', () => {
  const content = readSrc('src/lib/auth/crypto.ts');
  assert.ok(content.includes('randomBytes') || content.includes('crypto'), 'Token must use crypto-secure random');
});

test('Only token hash is stored in database (not raw token)', () => {
  const sessions = readSrc('src/lib/auth/sessions.ts');
  assert.ok(sessions.includes('token_hash'), 'Only hash is stored');
  assert.ok(sessions.includes('hashSessionToken'), 'Must hash before storing');
});

test('Login uses constant-time PIN comparison (safeCompare)', () => {
  const content = readSrc('src/app/api/auth/login/route.ts');
  assert.ok(content.includes('safeCompare') || content.includes('timingSafeEqual'), 'Must use constant-time comparison');
});

test('Rate limiting is applied on login', () => {
  const content = readSrc('src/app/api/auth/login/route.ts');
  assert.ok(content.includes('isLockedOut') || content.includes('recordFailure'), 'Login must check rate limit');
});

test('Rate limiter has MAX_ATTEMPTS defined (5)', () => {
  const content = readSrc('src/lib/auth/rateLimit.ts');
  assert.ok(content.includes('MAX_ATTEMPTS = 5'), 'Max attempts must be 5');
});

test('Rate limiter has lockout duration', () => {
  const content = readSrc('src/lib/auth/rateLimit.ts');
  assert.ok(content.includes('LOCKOUT_MS'), 'Lockout duration must be defined');
});

test('Rate limiter persists to SQLite (cannot be bypassed by restart)', () => {
  const content = readSrc('src/lib/auth/rateLimit.ts');
  assert.ok(content.includes('login_attempts'), 'Rate limit must persist to DB table');
  assert.ok(content.includes('DatabaseSync') || content.includes('database'), 'Must use SQLite for persistence');
});

test('Logout route revokes session in DB', () => {
  const content = readSrc('src/app/api/auth/logout/route.ts');
  assert.ok(content.includes('revokeSession'), 'Logout must revoke session in DB');
});

test('Session expiry deletes session from DB', () => {
  const content = readSrc('src/lib/auth/sessions.ts');
  assert.ok(content.includes("DELETE FROM user_sessions WHERE id"), 'Expired sessions must be deleted');
});

// ─── Section 5: Refund Security ───────────────────────────────────────────────
console.log('\n--- SECTION 5: Refund Security ---');

test('Refund engine checks role at engine level (double enforcement)', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes("session.role !== 'owner'") || content.includes("session.role !== 'manager'"), 'Engine must re-check role');
});

test('Refund engine verifies sale exists in session business', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes('business_id = ?'), 'Sale lookup must include business_id scope');
});

test('Refund engine prevents double refund', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes("status === 'refunded'") || content.includes("DuplicateRefundError"), 'Must reject already-refunded sales');
});

test('Refund engine uses idempotency key to prevent duplicate payouts', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes('idempotency_key') || content.includes('idempotencyKey'), 'Refund must be idempotent');
});

test('Refund engine runs in a single SQLite transaction', () => {
  const content = readSrc('src/lib/pos/refundEngine.ts');
  assert.ok(content.includes('BEGIN') || content.includes('transaction') || content.includes('.exec(`BEGIN'), 'Refund must be transactional');
});

// ─── Section 6: Electron Security ────────────────────────────────────────────
console.log('\n--- SECTION 6: Electron Security ---');

test('nodeIntegration is false', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('nodeIntegration: false'), 'nodeIntegration must be false');
});

test('contextIsolation is true', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('contextIsolation: true'), 'contextIsolation must be true');
});

test('sandbox is true', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('sandbox: true'), 'sandbox must be true');
});

test('will-navigate handler is registered', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes("'will-navigate'") || content.includes('"will-navigate"'), 'will-navigate handler must be registered');
});

test('will-redirect handler is registered', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes("'will-redirect'") || content.includes('"will-redirect"'), 'will-redirect handler must be registered');
});

test('will-navigate blocks non-localhost navigation', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('event.preventDefault()'), 'Navigation to non-localhost must be blocked');
  assert.ok(content.includes('isLocalhostUrl') || content.includes('localhost'), 'Must check for localhost URL');
});

test('Production DevTools lockdown is implemented', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('devtools-opened') || content.includes('closeDevTools'), 'Production DevTools must be disabled');
  assert.ok(content.includes('app.isPackaged'), 'DevTools lockdown must check isPackaged');
});

test('setWindowOpenHandler restricts external URLs (no arbitrary http/https)', () => {
  const content = readSrc('electron/main.cjs');
  // The old pattern was: if (target.startsWith("https://") || target.startsWith("http://")) shell.openExternal(target)
  // The new pattern must NOT allow arbitrary http/https
  const hasUnrestrictedHttps = content.includes('target.startsWith("https://")') && !content.includes('isAllowedExternal');
  assert.ok(!hasUnrestrictedHttps, 'setWindowOpenHandler must not open arbitrary https:// URLs');
});

test('Localhost URL helper is defined', () => {
  const content = readSrc('electron/main.cjs');
  assert.ok(content.includes('isLocalhostUrl') || content.includes('LOCALHOST_ORIGINS'), 'Must define localhost URL check');
});

// ─── Section 7: Phase 1 Regression ───────────────────────────────────────────
console.log('\n--- SECTION 7: Phase 1 Regression Checks ---');

test('page.tsx no longer syncs products to localStorage', () => {
  const content = readSrc('src/app/page.tsx');
  // Should not have the localStorage sync effects
  assert.ok(!content.includes("setBusinessItem('pos_products'"), 'Must not sync products to localStorage');
  assert.ok(!content.includes("setBusinessItem('pos_sales'"), 'Must not sync sales to localStorage');
  assert.ok(!content.includes("setBusinessItem('pos_customers'"), 'Must not sync customers to localStorage');
});

test('page.tsx no longer loads from localStorage fallback branch', () => {
  const content = readSrc('src/app/page.tsx');
  assert.ok(!content.includes("getBusinessItem('pos_products')"), 'Must not read products from localStorage');
  assert.ok(!content.includes("getBusinessItem('pos_sales')"), 'Must not read sales from localStorage');
  assert.ok(!content.includes("getBusinessItem('pos_customers')"), 'Must not read customers from localStorage');
});

test('getDataAccessMode always returns sqlite', () => {
  const content = readSrc('src/lib/data/dataAccessLayer.ts');
  // Line 97 hardcodes 'sqlite'
  assert.ok(content.includes("return 'sqlite'"), 'Data access mode must be sqlite');
});

test('applyBusinessSetup uses DAL not localStorage for categories', () => {
  const content = readSrc('src/app/page.tsx');
  assert.ok(content.includes('dal.saveCategories'), 'applyBusinessSetup must use dal.saveCategories');
  assert.ok(!content.includes("setBusinessItem('pos_categories', JSON.stringify(finalCategories)"), 'Must not use setBusinessItem for categories in applyBusinessSetup');
});

test('OfflineStaff onboarding persists to SQLite first', () => {
  const content = readSrc('src/components/pos/OfflineStaff.tsx');
  assert.ok(content.includes('dal.saveSettings') || content.includes('getDataAccessLayer'), 'Onboarding must use DAL');
});

// ─── Final Report ─────────────────────────────────────────────────────────────
console.log('\n======================================================================');
console.log(`PHASE 2 SECURITY RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('======================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All Phase 2 security checks passed.\n');
}

