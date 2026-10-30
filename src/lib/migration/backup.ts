/**
 * Selwick POS – Durable File-System Backup Engine & SHA-256 Ledger.
 *
 * Persists complete LocalStorage states to the durable server filesystem
 * with cryptographic SHA-256 integrity verification and ledger tracking.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { getSelwickEnv } from '../db/connection.ts';
import { safeCompare } from '../auth/crypto.ts';
import {
  type BackupLedgerEntry,
  type BackupIntegrityResult,
} from './types.ts';

export class BackupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[BackupError:${code}] ${message}`);
    this.name = 'BackupError';
    this.code = code;
  }
}

/**
 * Resolves the deterministic, isolated backup directory for the current environment.
 */
export function getBackupDirectory(): string {
  if (process.env.SELWICK_BACKUP_PATH) {
    const customPath = path.resolve(process.env.SELWICK_BACKUP_PATH);
    fs.mkdirSync(customPath, { recursive: true });
    return customPath;
  }

  const env = getSelwickEnv();

  if (env === 'test') {
    const testDir = path.join(process.cwd(), '.data', 'test', 'backups');
    fs.mkdirSync(testDir, { recursive: true });
    return testDir;
  }

  if (env === 'production') {
    const userData = process.env.SELWICK_USER_DATA_PATH ||
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS') : '');
    if (!userData) {
      throw new BackupError('ENV_ERROR', 'Production user data path is not defined for backups.');
    }
    const backupDir = path.join(userData, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    return backupDir;
  }

  if (env === 'desktop-dev') {
    const devUserData = process.env.SELWICK_USER_DATA_PATH ||
      (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Selwick POS Dev') : '');
    if (devUserData) {
      const backupDir = path.join(devUserData, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      return backupDir;
    }
  }

  // Local-dev fallback in .data/backups
  const localDir = path.join(process.cwd(), '.data', 'backups');
  fs.mkdirSync(localDir, { recursive: true });
  return localDir;
}

/**
 * Validates and sanitizes a backup filename against path traversal.
 */
export function sanitizeBackupFilename(rawFilename: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    throw new BackupError('INVALID_FILENAME', 'Backup filename must be a non-empty string.');
  }

  // Reject any null bytes, slashes, or backslashes
  if (rawFilename.includes('\0') || rawFilename.includes('/') || rawFilename.includes('\\') || rawFilename.includes('..')) {
    throw new BackupError('PATH_TRAVERSAL_DETECTED', `Filename contains illegal characters or path traversal: "${rawFilename}".`);
  }

  // Disallow drive letters or special symbols
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(rawFilename)) {
    throw new BackupError('INVALID_FILENAME', `Filename contains disallowed characters: "${rawFilename}".`);
  }

  if (!rawFilename.endsWith('.json')) {
    throw new BackupError('INVALID_FILENAME', 'Backup file must have a .json extension.');
  }

  return path.basename(rawFilename);
}

/**
 * Computes the SHA-256 hex digest of a UTF-8 string or buffer.
 */
export function calculateSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Counts the total records contained within a raw LocalStorage key-value backup.
 */
export function countRecordsInPayload(payloadData: Record<string, string>): number {
  let count = 0;
  for (const [key, value] of Object.entries(payloadData)) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        count += parsed.length;
      } else if (parsed !== null && typeof parsed === 'object') {
        count += 1;
      } else {
        count += 1;
      }
    } catch {
      // Non-JSON string value counts as 1 key-record
      if (key) count += 1;
    }
  }
  return count;
}

export interface CreateBackupResult {
  backupId: string;
  businessId: string;
  filename: string;
  filePath: string;
  sha256: string;
  totalRecords: number;
  createdAt: string;
}

/**
 * Exports and writes a durable LocalStorage backup to the filesystem with SHA-256 verification,
 * logging the event in SQLite `durable_backup_ledger`.
 */
export function createDurableBackup(
  db: DatabaseSync,
  businessId: string,
  rawPayload: unknown,
): CreateBackupResult {
  if (!businessId || typeof businessId !== 'string') {
    throw new BackupError('INVALID_BUSINESS_ID', 'A valid business ID is required for durable backup.');
  }

  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new BackupError('INVALID_PAYLOAD', 'Backup payload must be a non-empty object.');
  }

  // Format canonical JSON string
  const jsonContent = JSON.stringify(rawPayload, null, 2);
  const sha256 = calculateSha256(jsonContent);

  // Extract records count
  let totalRecords = 0;
  const payloadObj = rawPayload as Record<string, unknown>;
  if (payloadObj.format === 'selwick-localstorage-v1' && typeof payloadObj.data === 'object' && payloadObj.data !== null) {
    totalRecords = countRecordsInPayload(payloadObj.data as Record<string, string>);
  } else if (typeof payloadObj.data === 'object' && payloadObj.data !== null) {
    totalRecords = countRecordsInPayload(payloadObj.data as Record<string, string>);
  } else {
    totalRecords = countRecordsInPayload(rawPayload as Record<string, string>);
  }

  const backupDir = getBackupDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeBusinessSlug = businessId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
  const shortHash = sha256.slice(0, 8);
  const filename = `selwick-backup-${safeBusinessSlug}-${timestamp}-${shortHash}.json`;
  const sanitizedFilename = sanitizeBackupFilename(filename);
  const filePath = path.join(/*turbopackIgnore: true*/ backupDir, sanitizedFilename);

  // Write file atomically (temp file then rename)
  const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, jsonContent, 'utf8');

    // Immediate read-back and SHA-256 verification
    const readBack = fs.readFileSync(tempPath, 'utf8');
    const readHash = calculateSha256(readBack);
    if (!safeCompare(sha256, readHash)) {
      throw new BackupError('WRITE_INTEGRITY_MISMATCH', 'File readback SHA-256 hash did not match written content.');
    }

    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup error */ }
    }
    throw err;
  }

  // Log in SQLite durable_backup_ledger
  const backupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO durable_backup_ledger (
      id, business_id, filename, sha256_hash, total_records, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(backupId, businessId, sanitizedFilename, sha256, totalRecords, createdAt);

  return {
    backupId,
    businessId,
    filename: sanitizedFilename,
    filePath,
    sha256,
    totalRecords,
    createdAt,
  };
}

/**
 * Reads a backup file by filename from the secure backup directory.
 */
export function readBackupFile(filename: string): { content: string; filePath: string; sha256: string } {
  const sanitized = sanitizeBackupFilename(filename);
  const backupDir = getBackupDirectory();
  const filePath = path.join(/*turbopackIgnore: true*/ backupDir, sanitized);

  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    throw new BackupError('FILE_NOT_FOUND', `Backup file "${sanitized}" does not exist in backup directory.`);
  }

  const content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, 'utf8');
  const sha256 = calculateSha256(content);
  return { content, filePath, sha256 };
}

/**
 * Verifies the integrity of a backup file against the SQLite ledger or expected SHA-256.
 */
export function verifyBackupIntegrity(
  db: DatabaseSync,
  identifier: { backupId?: string; filename?: string },
): BackupIntegrityResult {
  let ledgerEntry: BackupLedgerEntry | undefined;

  if (identifier.backupId) {
    const stmt = db.prepare(`
      SELECT id, business_id, filename, sha256_hash, total_records, created_at
      FROM durable_backup_ledger
      WHERE id = ?
    `);
    ledgerEntry = stmt.get(identifier.backupId) as BackupLedgerEntry | undefined;
  } else if (identifier.filename) {
    const sanitized = sanitizeBackupFilename(identifier.filename);
    const stmt = db.prepare(`
      SELECT id, business_id, filename, sha256_hash, total_records, created_at
      FROM durable_backup_ledger
      WHERE filename = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    ledgerEntry = stmt.get(sanitized) as BackupLedgerEntry | undefined;
  }

  const filename = ledgerEntry ? ledgerEntry.filename : (identifier.filename ? sanitizeBackupFilename(identifier.filename) : '');
  if (!filename) {
    throw new BackupError('NOT_FOUND', 'Could not find backup ledger entry for the given identifier.');
  }

  const backupDir = getBackupDirectory();
  const filePath = path.join(/*turbopackIgnore: true*/ backupDir, filename);

  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    return {
      verified: false,
      backupId: ledgerEntry?.id,
      businessId: ledgerEntry?.business_id,
      filename,
      filePath,
      expectedSha256: ledgerEntry?.sha256_hash,
      actualSha256: '',
      error: 'File does not exist on filesystem.',
    };
  }

  const content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, 'utf8');
  const actualSha256 = calculateSha256(content);
  const expectedSha256 = ledgerEntry ? ledgerEntry.sha256_hash : actualSha256;
  const verified = safeCompare(actualSha256, expectedSha256);

  return {
    verified,
    backupId: ledgerEntry?.id,
    businessId: ledgerEntry?.business_id,
    filename,
    filePath,
    expectedSha256: ledgerEntry?.sha256_hash,
    actualSha256,
    totalRecords: ledgerEntry?.total_records,
    error: verified ? undefined : 'SHA-256 hash mismatch: file may have been modified or corrupted.',
  };
}
