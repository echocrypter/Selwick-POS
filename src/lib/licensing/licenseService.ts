/**
 * Selwick POS — License Server Business Engine (Phase 6).
 *
 * Implements authoritative license issuance, device limits, activation,
 * deactivation, renewal, and cryptographic payload signing.
 */

import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  type LicenseRecord,
  type ActivationRecord,
  type LicenseAuditRecord,
  type SignedLicensePayload,
  type LicensePlan,
  type LicenseStatus,
  type FeatureFlag,
  type LicenseDashboardMetrics,
  type LicenseDetailRecord,
} from './types.ts';
import {
  generateLicenseKey,
  signLicensePayload,
} from './keys.ts';

export class LicenseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(`[LicenseError:${code}] ${message}`);
    this.name = 'LicenseError';
    this.code = code;
    this.status = status;
  }
}

export interface CreateLicenseParams {
  customerName: string;
  email: string;
  plan: LicensePlan;
  maxDevices?: number;
  features?: FeatureFlag[];
  durationDays?: number; // Ignored if plan is 'lifetime'
  expiresAt?: string | null; // Explicit admin override
  paymentReference?: string | null;
  paymentProvider?: string | null;
  paymentStatus?: 'unpaid' | 'paid' | 'refunded' | 'waived' | null;
  notes?: string | null;
  actor?: string;
}

export interface ListLicensesOptions {
  search?: string;
  status?: LicenseStatus | 'all';
  plan?: LicensePlan | 'all';
  sortBy?: 'created_at' | 'expires_at' | 'customer_name';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Standard feature sets per plan tier.
 */
export function getDefaultFeaturesForPlan(plan: LicensePlan): FeatureFlag[] {
  switch (plan) {
    case 'trial':
      return ['inventory', 'khata', 'advanced_reports'];
    case 'monthly':
    case 'yearly':
      return ['inventory', 'khata', 'advanced_reports', 'multi_user', 'cloud_backup'];
    case 'lifetime':
      return ['inventory', 'khata', 'advanced_reports', 'multi_user', 'cloud_backup'];
  }
}

/**
 * Creates a new commercial license with a cryptographically random key.
 */
export function createLicense(db: DatabaseSync, params: CreateLicenseParams): LicenseRecord {
  if (!params.customerName?.trim()) {
    throw new LicenseError('INVALID_INPUT', 'Customer name is required.');
  }
  if (!params.email?.trim()) {
    throw new LicenseError('INVALID_INPUT', 'Customer email is required.');
  }

  const id = crypto.randomUUID();
  const planPrefix = params.plan === 'lifetime' ? 'LIFE' : params.plan === 'yearly' ? 'YEAR' : params.plan === 'monthly' ? 'MTH' : 'TRL';
  const licenseKey = generateLicenseKey('SELW', planPrefix);
  const now = new Date();
  const issuedAt = now.toISOString();

  let expiresAt: string | null = null;
  if (params.expiresAt !== undefined) {
    expiresAt = params.expiresAt;
  } else if (params.plan === 'trial') {
    const d = new Date(now);
    d.setDate(d.getDate() + (params.durationDays || 14));
    expiresAt = d.toISOString();
  } else if (params.plan === 'monthly') {
    const d = new Date(now);
    d.setDate(d.getDate() + (params.durationDays || 30));
    expiresAt = d.toISOString();
  } else if (params.plan === 'yearly') {
    const d = new Date(now);
    d.setDate(d.getDate() + (params.durationDays || 365));
    expiresAt = d.toISOString();
  } else if (params.plan === 'lifetime') {
    expiresAt = null; // No expiry for lifetime licenses
  }

  const features = params.features || getDefaultFeaturesForPlan(params.plan);
  const maxDevices = params.maxDevices !== undefined && params.maxDevices > 0 ? params.maxDevices : 1;
  const actor = params.actor || 'admin';

  const insert = db.prepare(`
    INSERT INTO licenses (
      id, license_key, customer_name, email, plan, max_devices, status, features,
      issued_at, expires_at, payment_reference, payment_provider, payment_status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    id,
    licenseKey,
    params.customerName.trim(),
    params.email.trim().toLowerCase(),
    params.plan,
    maxDevices,
    JSON.stringify(features),
    issuedAt,
    expiresAt,
    params.paymentReference || null,
    params.paymentProvider || null,
    params.paymentStatus || null,
    params.notes || null,
    issuedAt,
    issuedAt
  );

  // Record audit log
  db.prepare(`
    INSERT INTO license_audit_logs (id, license_id, action, actor, details)
    VALUES (?, ?, 'create_license', ?, ?)
  `).run(
    crypto.randomUUID(),
    id,
    actor,
    JSON.stringify({
      plan: params.plan,
      customerName: params.customerName.trim(),
      maxDevices,
      expiresAt,
      paymentStatus: params.paymentStatus || null,
    })
  );

  return {
    id,
    licenseKey,
    customerName: params.customerName.trim(),
    email: params.email.trim().toLowerCase(),
    plan: params.plan,
    maxDevices,
    status: 'active',
    features,
    issuedAt,
    expiresAt,
    paymentReference: params.paymentReference || null,
    paymentProvider: params.paymentProvider || null,
    paymentStatus: params.paymentStatus || null,
    notes: params.notes || null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

/**
 * Activates a device for a given license key.
 * Enforces status checks and device limits. Returns an Ed25519-signed payload.
 */
export function activateLicense(
  db: DatabaseSync,
  licenseKey: string,
  deviceId: string,
  deviceName: string = 'Terminal',
  privateKeyPem: string,
  ipAddress?: string
): { signedPayload: SignedLicensePayload; signature: string } {
  if (!licenseKey?.trim()) {
    throw new LicenseError('INVALID_KEY', 'License key is required.');
  }
  if (!deviceId?.trim()) {
    throw new LicenseError('INVALID_DEVICE', 'Device identifier is required.');
  }

  const cleanKey = licenseKey.trim().toUpperCase();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const row = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(cleanKey) as any;
    if (!row) {
      throw new LicenseError('LICENSE_NOT_FOUND', 'The provided license key is invalid or does not exist.', 404);
    }

    // 1. Check License Status
    if (row.status === 'revoked') {
      throw new LicenseError('LICENSE_REVOKED', 'This license has been revoked. Contact support.', 403);
    }
    if (row.status === 'suspended') {
      throw new LicenseError('LICENSE_SUSPENDED', 'This license is temporarily suspended.', 403);
    }

    // 2. Check Expiration
    const now = new Date();
    if (row.expires_at) {
      const expDate = new Date(row.expires_at);
      if (now > expDate) {
        db.prepare("UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?").run(now.toISOString(), row.id);
        throw new LicenseError('LICENSE_EXPIRED', `This license expired on ${expDate.toLocaleDateString()}. Please renew.`, 403);
      }
    }

    // 3. Check Device Limit & Activation Record
    const existingActivation = db.prepare(`
      SELECT * FROM activations WHERE license_id = ? AND device_id = ?
    `).get(row.id, deviceId) as any;

    if (existingActivation) {
      // Re-activating existing device
      db.prepare(`
        UPDATE activations
        SET status = 'active', device_name = ?, last_seen_at = ?, ip_address = ?
        WHERE id = ?
      `).run(deviceName, now.toISOString(), ipAddress || null, existingActivation.id);
    } else {
      // New device: count active devices
      const rowCount = db.prepare(`
        SELECT COUNT(*) as c FROM activations WHERE license_id = ? AND status = 'active'
      `).get(row.id) as { c: number } | undefined;
      const activeCount = Number(rowCount?.c || 0);

      if (activeCount >= row.max_devices) {
        throw new LicenseError(
          'DEVICE_LIMIT_REACHED',
          `License device limit reached (${activeCount} / ${row.max_devices} devices active). Deactivate a device to activate this machine.`,
          403
        );
      }

      // Record new activation
      db.prepare(`
        INSERT INTO activations (id, license_id, device_id, device_name, activated_at, last_seen_at, status, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(crypto.randomUUID(), row.id, deviceId, deviceName, now.toISOString(), now.toISOString(), ipAddress || null);
    }

    // 4. Construct and Sign Canonical Payload
    const signedPayload: SignedLicensePayload = {
      licenseId: row.id,
      licenseKey: row.license_key,
      customerName: row.customer_name,
      plan: row.plan as LicensePlan,
      maxDevices: row.max_devices,
      deviceId,
      features: JSON.parse(row.features) as FeatureFlag[],
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      serverTimestamp: now.toISOString(),
    };

    const signature = signLicensePayload(signedPayload, privateKeyPem);

    // Audit log
    db.prepare(`
      INSERT INTO license_audit_logs (id, license_id, action, details)
      VALUES (?, ?, 'activate_device', ?)
    `).run(crypto.randomUUID(), row.id, JSON.stringify({ deviceId, deviceName, ipAddress }));

    db.exec('COMMIT;');
    return { signedPayload, signature };
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }
}

/**
 * Verifies and refreshes an online device heartbeat.
 */
export function verifyLicense(
  db: DatabaseSync,
  licenseKey: string,
  deviceId: string,
  privateKeyPem: string,
  ipAddress?: string
): { signedPayload: SignedLicensePayload; signature: string; status: LicenseStatus } {
  const result = activateLicense(db, licenseKey, deviceId, undefined, privateKeyPem, ipAddress);
  return {
    ...result,
    status: 'active',
  };
}

/**
 * Deactivates a device, freeing up the device slot for the license.
 */
export function deactivateDevice(
  db: DatabaseSync,
  licenseId: string,
  deviceId: string,
  actor: string = 'admin'
): boolean {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const res = db.prepare(`
      UPDATE activations SET status = 'deactivated', last_seen_at = CURRENT_TIMESTAMP
      WHERE license_id = ? AND device_id = ?
    `).run(licenseId, deviceId);

    db.prepare(`
      INSERT INTO license_audit_logs (id, license_id, action, actor, details)
      VALUES (?, ?, 'deactivate_device', ?, ?)
    `).run(crypto.randomUUID(), licenseId, actor, JSON.stringify({ deviceId }));

    db.exec('COMMIT;');
    return res.changes > 0;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }
}

/**
 * Deactivates a device by activation record ID.
 */
export function deactivateActivationById(
  db: DatabaseSync,
  activationId: string,
  actor: string = 'admin'
): boolean {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const act = db.prepare('SELECT * FROM activations WHERE id = ?').get(activationId) as any;
    if (!act) {
      throw new LicenseError('ACTIVATION_NOT_FOUND', 'Activation record not found.', 404);
    }

    db.prepare(`
      UPDATE activations SET status = 'deactivated', last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(activationId);

    db.prepare(`
      INSERT INTO license_audit_logs (id, license_id, action, actor, details)
      VALUES (?, ?, 'deactivate_device', ?, ?)
    `).run(
      crypto.randomUUID(),
      act.license_id,
      actor,
      JSON.stringify({ activationId, deviceId: act.device_id, deviceName: act.device_name })
    );

    db.exec('COMMIT;');
    return true;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }
}

/**
 * Admin action: Renew or extend license expiration.
 * Extends from existing valid expiration if license is still active.
 */
export function renewLicense(
  db: DatabaseSync,
  licenseId: string,
  explicitExpiresAt?: string | null,
  actor: string = 'admin'
): { expiresAt: string | null } {
  const lic = getLicenseById(db, licenseId);
  if (!lic) {
    throw new LicenseError('LICENSE_NOT_FOUND', 'License not found.', 404);
  }

  let newExpiresAt: string | null = null;
  const now = new Date();

  if (explicitExpiresAt !== undefined) {
    newExpiresAt = explicitExpiresAt;
  } else if (lic.plan === 'lifetime') {
    newExpiresAt = null;
  } else {
    // If current expiry is in the future, extend from that date
    let baseDate = now;
    if (lic.expiresAt) {
      const currentExp = new Date(lic.expiresAt);
      if (currentExp > now) {
        baseDate = currentExp;
      }
    }

    const d = new Date(baseDate);
    if (lic.plan === 'monthly') {
      d.setDate(d.getDate() + 30);
    } else if (lic.plan === 'yearly') {
      d.setDate(d.getDate() + 365);
    } else if (lic.plan === 'trial') {
      d.setDate(d.getDate() + 14);
    }
    newExpiresAt = d.toISOString();
  }

  db.prepare(`
    UPDATE licenses
    SET expires_at = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newExpiresAt, licenseId);

  db.prepare(`
    INSERT INTO license_audit_logs (id, license_id, action, actor, details)
    VALUES (?, ?, 'renew_license', ?, ?)
  `).run(
    crypto.randomUUID(),
    licenseId,
    actor,
    JSON.stringify({ previousExpiresAt: lic.expiresAt, newExpiresAt })
  );

  return { expiresAt: newExpiresAt };
}

/**
 * Admin action: Suspend, Revoke, or Reactivate a license.
 */
export function setLicenseStatus(
  db: DatabaseSync,
  licenseId: string,
  status: LicenseStatus,
  actor: string = 'admin'
): void {
  const lic = getLicenseById(db, licenseId);
  if (!lic) {
    throw new LicenseError('LICENSE_NOT_FOUND', 'License not found.', 404);
  }

  db.prepare(`
    UPDATE licenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, licenseId);

  db.prepare(`
    INSERT INTO license_audit_logs (id, license_id, action, actor, details)
    VALUES (?, ?, 'set_status', ?, ?)
  `).run(
    crypto.randomUUID(),
    licenseId,
    actor,
    JSON.stringify({ previousStatus: lic.status, newStatus: status })
  );
}

/**
 * Admin action: Change allowed device limits.
 */
export function setMaxDevices(
  db: DatabaseSync,
  licenseId: string,
  maxDevices: number,
  actor: string = 'admin'
): void {
  if (maxDevices < 1) throw new LicenseError('INVALID_INPUT', 'Max devices must be at least 1.');
  
  db.prepare(`
    UPDATE licenses SET max_devices = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(maxDevices, licenseId);

  db.prepare(`
    INSERT INTO license_audit_logs (id, license_id, action, actor, details)
    VALUES (?, ?, 'set_max_devices', ?, ?)
  `).run(
    crypto.randomUUID(),
    licenseId,
    actor,
    JSON.stringify({ maxDevices })
  );
}

/**
 * Lists all licenses with rich search, status/plan filtering, and sorting.
 */
export function listLicenses(
  db: DatabaseSync,
  options?: string | ListLicensesOptions
): Array<LicenseRecord & { activeDevices: number }> {
  let query = `
    SELECT l.*,
           (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.status = 'active') as active_devices
    FROM licenses l
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  const opts: ListLicensesOptions = typeof options === 'string'
    ? { search: options }
    : options || {};

  if (opts.search?.trim()) {
    conditions.push(`(l.license_key LIKE ? OR l.customer_name LIKE ? OR l.email LIKE ?)`);
    const s = `%${opts.search.trim()}%`;
    params.push(s, s, s);
  }

  if (opts.status && opts.status !== 'all') {
    conditions.push(`l.status = ?`);
    params.push(opts.status);
  }

  if (opts.plan && opts.plan !== 'all') {
    conditions.push(`l.plan = ?`);
    params.push(opts.plan);
  }

  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }

  const sortCol = opts.sortBy === 'expires_at'
    ? 'l.expires_at'
    : opts.sortBy === 'customer_name'
    ? 'l.customer_name'
    : 'l.created_at';
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    licenseKey: r.license_key,
    customerName: r.customer_name,
    email: r.email,
    plan: r.plan as LicensePlan,
    maxDevices: r.max_devices,
    status: r.status as LicenseStatus,
    features: JSON.parse(r.features),
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    paymentReference: r.payment_reference || null,
    paymentProvider: r.payment_provider || null,
    paymentStatus: r.payment_status || null,
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    activeDevices: Number(r.active_devices || 0),
  }));
}

export function getLicenseByKey(db: DatabaseSync, licenseKey: string): LicenseRecord | null {
  const r = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey.trim().toUpperCase()) as any;
  if (!r) return null;
  return {
    id: r.id,
    licenseKey: r.license_key,
    customerName: r.customer_name,
    email: r.email,
    plan: r.plan as LicensePlan,
    maxDevices: r.max_devices,
    status: r.status as LicenseStatus,
    features: JSON.parse(r.features),
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    paymentReference: r.payment_reference || null,
    paymentProvider: r.payment_provider || null,
    paymentStatus: r.payment_status || null,
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getLicenseById(db: DatabaseSync, id: string): LicenseRecord | null {
  const r = db.prepare('SELECT * FROM licenses WHERE id = ?').get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    licenseKey: r.license_key,
    customerName: r.customer_name,
    email: r.email,
    plan: r.plan as LicensePlan,
    maxDevices: r.max_devices,
    status: r.status as LicenseStatus,
    features: JSON.parse(r.features),
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    paymentReference: r.payment_reference || null,
    paymentProvider: r.payment_provider || null,
    paymentStatus: r.payment_status || null,
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Fetches comprehensive license details including device activations and audit logs.
 */
export function getLicenseDetails(db: DatabaseSync, idOrKey: string): LicenseDetailRecord | null {
  const isKey = idOrKey.includes('-') && idOrKey.toUpperCase().startsWith('SELW');
  const query = isKey
    ? 'SELECT * FROM licenses WHERE license_key = ?'
    : 'SELECT * FROM licenses WHERE id = ? OR license_key = ?';
  const r = (isKey
    ? db.prepare(query).get(idOrKey.toUpperCase())
    : db.prepare(query).get(idOrKey, idOrKey)) as any;
  if (!r) return null;

  const activationsRaw = db.prepare(`
    SELECT * FROM activations WHERE license_id = ? ORDER BY activated_at DESC
  `).all(r.id) as any[];

  const auditLogsRaw = db.prepare(`
    SELECT * FROM license_audit_logs WHERE license_id = ? ORDER BY created_at DESC
  `).all(r.id) as any[];

  const activeDevices = activationsRaw.filter((a) => a.status === 'active').length;

  return {
    id: r.id,
    licenseKey: r.license_key,
    customerName: r.customer_name,
    email: r.email,
    plan: r.plan as LicensePlan,
    maxDevices: r.max_devices,
    status: r.status as LicenseStatus,
    features: JSON.parse(r.features),
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    paymentReference: r.payment_reference || null,
    paymentProvider: r.payment_provider || null,
    paymentStatus: r.payment_status || null,
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    activeDevices,
    activations: activationsRaw.map((a) => ({
      id: a.id,
      licenseId: a.license_id,
      deviceId: a.device_id,
      deviceName: a.device_name,
      activatedAt: a.activated_at,
      lastSeenAt: a.last_seen_at,
      status: a.status as 'active' | 'deactivated',
      ipAddress: a.ip_address || undefined,
    })),
    auditLogs: auditLogsRaw.map((al) => ({
      id: al.id,
      licenseId: al.license_id,
      action: al.action,
      actor: al.actor || 'admin',
      details: al.details || null,
      createdAt: al.created_at,
    })),
  };
}

/**
 * Calculates high-level license overview metrics for the admin dashboard.
 */
export function getDashboardMetrics(db: DatabaseSync): LicenseDashboardMetrics {
  const total = Number((db.prepare('SELECT COUNT(*) as c FROM licenses').get() as any)?.c || 0);
  const active = Number((db.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'active'").get() as any)?.c || 0);
  const trial = Number((db.prepare("SELECT COUNT(*) as c FROM licenses WHERE plan = 'trial'").get() as any)?.c || 0);
  const expired = Number((db.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'expired' OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)").get() as any)?.c || 0);
  const suspended = Number((db.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'suspended'").get() as any)?.c || 0);
  const revoked = Number((db.prepare("SELECT COUNT(*) as c FROM licenses WHERE status = 'revoked'").get() as any)?.c || 0);
  const activeDevices = Number((db.prepare("SELECT COUNT(*) as c FROM activations WHERE status = 'active'").get() as any)?.c || 0);

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const expiringSoon = Number((db.prepare(`
    SELECT COUNT(*) as c FROM licenses
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?
  `).get(now.toISOString(), sevenDaysLater) as any)?.c || 0);

  return {
    totalLicenses: total,
    activeLicenses: active,
    trialLicenses: trial,
    expiredLicenses: expired,
    suspendedLicenses: suspended,
    revokedLicenses: revoked,
    activeDevices,
    expiringSoon,
  };
}

/**
 * Formats a clean, ready-to-deliver customer onboarding message.
 */
export function generateCustomerMessage(license: LicenseRecord): string {
  const expiryText = license.expiresAt
    ? new Date(license.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Never (Lifetime License)';

  const planName = license.plan.charAt(0).toUpperCase() + license.plan.slice(1);

  return `Thank you for choosing Selwick POS.

Your Selwick POS license details:

Customer: ${license.customerName}
Plan: ${planName}
Devices Allowed: ${license.maxDevices}
Valid Until: ${expiryText}
License Key: ${license.licenseKey}

Getting Started:
1. Install and launch Selwick POS on your computer.
2. Go to Settings -> Commercial License & Activation.
3. Enter your License Key (${license.licenseKey}) and click "Activate Terminal".

Please keep this license key safe.
For activation assistance or support, contact Selwick POS support.`;
}
