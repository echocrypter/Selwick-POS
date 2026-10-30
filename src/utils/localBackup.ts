'use client';
import {getBusinessItem,setBusinessItem,removeBusinessItem,activeOfflineBusiness} from '@/lib/offlineBusinessStorage';

const BACKUP_KEYS = [
  'pos_products',
  'pos_customers',
  'pos_sales',
  'pos_settings',
  'pos_held',
  'pos_categories',
  'pos_expenses',
] as const;

const LEGACY_BACKUP_KEYS = BACKUP_KEYS.filter((key) => key !== 'pos_categories' && key !== 'pos_expenses');
const V2_BACKUP_KEYS = BACKUP_KEYS.filter((key) => key !== 'pos_expenses');
const DB_NAME = 'pos-local-backup';
const STORE_NAME = 'folder-handles';
const FOLDER_KEY = 'backup-folder';
const LAST_BACKUP_KEY = 'pos_backup_last_success';
const LAST_BACKUP_DATE_KEY = 'pos_backup_last_date';
const BACKUP_TIME_KEY = 'pos_backup_schedule_time';
const BACKUP_VERSION = 3;
const DEFAULT_BACKUP_TIME = '18:30';

type BackupSource = 'manual' | 'scheduled' | 'catch-up';
type FolderHandle = FileSystemDirectoryHandle;
type FileSystemWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FolderHandle>;
};

export type PosBackupData = {
  app: 'pos-app';
  version: number;
  createdAt: string;
  timeZone: string;
  source?: BackupSource;
  data: Record<string, unknown>;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeFolderHandle(handle: FolderHandle): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(handle, FOLDER_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function getSavedFolderHandle(): Promise<FolderHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDatabase();
  try {
    return await new Promise<FolderHandle | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME).get(FOLDER_KEY);
      request.onsuccess = () => resolve((request.result as FolderHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function hasWritePermission(handle: FolderHandle, askUser: boolean): Promise<boolean> {
  const permissionHandle = handle as FolderHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };

  const options = { mode: 'readwrite' as const };
  let permission: PermissionState = permissionHandle.queryPermission
    ? await permissionHandle.queryPermission(options)
    : 'prompt';

  if (permission !== 'granted' && askUser && permissionHandle.requestPermission) {
    permission = await permissionHandle.requestPermission(options);
  }
  return permission === 'granted';
}

export async function chooseBackupFolder(): Promise<string> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    throw new Error('Folder selection requires HTTPS or localhost in a supported browser.');
  }
  const picker = (window as FileSystemWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error('Folder selection is not supported by this browser. Use current Chrome or Edge.');
  }
  const handle = await picker({ mode: 'readwrite' });
  if (!(await hasWritePermission(handle, true))) {
    throw new Error('Write permission was not granted for that folder.');
  }
  await storeFolderHandle(handle);
  return handle.name;
}

export function collectPosData(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of BACKUP_KEYS) {
    const raw = getBusinessItem(key);
    try {
      data[key] = raw === null ? null : JSON.parse(raw);
    } catch {
      throw new Error(`Cannot back up ${key}: saved data is not valid JSON.`);
    }
  }
  return data;
}

function getLocalDateTime(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

// Retained for compatibility with the existing scheduler until it is updated.
export function getPakistanDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getBackupDate(): string {
  return getLocalDateTime().date;
}

export function getBackupScheduleTime(): string {
  if (typeof window === 'undefined') return DEFAULT_BACKUP_TIME;
  const saved = localStorage.getItem(BACKUP_TIME_KEY);
  return saved && /^([01]\d|2[0-3]):[0-5]\d$/.test(saved)
    ? saved
    : DEFAULT_BACKUP_TIME;
}

export function setBackupScheduleTime(time: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Choose a valid backup time in HH:mm format.');
  }
  localStorage.setItem(BACKUP_TIME_KEY, time);
}

export function isDailyBackupDue(): boolean {
  const now = getLocalDateTime();
  const [hour, minute] = getBackupScheduleTime().split(':').map(Number);
  return now.hour * 60 + now.minute >= hour * 60 + minute;
}

export function getLastBackupInfo(): { date: string | null; timestamp: string | null } {
  if (typeof window === 'undefined') return { date: null, timestamp: null };
  return {
    date: localStorage.getItem(LAST_BACKUP_DATE_KEY),
    timestamp: localStorage.getItem(LAST_BACKUP_KEY),
  };
}

export async function createLocalBackup(
  source: BackupSource,
  askForPermission = false,
): Promise<string> {
  const handle = await getSavedFolderHandle();
  if (!handle) throw new Error('Choose a backup folder in POS Settings first.');
  if (!(await hasWritePermission(handle, askForPermission))) {
    throw new Error('Folder access is not granted. Open POS Settings and choose the backup folder again.');
  }

  const now = new Date();
  const dateTime = getLocalDateTime(now);
  const backup: PosBackupData = {
    app: 'pos-app',
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    source,
    data: collectPosData(),
  };
  validateBackup(backup);

  // Milliseconds and a random suffix prevent manual and scheduled backups from overwriting each other.
  const time = `${String(dateTime.hour).padStart(2, '0')}${String(dateTime.minute).padStart(2, '0')}${String(dateTime.second).padStart(2, '0')}`;
  const unique = `${String(now.getMilliseconds()).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `pos-backup-${(activeOfflineBusiness()||"unknown").slice(0,12)}-${dateTime.date}-${time}-${unique}.json`;
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Preserve original write error. */ }
    throw error;
  }

  // Manual backups should not suppress today's scheduled backup.
  if (source !== 'manual') {
    localStorage.setItem(LAST_BACKUP_DATE_KEY, dateTime.date);
  }
  localStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  return filename;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateBackup(value: unknown): PosBackupData {
  if (!isPlainObject(value) || value.app !== 'pos-app' ||
      (value.version !== 1 && value.version !== 2 && value.version !== BACKUP_VERSION) ||
      !isPlainObject(value.data) ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Unsupported or invalid POS backup file.');
  }

  const data = value.data;
  const requiredKeys = value.version === 1 ? LEGACY_BACKUP_KEYS : value.version === 2 ? V2_BACKUP_KEYS : BACKUP_KEYS;
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`Backup is missing required data: ${key}`);
    }
  }

  for (const key of BACKUP_KEYS) {
    if (!(key in data)) continue; // Older v1 backups did not contain categories.
    const item = data[key];
    if (item === undefined) throw new Error(`Invalid backup data: ${key}`);
    if (key === 'pos_settings') {
      if (item !== null && !isPlainObject(item)) {
        throw new Error('Invalid settings in backup.');
      }
    } else if (item !== null && !Array.isArray(item)) {
      throw new Error(`Invalid backup data: ${key} must be an array.`);
    }
    if (key === 'pos_categories' && Array.isArray(item) &&
        !item.every((category) => typeof category === 'string')) {
      throw new Error('Invalid categories in backup.');
    }
    if (item !== null) {
      const serialized = JSON.stringify(item);
      if (serialized === undefined) throw new Error(`Cannot serialize backup data: ${key}`);
    }
  }

  return value as PosBackupData;
}

export function restorePosBackup(input: PosBackupData): void {
  const backup = validateBackup(input);
  const keysToRestore = BACKUP_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(backup.data, key),
  );
  const entries = keysToRestore.map((key) => {
    const value = backup.data[key];
    return [key, value === null ? null : JSON.stringify(value)] as const;
  });
  const previous = new Map<string, string | null>();
  for (const key of keysToRestore) previous.set(key, getBusinessItem(key));

  try {
    for (const [key, value] of entries) {
      if (value === null) removeBusinessItem(key);
      else setBusinessItem(key, value);
    }
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) removeBusinessItem(key);
        else setBusinessItem(key, value);
      } catch { /* Storage restrictions can prevent rollback. */ }
    }
    throw error;
  }
}

export function getBackupScheduleDescription(): string {
  const [hour, minute] = getBackupScheduleTime().split(':').map(Number);
  const hour12 = hour % 12 || 12;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `Every day at ${hour12}:${String(minute).padStart(2, '0')} ${period} (device local time)`;
}
export async function hasBackupFolderPermission(): Promise<boolean> {
  const handle = await getSavedFolderHandle();
  if (!handle) return false;
  return hasWritePermission(handle, false);
}

export async function requestBackupFolderPermission(): Promise<boolean> {
  const handle = await getSavedFolderHandle();
  if (!handle) return false;
  return hasWritePermission(handle, true);
}

// Compatibility aliases for callers that use alternate recovery-flow names.
export const grantBackupFolderPermission = requestBackupFolderPermission;
export const ensureBackupFolderPermission = requestBackupFolderPermission;

