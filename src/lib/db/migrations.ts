import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION, INITIAL_MIGRATION_NAME, INITIAL_MIGRATION_SQL } from './schema.ts';

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

export interface MigrationResult {
  appliedCount: number;
  currentVersion: number;
  migrations: MigrationRecord[];
}

/**
 * Runs all pending migrations against the provided SQLite database connection.
 * Executes atomically inside a transaction.
 */
export function runMigrations(db: DatabaseSync): MigrationResult {
  // 1. Ensure migrations ledger exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Fetch applied migrations
  const stmt = db.prepare('SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC');
  const applied = stmt.all() as MigrationRecord[];
  const appliedVersions = new Set(applied.map((m) => m.version));

  let appliedCount = 0;

  // 3. Migration 1: Foundation Schema
  if (!appliedVersions.has(1)) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(INITIAL_MIGRATION_SQL);
      
      const insertStmt = db.prepare(
        'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      );
      insertStmt.run(1, INITIAL_MIGRATION_NAME);

      db.exec('COMMIT;');
      appliedCount++;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION_FAILED] Migration 1 (${INITIAL_MIGRATION_NAME}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. Migration 2: Persistent Rate Limiting Ledger (upgrade for existing databases)
  if (!appliedVersions.has(2)) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          identity_key TEXT PRIMARY KEY,
          failed_count INTEGER NOT NULL DEFAULT 0,
          first_failed_at INTEGER NOT NULL,
          last_failed_at INTEGER NOT NULL,
          locked_until INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts(locked_until);
      `);

      const insertStmt = db.prepare(
        'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      );
      insertStmt.run(2, '002_persistent_rate_limiting');

      db.exec('COMMIT;');
      appliedCount++;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION_FAILED] Migration 2 (002_persistent_rate_limiting) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 5. Migration 3: Idempotency Keys Payload Hash & Business Scope
  if (!appliedVersions.has(3)) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const cols = db.prepare("PRAGMA table_info(idempotency_keys)").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('business_id')) {
        db.exec('ALTER TABLE idempotency_keys ADD COLUMN business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;');
      }
      if (!colNames.has('request_hash')) {
        db.exec('ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT;');
      }

      const insertStmt = db.prepare(
        'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      );
      insertStmt.run(3, '003_idempotency_key_payload_hash');

      db.exec('COMMIT;');
      appliedCount++;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION_FAILED] Migration 3 (003_idempotency_key_payload_hash) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 6. Migration 4: Business-Scoped Idempotency Composite Key & Invoice Sequences
  if (!appliedVersions.has(4)) {
    const fkState = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number } | undefined)?.foreign_keys ?? 1;
    try {
      if (fkState === 1) {
        db.exec('PRAGMA foreign_keys = OFF;');
      }
      db.exec('BEGIN IMMEDIATE;');
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS idempotency_keys_v4 (
            key TEXT NOT NULL,
            business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL,
            request_hash TEXT,
            response_code INTEGER NOT NULL,
            response_body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (business_id, key)
          );
        `);

        const oldTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'").get();
        if (oldTableExists) {
          const cols = db.prepare('PRAGMA table_info(idempotency_keys)').all() as { name: string }[];
          const hasBusinessId = cols.some((c) => c.name === 'business_id');
          // Ensure a fallback business exists for foreign key constraint safety
          db.exec("INSERT OR IGNORE INTO businesses (id, name) VALUES ('legacy-unassigned', 'Legacy Unassigned Business');");

          if (hasBusinessId) {
            db.exec(`
              INSERT OR IGNORE INTO idempotency_keys_v4 (key, business_id, endpoint, request_hash, response_code, response_body, created_at)
              SELECT key, COALESCE(business_id, (SELECT id FROM businesses WHERE id != 'legacy-unassigned' ORDER BY id ASC LIMIT 1), 'legacy-unassigned'), endpoint, request_hash, response_code, response_body, created_at
              FROM idempotency_keys
              WHERE key IS NOT NULL;
            `);
          } else {
            db.exec(`
              INSERT OR IGNORE INTO idempotency_keys_v4 (key, business_id, endpoint, request_hash, response_code, response_body, created_at)
              SELECT key, COALESCE((SELECT id FROM businesses WHERE id != 'legacy-unassigned' ORDER BY id ASC LIMIT 1), 'legacy-unassigned'), endpoint, request_hash, response_code, response_body, created_at
              FROM idempotency_keys
              WHERE key IS NOT NULL;
            `);
          }

          db.exec('DROP TABLE idempotency_keys;');
        }

        db.exec(`
          ALTER TABLE idempotency_keys_v4 RENAME TO idempotency_keys;
          CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
          CREATE INDEX IF NOT EXISTS idx_idempotency_business_key ON idempotency_keys(business_id, key);

          CREATE TABLE IF NOT EXISTS invoice_sequences (
            business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            date_str TEXT NOT NULL,
            current_seq INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (business_id, date_str)
          );

          DROP INDEX IF EXISTS idx_sales_invoice;
          DROP INDEX IF EXISTS idx_sales_idempotency;
          CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(business_id, invoice_number);
          CREATE INDEX IF NOT EXISTS idx_sales_idempotency ON sales(business_id, idempotency_key);
        `);

        // Safe migration of sales table if it was created with global single-column UNIQUE constraints
        const salesTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales'").get() as { sql: string } | undefined;
        if (salesTableSql && (salesTableSql.sql.includes('invoice_number TEXT NOT NULL UNIQUE') || salesTableSql.sql.includes('idempotency_key TEXT UNIQUE'))) {
          db.exec(`
            CREATE TABLE sales_v4 (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
              invoice_number TEXT NOT NULL,
              idempotency_key TEXT,
              timestamp TEXT NOT NULL,
              date_str TEXT NOT NULL,
              subtotal_cents INTEGER NOT NULL,
              discount_cents INTEGER NOT NULL DEFAULT 0,
              discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed', 'percent')),
              tax_cents INTEGER NOT NULL DEFAULT 0,
              total_cents INTEGER NOT NULL,
              payment_method TEXT NOT NULL,
              amount_tendered_cents INTEGER NOT NULL,
              change_due_cents INTEGER NOT NULL,
              customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
              customer_name TEXT NOT NULL,
              customer_phone TEXT,
              notes TEXT,
              terminal_id TEXT NOT NULL,
              cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
              cashier_name TEXT,
              status TEXT NOT NULL CHECK(status IN ('completed', 'refunded', 'cancelled')),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE (business_id, invoice_number),
              UNIQUE (business_id, idempotency_key)
            );

            INSERT INTO sales_v4 SELECT * FROM sales;
            DROP TABLE sales;
            ALTER TABLE sales_v4 RENAME TO sales;
            CREATE INDEX IF NOT EXISTS idx_sales_business_date ON sales(business_id, date_str);
            CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(business_id, invoice_number);
            CREATE INDEX IF NOT EXISTS idx_sales_idempotency ON sales(business_id, idempotency_key);
          `);
        }

        const insertStmt = db.prepare(
          'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
        );
        insertStmt.run(4, '004_business_scoped_idempotency_and_sequences');

        db.exec('COMMIT;');
        appliedCount++;
      } catch (error) {
        db.exec('ROLLBACK;');
        throw new Error(`[MIGRATION_FAILED] Migration 4 (004_business_scoped_idempotency_and_sequences) failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (fkState === 1) {
        db.exec('PRAGMA foreign_keys = ON;');
      }
    }

    // Referential integrity check
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (fkViolations.length > 0) {
      throw new Error(`[MIGRATION_FAILED] Migration 4 failed foreign key integrity check: ${JSON.stringify(fkViolations)}`);
    }
  }

  // 7. Migration 5: Dedicated Append-Only Refund Ledger
  if (!appliedVersions.has(5)) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS refund_ledger (
          id TEXT PRIMARY KEY,
          sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          user_name TEXT NOT NULL,
          user_role TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          payout_method TEXT NOT NULL,
          cash_payout_cents INTEGER NOT NULL DEFAULT 0,
          debt_reversal_cents INTEGER NOT NULL DEFAULT 0,
          terminal_id TEXT,
          reason TEXT NOT NULL,
          idempotency_key TEXT,
          payout_status TEXT NOT NULL CHECK(payout_status IN ('completed', 'pending_manual_reversal')),
          timestamp TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_refund_ledger_business ON refund_ledger(business_id);
        CREATE INDEX IF NOT EXISTS idx_refund_ledger_sale ON refund_ledger(sale_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_ledger_idem ON refund_ledger(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      `);

      const insertStmt = db.prepare(
        'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      );
      insertStmt.run(5, '005_refund_ledger');

      db.exec('COMMIT;');
      appliedCount++;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION_FAILED] Migration 5 (005_refund_ledger) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 8. Migration 6: Khata Credit Sales Ledger & Deterministic Settlement Allocations
  if (!appliedVersions.has(6)) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS credit_sales_ledger (
          sale_id TEXT PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          original_credit_cents INTEGER NOT NULL,
          settled_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('open', 'settled', 'refunded')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS khata_settlements (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL,
          payment_method TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS khata_settlement_allocations (
          id TEXT PRIMARY KEY,
          settlement_id TEXT NOT NULL REFERENCES khata_settlements(id) ON DELETE CASCADE,
          sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          allocated_cents INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_credit_sales_lookup ON credit_sales_ledger(business_id, customer_id, status);
        CREATE INDEX IF NOT EXISTS idx_khata_settlements_cust ON khata_settlements(business_id, customer_id);
        CREATE INDEX IF NOT EXISTS idx_allocations_sale ON khata_settlement_allocations(sale_id);
        CREATE INDEX IF NOT EXISTS idx_allocations_settlement ON khata_settlement_allocations(settlement_id);

        -- Backfill existing historical credit sales
        INSERT OR IGNORE INTO credit_sales_ledger (sale_id, business_id, customer_id, original_credit_cents, settled_cents, status, created_at, updated_at)
        SELECT
          s.id,
          s.business_id,
          s.customer_id,
          MAX(0, s.total_cents - s.amount_tendered_cents),
          0,
          CASE WHEN s.status = 'refunded' THEN 'refunded' ELSE 'open' END,
          s.timestamp,
          s.timestamp
        FROM sales s
        WHERE s.payment_method = 'credit' AND s.customer_id IS NOT NULL;
      `);

      const insertStmt = db.prepare(
        'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      );
      insertStmt.run(6, '006_khata_settlement_allocations');

      db.exec('COMMIT;');
      appliedCount++;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`[MIGRATION_FAILED] Migration 6 (006_khata_settlement_allocations) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 9. Retrieve refreshed migration status
  const refreshedStmt = db.prepare('SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC');
  const allApplied = refreshedStmt.all() as MigrationRecord[];
  const currentVersion = allApplied.length > 0 ? Math.max(...allApplied.map((m) => m.version)) : 0;

  return {
    appliedCount,
    currentVersion,
    migrations: allApplied,
  };
}

/**
 * Queries the list of currently applied migrations from the database.
 */
export function getAppliedMigrations(db: DatabaseSync): MigrationRecord[] {
  try {
    const stmt = db.prepare('SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC');
    return stmt.all() as MigrationRecord[];
  } catch {
    return [];
  }
}
