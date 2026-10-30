import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

import { runMigrations } from './migrations.ts';

export type SelwickEnv = 'production' | 'desktop-dev' | 'local-dev' | 'test';

export interface DatabaseContext {
  env: SelwickEnv;
  dbPath: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __selwick_db_instance__: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __selwick_db_path__: string | undefined;
  // eslint-disable-next-line no-var
  var __selwick_db_migrated__: boolean | undefined;
}

/**
 * Determines the current Selwick runtime environment.
 */
export function getSelwickEnv(): SelwickEnv {
  if (process.env.SELWICK_ENV === 'production') return 'production';
  if (process.env.SELWICK_ENV === 'desktop-dev') return 'desktop-dev';
  if (process.env.SELWICK_ENV === 'test' || process.env.NODE_ENV === 'test') return 'test';
  if (process.env.SELWICK_ENV === 'local-dev') return 'local-dev';

  if (process.env.NODE_ENV === 'production' && process.env.SELWICK_USER_DATA_PATH) {
    return 'production';
  }

  return 'local-dev';
}

/**
 * Returns true if the path points to the real packaged Windows production database.
 */
export function isProductionDatabasePath(targetPath: string): boolean {
  if (!targetPath || targetPath === ':memory:') return false;
  const normalized = path.resolve(targetPath).toLowerCase();
  
  // Production database matches ...\Selwick POS\database\selwick.db
  // It must NOT match Selwick POS Dev, test, or local-dev folders.
  const isProdName = path.basename(normalized) === 'selwick.db';
  const hasProdDir = normalized.includes('selwick pos') && !normalized.includes('selwick pos dev');

  return isProdName && hasProdDir;
}

/**
 * Resolves the deterministic, isolated database file path for the given environment.
 */
export function resolveDatabasePath(explicitEnv?: SelwickEnv): string {
  const env = explicitEnv || getSelwickEnv();

  // Test environment: use explicit test path, temporary folder, or in-memory
  if (env === 'test') {
    if (process.env.SELWICK_TEST_DB_PATH) {
      return path.resolve(process.env.SELWICK_TEST_DB_PATH);
    }
    const testDir = path.join(process.cwd(), '.data', 'test');
    fs.mkdirSync(testDir, { recursive: true });
    return path.join(testDir, `selwick-test-${process.pid}.db`);
  }

  // Packaged Production: must use userData/database/selwick.db
  if (env === 'production') {
    const userData = process.env.SELWICK_USER_DATA_PATH || 
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS') : '');
    
    if (!userData) {
      throw new Error('[DATABASE_CONFIGURATION_ERROR] Production user data path is not defined.');
    }

    const dbDir = path.join(userData, 'database');
    fs.mkdirSync(dbDir, { recursive: true });
    return path.join(dbDir, 'selwick.db');
  }

  // Desktop Development: Electron dev shell (%APPDATA%\Selwick POS Dev\database\selwick-dev.db)
  if (env === 'desktop-dev') {
    const devUserData = process.env.SELWICK_USER_DATA_PATH ||
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS Dev') : '');
    
    if (devUserData) {
      const dbDir = path.join(devUserData, 'database');
      fs.mkdirSync(dbDir, { recursive: true });
      return path.join(dbDir, 'selwick-dev.db');
    }
    // Fallback if AppData not found
    const fallbackDir = path.join(process.cwd(), '.data');
    fs.mkdirSync(fallbackDir, { recursive: true });
    return path.join(fallbackDir, 'selwick-dev.db');
  }

  // Local Web Development: project root .data folder
  const localDir = path.join(process.cwd(), '.data');
  fs.mkdirSync(localDir, { recursive: true });
  return path.join(localDir, 'selwick-local-dev.db');
}

/**
 * Validates fail-closed security guards.
 * Throws immediately if a non-production environment attempts to open a production database.
 */
export function assertDatabaseAccessPermitted(env: SelwickEnv, dbPath: string): void {
  const isProdPath = isProductionDatabasePath(dbPath);

  if (env !== 'production' && isProdPath) {
    throw new Error(
      `[DATABASE_SECURITY_ERROR] Fail-Closed Guard: Non-production environment "${env}" is strictly prohibited from opening the production database at "${dbPath}".`
    );
  }

  if (env === 'production' && (process.env.NODE_ENV === 'test' || process.env.SELWICK_ENV === 'test')) {
    throw new Error(
      `[DATABASE_SECURITY_ERROR] Fail-Closed Guard: Test runner attempted to access production database path "${dbPath}".`
    );
  }
}

/**
 * Gets or initializes the singleton SQLite database instance for the current process.
 */
export function getDatabase(explicitEnv?: SelwickEnv, explicitPath?: string): DatabaseSync {
  const env = explicitEnv || getSelwickEnv();
  const dbPath = explicitPath || resolveDatabasePath(env);

  // Security Verification Guard
  assertDatabaseAccessPermitted(env, dbPath);

  // Reuse existing instance if path matches
  if (globalThis.__selwick_db_instance__ && globalThis.__selwick_db_path__ === dbPath) {
    return globalThis.__selwick_db_instance__;
  }

  // If previous instance exists for a different path, close it safely
  if (globalThis.__selwick_db_instance__) {
    try {
      globalThis.__selwick_db_instance__.close();
    } catch {
      // ignore close errors on re-init
    }
    globalThis.__selwick_db_instance__ = undefined;
    globalThis.__selwick_db_path__ = undefined;
  }

  // Ensure directory exists if not in-memory
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
  });

  // Enable WAL mode, timeout, synchronous settings, and foreign keys
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  globalThis.__selwick_db_instance__ = db;
  globalThis.__selwick_db_path__ = dbPath;

  return db;
}

/**
 * Gets the singleton database instance and guarantees all pending migrations
 * have been executed exactly once per instance lifecycle.
 */
export function getInitializedDatabase(explicitEnv?: SelwickEnv, explicitPath?: string): DatabaseSync {
  const db = getDatabase(explicitEnv, explicitPath);
  if (!globalThis.__selwick_db_migrated__) {
    runMigrations(db);
    globalThis.__selwick_db_migrated__ = true;
  }
  return db;
}

/**
 * Closes the active database connection if open.
 */
export function closeDatabase(): void {
  if (globalThis.__selwick_db_instance__) {
    try {
      globalThis.__selwick_db_instance__.close();
    } finally {
      globalThis.__selwick_db_instance__ = undefined;
      globalThis.__selwick_db_path__ = undefined;
      globalThis.__selwick_db_migrated__ = false;
    }
  }
}
