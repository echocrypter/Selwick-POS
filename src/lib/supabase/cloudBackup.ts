import { getSupabaseClient } from '@/lib/supabase/client';
import {
  getActiveBusinessId,
  triggerCloudPosSync,
  type CloudPosRecord,
  type PosRecordType,
} from '@/lib/supabase/posSync';

const BACKUP_BUCKET = 'pos-backups';
const PAGE_SIZE = 500;
const MAX_RECORDS = 100_000;
const RESTORE_BATCH_SIZE = 500;
const RECORD_TYPES: readonly PosRecordType[] = [
  'product', 'customer', 'sale', 'setting', 'held_sale', 'category', 'refund', 'khata_settlement',
];

export interface CloudPosBackup {
  app: 'pos-app';
  format: 'selwick-cloud-pos-backup';
  version: 1;
  createdAt: string;
  businessId: string;
  recordCount: number;
  records: CloudPosRecord[];
}

export interface CloudBackupUploadResult {
  path: string;
  filename: string;
  recordCount: number;
  createdAt: string;
}

export interface CloudBackupFile {
  filename: string;
  path: string;
  createdAt: string | null;
  sizeBytes: number | null;
}

export interface CloudBackupRestoreProgress {
  currentBatch: number;
  totalBatches: number;
  processedRecords: number;
  totalRecords: number;
  recoveredCount: number;
}

export interface CloudBackupRestoreResult {
  recoveredCount: number;
  totalRecords: number;
  batchesCount: number;
  businessId: string;
}

/**
 * Rigorously validate backup format, version, business ID, record count,
 * record types, IDs, timestamps, and duplicate keys before allowing restoration.
 */
export function validateCloudPosBackup(
  data: unknown,
  expectedBusinessId: string,
): { valid: true; backup: CloudPosBackup } | { valid: false; error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Backup is not a valid JSON object.' };
  }

  const candidate = data as Partial<CloudPosBackup>;

  if (candidate.app !== 'pos-app') {
    return { valid: false, error: 'Invalid application identifier in backup (expected "pos-app").' };
  }

  if (candidate.format !== 'selwick-cloud-pos-backup') {
    return { valid: false, error: 'Invalid backup format (expected "selwick-cloud-pos-backup").' };
  }

  if (candidate.version !== 1) {
    return { valid: false, error: `Unsupported backup version: ${String(candidate.version)}.` };
  }

  if (typeof candidate.businessId !== 'string' || !candidate.businessId.trim()) {
    return { valid: false, error: 'Backup business ID is missing or invalid.' };
  }

  if (candidate.businessId !== expectedBusinessId) {
    return {
      valid: false,
      error: `Backup business ID (${candidate.businessId}) does not match the active cloud business (${expectedBusinessId}).`,
    };
  }

  if (
    typeof candidate.createdAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.createdAt))
  ) {
    return { valid: false, error: 'Backup createdAt timestamp is missing or invalid.' };
  }

  if (
    typeof candidate.recordCount !== 'number' ||
    !Number.isInteger(candidate.recordCount) ||
    candidate.recordCount < 0
  ) {
    return { valid: false, error: 'Backup recordCount is not a valid non-negative integer.' };
  }

  if (!Array.isArray(candidate.records)) {
    return { valid: false, error: 'Backup records property is not an array.' };
  }

  if (candidate.records.length !== candidate.recordCount) {
    return {
      valid: false,
      error: `Record count mismatch: metadata specifies ${candidate.recordCount} records, but array contains ${candidate.records.length}.`,
    };
  }

  if (candidate.records.length > MAX_RECORDS) {
    return {
      valid: false,
      error: `Backup exceeds maximum supported records limit (${MAX_RECORDS}).`,
    };
  }

  const seenKeys = new Set<string>();

  for (let i = 0; i < candidate.records.length; i++) {
    const record = candidate.records[i];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { valid: false, error: `Record at index ${i} is not a valid object.` };
    }

    if (!RECORD_TYPES.includes(record.record_type)) {
      return {
        valid: false,
        error: `Record at index ${i} has unsupported type: "${String(record.record_type)}".`,
      };
    }

    if (typeof record.record_id !== 'string' || !record.record_id.trim()) {
      return { valid: false, error: `Record at index ${i} has an empty or invalid record ID.` };
    }

    if (record.data === undefined || record.data === null) {
      return {
        valid: false,
        error: `Record at index ${i} (${record.record_type}/${record.record_id}) has no data payload.`,
      };
    }

    if (
      typeof record.updated_at !== 'string' ||
      Number.isNaN(Date.parse(record.updated_at))
    ) {
      return {
        valid: false,
        error: `Record at index ${i} (${record.record_type}/${record.record_id}) has an invalid updated_at timestamp.`,
      };
    }

    const uniqueKey = `${record.record_type}:${record.record_id}`;
    if (seenKeys.has(uniqueKey)) {
      return {
        valid: false,
        error: `Duplicate record detected in backup: ${uniqueKey}. Each record must have a unique type and ID combination.`,
      };
    }
    seenKeys.add(uniqueKey);
  }

  return { valid: true, backup: data as CloudPosBackup };
}

/**
 * Confirm the signed-in user can access backups for the currently selected business.
 * Storage RLS independently enforces this restriction on every request.
 */
async function requireBackupAccess() {
  if (typeof window === 'undefined') {
    throw new Error('Cloud backups can only be accessed from the POS browser.');
  }

  const client = getSupabaseClient();
  if (!client) throw new Error('Connect your Supabase project in Settings > Cloud Sync first.');

  const businessId = getActiveBusinessId();
  if (!businessId) throw new Error('Select a cloud business before accessing backups.');

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in before accessing cloud backups.');

  const { data: membership, error: membershipError } = await client
    .from('business_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.role !== 'owner' && membership?.role !== 'manager') {
    throw new Error('Only business owners and managers can access cloud backups.');
  }

  return { client, businessId, user };
}

/**
 * Create a private JSON snapshot of the currently selected cloud business.
 * Requires an authenticated owner or manager and Storage RLS policies.
 * This does not modify the live POS records.
 */
export async function uploadCloudPosBackup(): Promise<CloudBackupUploadResult> {
  if (typeof window === 'undefined') {
    throw new Error('Cloud backups can only be started from the POS browser.');
  }

  const { client, businessId } = await requireBackupAccess();

  const records: CloudPosRecord[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from('pos_records')
      .select('record_type, record_id, data, updated_at')
      .eq('business_id', businessId)
      .order('record_type', { ascending: true })
      .order('record_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const batch = (data ?? []) as CloudPosRecord[];
    if (batch.length === 0) break;

    for (const record of batch) {
      if (
        !RECORD_TYPES.includes(record.record_type) ||
        typeof record.record_id !== 'string' ||
        !record.record_id ||
        typeof record.updated_at !== 'string'
      ) {
        throw new Error('Cloud records contain an unsupported or invalid entry. Backup cancelled.');
      }
    }

    records.push(...batch);
    if (records.length > MAX_RECORDS) {
      throw new Error('Backup exceeds the supported record limit. Contact support before retrying.');
    }
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
  }

  // Do not upload a potentially incomplete backup if the selected business changes.
  if (getActiveBusinessId() !== businessId) {
    throw new Error('The selected business changed while preparing the backup. Please retry.');
  }

  const createdAt = new Date().toISOString();
  const backup: CloudPosBackup = {
    app: 'pos-app',
    format: 'selwick-cloud-pos-backup',
    version: 1,
    createdAt,
    businessId,
    recordCount: records.length,
    records,
  };

  const filename = `pos-cloud-backup-${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
  const path = `${businessId}/${filename}`;
  const payload = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });

  const { error: uploadError } = await client.storage
    .from(BACKUP_BUCKET)
    .upload(path, payload, {
      contentType: 'application/json',
      cacheControl: 'no-store',
      upsert: false,
    });

  if (uploadError) throw uploadError;
  return { path, filename, recordCount: records.length, createdAt };
}

/** List JSON backups belonging to the active business (newest first). */
export async function listCloudPosBackups(): Promise<CloudBackupFile[]> {
  const { client, businessId } = await requireBackupAccess();
  const files: CloudBackupFile[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await client.storage.from(BACKUP_BUCKET).list(businessId, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (error) throw error;

    const batch = data ?? [];
    for (const item of batch) {
      if (!item.name.startsWith('pos-cloud-backup-') || !item.name.endsWith('.json') || !item.id) {
        continue;
      }
      files.push({
        filename: item.name,
        path: `${businessId}/${item.name}`,
        createdAt: item.created_at ?? null,
        sizeBytes: typeof item.metadata?.size === 'number' ? item.metadata.size : null,
      });
    }

    if (batch.length < limit) break;
    offset += batch.length;
  }

  if (getActiveBusinessId() !== businessId) {
    throw new Error('The selected business changed while loading backups. Please retry.');
  }

  return files.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Download and parse a JSON backup into memory with full validation.
 * Verifies business identity, roles, schema, timestamps, and absence of duplicate keys.
 */
export async function fetchCloudPosBackup(filename: string): Promise<CloudPosBackup> {
  const { client, businessId } = await requireBackupAccess();

  // Accept only a single filename, never an arbitrary Storage path.
  if (
    !/^pos-cloud-backup-[a-zA-Z0-9-]+\.json$/.test(filename) ||
    filename.includes('..')
  ) {
    throw new Error('Invalid backup filename.');
  }

  const { data, error } = await client.storage
    .from(BACKUP_BUCKET)
    .download(`${businessId}/${filename}`);
  if (error) throw error;
  if (!data) throw new Error('Supabase returned an empty backup download.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await data.text());
  } catch {
    throw new Error('The downloaded backup is not valid JSON.');
  }

  const validation = validateCloudPosBackup(parsed, businessId);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (getActiveBusinessId() !== businessId) {
    throw new Error('The selected business changed during download. Please retry.');
  }

  return validation.backup;
}

/**
 * Download a previously uploaded JSON backup for the active business.
 * Validates integrity and triggers a browser file download without modifying live POS data.
 */
export async function downloadCloudPosBackup(filename: string): Promise<void> {
  const backup = await fetchCloudPosBackup(filename);

  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  }));
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Delay revocation to allow the browser to initiate the download.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

/**
 * Safely restores missing records from a verified backup into the active business's pos_records table.
 * Uses a secure PostgreSQL RPC with atomic transaction and conflict-safe ON CONFLICT DO NOTHING.
 * Existing records, sales, stock levels, and store settings are never overwritten or deleted.
 * After restoration, triggers immediate application cloud data synchronization.
 */
export async function restoreCloudPosBackup(
  backup: CloudPosBackup,
  onProgress?: (progress: CloudBackupRestoreProgress) => void,
): Promise<CloudBackupRestoreResult> {
  const { client, businessId } = await requireBackupAccess();

  if (backup.businessId !== businessId) {
    throw new Error(
      `Backup business ID (${backup.businessId}) does not match current active business (${businessId}).`,
    );
  }

  const validation = validateCloudPosBackup(backup, businessId);
  if (!validation.valid) {
    throw new Error(`Cannot restore invalid backup: ${validation.error}`);
  }

  if (backup.records.length === 0) {
    return {
      recoveredCount: 0,
      totalRecords: 0,
      batchesCount: 0,
      businessId,
    };
  }

  // Chunk records into batches for progress feedback and safe payload limits
  const batches: CloudPosRecord[][] = [];
  for (let i = 0; i < backup.records.length; i += RESTORE_BATCH_SIZE) {
    batches.push(backup.records.slice(i, i + RESTORE_BATCH_SIZE));
  }

  let totalRecovered = 0;
  let processedRecords = 0;

  for (let i = 0; i < batches.length; i++) {
    if (getActiveBusinessId() !== businessId) {
      throw new Error('The selected business changed during restoration. Aborted.');
    }

    const batch = batches[i];
    const { data, error } = await client.rpc('restore_pos_backup_records', {
      p_business_id: businessId,
      p_records: batch,
    });

    if (error) {
      throw new Error(
        error.message || `Database error while restoring batch ${i + 1} of ${batches.length}.`,
      );
    }

    const result = data as {
      success?: boolean;
      recovered_count?: number;
      evaluated_count?: number;
    } | null;

    if (!result || result.success !== true) {
      throw new Error(`Restoration failed to complete for batch ${i + 1} of ${batches.length}.`);
    }

    const recoveredInBatch = typeof result.recovered_count === 'number' ? result.recovered_count : 0;
    totalRecovered += recoveredInBatch;
    processedRecords += batch.length;

    onProgress?.({
      currentBatch: i + 1,
      totalBatches: batches.length,
      processedRecords,
      totalRecords: backup.records.length,
      recoveredCount: totalRecovered,
    });
  }

  // Refresh POS cloud data across the application using the synchronization mechanism
  triggerCloudPosSync();

  return {
    recoveredCount: totalRecovered,
    totalRecords: backup.records.length,
    batchesCount: batches.length,
    businessId,
  };
}
