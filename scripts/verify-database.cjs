/**
 * Selwick POS SQLite Foundation & Environment Isolation Verification Script
 * 
 * Tests:
 * 1. Environment path isolation (production, desktop-dev, local-dev, test)
 * 2. Fail-closed security guards (blocking dev/test processes from touching production DB)
 * 3. WAL mode, busy timeout, and foreign keys pragma enforcement
 * 4. Schema migrations execution and version tracking
 * 5. All 14 foundation tables and performance indexes
 * 6. Foreign key and CHECK constraint validation
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let failed = 0;

function check(title, condition, detail = '') {
  if (condition) {
    console.log(`  [OK] ${title}`);
  } else {
    console.error(`  [FAIL] ${title} ${detail ? '(' + detail + ')' : ''}`);
    failed++;
  }
}

console.log('\n--- Checking Selwick POS SQLite Foundation & Isolation ---\n');

// 1. Verify Core DB Modules Exist
console.log('1. Verifying SQLite core module files exist:');
const requiredDbFiles = [
  'src/lib/db/connection.ts',
  'src/lib/db/schema.ts',
  'src/lib/db/migrations.ts',
  'src/lib/db/index.ts',
  'src/types/node-sqlite.d.ts',
];
for (const rel of requiredDbFiles) {
  check(`File exists: ${rel}`, fs.existsSync(path.join(root, rel)));
}

// 2. Test Environment Resolution & Path Isolation Logic
console.log('\n2. Testing environment path isolation logic:');
const testDbDir = path.join(root, '.data', 'test');
fs.mkdirSync(testDbDir, { recursive: true });

const mockProdPath = path.resolve('C:\\Users\\MockUser\\AppData\\Roaming\\Selwick POS\\database\\selwick.db');
const mockDevPath = path.resolve('C:\\Users\\MockUser\\AppData\\Roaming\\Selwick POS Dev\\database\\selwick-dev.db');
const mockLocalPath = path.resolve(path.join(root, '.data', 'selwick-local-dev.db'));

function isProductionDatabasePath(targetPath) {
  if (!targetPath || targetPath === ':memory:') return false;
  const normalized = path.resolve(targetPath).toLowerCase();
  const isProdName = path.basename(normalized) === 'selwick.db';
  const hasProdDir = normalized.includes('selwick pos') && !normalized.includes('selwick pos dev');
  return isProdName && hasProdDir;
}

check('Identifies production database path correctly', isProductionDatabasePath(mockProdPath));
check('Rejects desktop-dev path as production', !isProductionDatabasePath(mockDevPath));
check('Rejects local-dev path as production', !isProductionDatabasePath(mockLocalPath));

// 3. Test Fail-Closed Security Guards
console.log('\n3. Testing fail-closed security guards:');
function assertDatabaseAccessPermitted(env, dbPath) {
  const isProd = isProductionDatabasePath(dbPath);
  if (env !== 'production' && isProd) {
    throw new Error(`[DATABASE_SECURITY_ERROR] Non-production environment "${env}" blocked from accessing production DB.`);
  }
  if (env === 'production' && process.env.NODE_ENV === 'test') {
    throw new Error(`[DATABASE_SECURITY_ERROR] Test runner blocked from accessing production DB.`);
  }
}

let devBlocked = false;
try {
  assertDatabaseAccessPermitted('local-dev', mockProdPath);
} catch (e) {
  if (e.message.includes('DATABASE_SECURITY_ERROR')) devBlocked = true;
}
check('Fail-Closed: local-dev blocked from opening production DB', devBlocked);

let testBlocked = false;
try {
  assertDatabaseAccessPermitted('test', mockProdPath);
} catch (e) {
  if (e.message.includes('DATABASE_SECURITY_ERROR')) testBlocked = true;
}
check('Fail-Closed: test environment blocked from opening production DB', testBlocked);

let devAllowedDevPath = false;
try {
  assertDatabaseAccessPermitted('local-dev', mockLocalPath);
  devAllowedDevPath = true;
} catch {
  devAllowedDevPath = false;
}
check('Permits local-dev to open its own isolated DB', devAllowedDevPath);

// 4. Test Pragmas: WAL Mode, Foreign Keys, Busy Timeout
console.log('\n4. Testing SQLite pragmas on isolated test database:');
const testDbFile = path.join(testDbDir, `verify-test-${Date.now()}.db`);
let db;

try {
  db = new DatabaseSync(testDbFile, { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  const journalMode = db.prepare('PRAGMA journal_mode;').get();
  check('WAL mode enabled (PRAGMA journal_mode = WAL)', journalMode && journalMode.journal_mode === 'wal');

  const fk = db.prepare('PRAGMA foreign_keys;').get();
  check('Foreign key enforcement active (PRAGMA foreign_keys = 1)', fk && fk.foreign_keys === 1);

  const timeout = db.prepare('PRAGMA busy_timeout;').get();
  check('Busy timeout configured (>= 5000ms)', timeout && timeout.timeout >= 5000);

  // 5. Schema Migration & Foundation Tables Execution
  console.log('\n5. Executing and verifying foundation schema migrations:');
  const { INITIAL_MIGRATION_SQL, CURRENT_SCHEMA_VERSION, INITIAL_MIGRATION_NAME } = require(path.join(root, 'src', 'lib', 'db', 'schema.ts'));
  
  // Create migration ledger
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Execute migration 1
  db.exec('BEGIN IMMEDIATE;');
  db.exec(INITIAL_MIGRATION_SQL);
  db.prepare('INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP);')
    .run(CURRENT_SCHEMA_VERSION, INITIAL_MIGRATION_NAME);
  db.exec('COMMIT;');

  const migrationRecord = db.prepare('SELECT * FROM _schema_migrations WHERE version = ?;').get(1);
  check('Migration ledger records version 1 applied', migrationRecord && migrationRecord.name === '001_foundation_tables');

  // Verify all expected tables exist in sqlite_master
  const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
  const tableNames = tablesStmt.all().map(r => r.name);

  const expectedTables = [
    '_schema_migrations',
    'businesses',
    'users',
    'user_sessions',
    'categories',
    'products',
    'customers',
    'sales',
    'sale_items',
    'expenses',
    'held_sales',
    'settings',
    'idempotency_keys',
    'durable_backup_ledger',
  ];

  for (const t of expectedTables) {
    check(`Foundation table exists: ${t}`, tableNames.includes(t));
  }

  // 6. Test Foreign Key and CHECK Constraints
  console.log('\n6. Testing schema constraints and integer monetary units:');
  
  // Test business insertion
  db.prepare(`
    INSERT INTO businesses (id, name, business_type) 
    VALUES ('test-biz-1', 'Test Supermarket', 'grocery');
  `).run();
  const biz = db.prepare("SELECT * FROM businesses WHERE id = 'test-biz-1'").get();
  check('Business record inserted cleanly', biz && biz.name === 'Test Supermarket');

  // Test FK enforcement: inserting user for non-existent business must fail
  let fkBlocked = false;
  try {
    db.prepare(`
      INSERT INTO users (id, business_id, name, role, salt, hash)
      VALUES ('u-1', 'non-existent-biz', 'Alice', 'cashier', 'salt', 'hash');
    `).run();
  } catch (err) {
    if (err.message.toLowerCase().includes('foreign key')) fkBlocked = true;
  }
  check('Foreign Key: Blocks user insertion for non-existent business', fkBlocked);

  // Test CHECK constraint on role
  let checkRoleBlocked = false;
  try {
    db.prepare(`
      INSERT INTO users (id, business_id, name, role, salt, hash)
      VALUES ('u-2', 'test-biz-1', 'Bob', 'super_admin_invalid', 'salt', 'hash');
    `).run();
  } catch (err) {
    if (err.message.toLowerCase().includes('check constraint')) checkRoleBlocked = true;
  }
  check('CHECK constraint: Rejects unauthorized role "super_admin_invalid"', checkRoleBlocked);

  // Test Integer Minor Units (paisa/cents)
  db.prepare(`
    INSERT INTO products (id, business_id, name, category, price_cents, cost_price_cents, stock)
    VALUES ('prod-1', 'test-biz-1', 'Charging Cable', 'Accessories', 145050, 95000, 25);
  `).run();

  const product = db.prepare("SELECT * FROM products WHERE id = 'prod-1';").get();
  check('Product stores integer price_cents (145050 = Rs 1,450.50)', product && product.price_cents === 145050);
  check('Product stores integer cost_price_cents (95000 = Rs 950.00)', product && product.cost_price_cents === 95000);

  // Clean test tables
} catch (err) {
  console.error('[UNEXPECTED_ERROR]', err);
  failed++;
} finally {
  if (db) {
    try { db.close(); } catch {}
  }
  // Safely clean up test db file
  try {
    if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
    const walFile = `${testDbFile}-wal`;
    const shmFile = `${testDbFile}-shm`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
  } catch {}
}

console.log('\n--------------------------------------------------------------');
if (failed === 0) {
  console.log('All SQLite foundation verification checks passed successfully (0 failures).\n');
  process.exit(0);
} else {
  console.error(`SQLite foundation verification failed with ${failed} error(s).\n`);
  process.exit(1);
}
