/**
 * Selwick POS — Turso Cloud License Repository Subsystem (Phase 8.2).
 *
 * Implements high-durability cloud persistence for the License Server using Turso / libSQL.
 * Ensures multi-device limit atomicity using libSQL write transactions.
 */

import crypto from 'node:crypto';
import type { Client, InStatement } from '@libsql/client';
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
import {
  LicenseError,
  getDefaultFeaturesForPlan,
  type CreateLicenseParams,
  type ListLicensesOptions,
} from './licenseService.ts';

export const TURSO_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('trial', 'monthly', 'yearly', 'lifetime')),
  max_devices INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'suspended', 'revoked')) DEFAULT 'active',
  features TEXT NOT NULL DEFAULT '[]',
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  payment_reference TEXT,
  payment_provider TEXT,
  payment_status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'deactivated')) DEFAULT 'active',
  ip_address TEXT,
  UNIQUE(license_id, device_id)
);

CREATE TABLE IF NOT EXISTS license_audit_logs (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin',
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_activations_license_device ON activations(license_id, device_id);
CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id);
CREATE INDEX IF NOT EXISTS idx_license_audit_license_id ON license_audit_logs(license_id);
`;

/**
 * Initializes tables and indexes on the Turso cloud database.
 */
export async function initTursoSchema(client: Client): Promise<void> {
  const statements: InStatement[] = [
    `CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('trial', 'monthly', 'yearly', 'lifetime')),
      max_devices INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'suspended', 'revoked')) DEFAULT 'active',
      features TEXT NOT NULL DEFAULT '[]',
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      payment_reference TEXT,
      payment_provider TEXT,
      payment_status TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS activations (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'deactivated')) DEFAULT 'active',
      ip_address TEXT,
      UNIQUE(license_id, device_id)
    );`,
    `CREATE TABLE IF NOT EXISTS license_audit_logs (
      id TEXT PRIMARY KEY,
      license_id TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'admin',
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);`,
    `CREATE INDEX IF NOT EXISTS idx_activations_license_device ON activations(license_id, device_id);`,
    `CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id);`,
    `CREATE INDEX IF NOT EXISTS idx_license_audit_license_id ON license_audit_logs(license_id);`,
  ];

  await client.batch(statements, 'write');
}

/**
 * Creates a new commercial license record on Turso cloud database.
 */
export async function createLicenseTurso(
  client: Client,
  params: CreateLicenseParams
): Promise<LicenseRecord> {
  if (!params.customerName?.trim()) {
    throw new LicenseError('INVALID_INPUT', 'Customer name is required.');
  }
  if (!params.email?.trim()) {
    throw new LicenseError('INVALID_INPUT', 'Customer email is required.');
  }

  const id = crypto.randomUUID();
  const planPrefix =
    params.plan === 'lifetime'
      ? 'LIFE'
      : params.plan === 'yearly'
      ? 'YEAR'
      : params.plan === 'monthly'
      ? 'MTH'
      : 'TRL';
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
    expiresAt = null;
  }

  const features = params.features || getDefaultFeaturesForPlan(params.plan);
  const maxDevices = params.maxDevices !== undefined && params.maxDevices > 0 ? params.maxDevices : 1;
  const actor = params.actor || 'admin';

  const tx = await client.transaction('write');
  try {
    await tx.execute({
      sql: `INSERT INTO licenses (
        id, license_key, customer_name, email, plan, max_devices, status, features,
        issued_at, expires_at, payment_reference, payment_provider, payment_status, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
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
        issuedAt,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, actor, details)
            VALUES (?, ?, 'create_license', ?, ?)`,
      args: [
        crypto.randomUUID(),
        id,
        actor,
        JSON.stringify({
          plan: params.plan,
          customerName: params.customerName.trim(),
          maxDevices,
          expiresAt,
          paymentStatus: params.paymentStatus || null,
        }),
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

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
 * Activates a device on Turso cloud database using write transaction for device-limit atomicity.
 */
export async function activateLicenseTurso(
  client: Client,
  licenseKey: string,
  deviceId: string,
  deviceName: string = 'Terminal',
  privateKeyPem: string,
  ipAddress?: string
): Promise<{ signedPayload: SignedLicensePayload; signature: string }> {
  if (!licenseKey?.trim()) {
    throw new LicenseError('INVALID_KEY', 'License key is required.');
  }
  if (!deviceId?.trim()) {
    throw new LicenseError('INVALID_DEVICE', 'Device identifier is required.');
  }

  const cleanKey = licenseKey.trim().toUpperCase();
  const tx = await client.transaction('write');

  try {
    const licResult = await tx.execute({
      sql: 'SELECT * FROM licenses WHERE license_key = ?',
      args: [cleanKey],
    });

    const row = licResult.rows[0] as any;
    if (!row) {
      throw new LicenseError('LICENSE_NOT_FOUND', 'The provided license key is invalid or does not exist.', 404);
    }

    if (row.status === 'revoked') {
      throw new LicenseError('LICENSE_REVOKED', 'This license has been revoked. Contact support.', 403);
    }
    if (row.status === 'suspended') {
      throw new LicenseError('LICENSE_SUSPENDED', 'This license is temporarily suspended.', 403);
    }

    const now = new Date();
    if (row.expires_at) {
      const expDate = new Date(row.expires_at as string);
      if (now > expDate) {
        await tx.execute({
          sql: "UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?",
          args: [now.toISOString(), row.id],
        });
        throw new LicenseError('LICENSE_EXPIRED', `This license expired on ${expDate.toLocaleDateString()}. Please renew.`, 403);
      }
    }

    const existingResult = await tx.execute({
      sql: 'SELECT * FROM activations WHERE license_id = ? AND device_id = ?',
      args: [row.id, deviceId],
    });

    const existingActivation = existingResult.rows[0] as any;

    if (existingActivation) {
      await tx.execute({
        sql: `UPDATE activations
              SET status = 'active', device_name = ?, last_seen_at = ?, ip_address = ?
              WHERE id = ?`,
        args: [deviceName, now.toISOString(), ipAddress || null, existingActivation.id],
      });
    } else {
      const countResult = await tx.execute({
        sql: `SELECT COUNT(*) as c FROM activations WHERE license_id = ? AND status = 'active'`,
        args: [row.id],
      });
      const activeCount = Number(countResult.rows[0]?.c || 0);

      if (activeCount >= Number(row.max_devices)) {
        throw new LicenseError(
          'DEVICE_LIMIT_REACHED',
          `License device limit reached (${activeCount} / ${row.max_devices} devices active). Deactivate a device to activate this machine.`,
          403
        );
      }

      await tx.execute({
        sql: `INSERT INTO activations (id, license_id, device_id, device_name, activated_at, last_seen_at, status, ip_address)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        args: [
          crypto.randomUUID(),
          row.id,
          deviceId,
          deviceName,
          now.toISOString(),
          now.toISOString(),
          ipAddress || null,
        ],
      });
    }

    const signedPayload: SignedLicensePayload = {
      licenseId: String(row.id),
      licenseKey: String(row.license_key),
      customerName: String(row.customer_name),
      plan: row.plan as LicensePlan,
      maxDevices: Number(row.max_devices),
      deviceId,
      features: JSON.parse(String(row.features)) as FeatureFlag[],
      issuedAt: String(row.issued_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      serverTimestamp: now.toISOString(),
    };

    const signature = signLicensePayload(signedPayload, privateKeyPem);

    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, details)
            VALUES (?, ?, 'activate_device', ?)`,
      args: [crypto.randomUUID(), row.id, JSON.stringify({ deviceId, deviceName, ipAddress })],
    });

    await tx.commit();
    return { signedPayload, signature };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Verifies online device status against Turso.
 */
export async function verifyLicenseTurso(
  client: Client,
  licenseKey: string,
  deviceId: string,
  privateKeyPem: string,
  ipAddress?: string
): Promise<{ signedPayload: SignedLicensePayload; signature: string; status: LicenseStatus }> {
  const result = await activateLicenseTurso(client, licenseKey, deviceId, undefined, privateKeyPem, ipAddress);
  return {
    ...result,
    status: 'active',
  };
}

/**
 * Deactivates device by activation ID on Turso.
 */
export async function deactivateActivationByIdTurso(
  client: Client,
  activationId: string,
  actor = 'admin'
): Promise<boolean> {
  const tx = await client.transaction('write');
  try {
    const actResult = await tx.execute({
      sql: 'SELECT * FROM activations WHERE id = ?',
      args: [activationId],
    });

    const act = actResult.rows[0] as any;
    if (!act) {
      throw new LicenseError('ACTIVATION_NOT_FOUND', 'Activation record not found.', 404);
    }

    await tx.execute({
      sql: "UPDATE activations SET status = 'deactivated', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [activationId],
    });

    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, actor, details)
            VALUES (?, ?, 'deactivate_device', ?, ?)`,
      args: [
        crypto.randomUUID(),
        act.license_id,
        actor,
        JSON.stringify({ activationId, deviceId: act.device_id, deviceName: act.device_name }),
      ],
    });

    await tx.commit();
    return true;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Renews license on Turso.
 */
export async function renewLicenseTurso(
  client: Client,
  licenseId: string,
  explicitExpiresAt?: string | null,
  actor = 'admin'
): Promise<{ expiresAt: string | null }> {
  const lic = await getLicenseByIdTurso(client, licenseId);
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
    let baseDate = now;
    if (lic.expiresAt) {
      const currentExp = new Date(lic.expiresAt);
      if (currentExp > now) {
        baseDate = currentExp;
      }
    }

    const d = new Date(baseDate);
    if (lic.plan === 'monthly') d.setDate(d.getDate() + 30);
    else if (lic.plan === 'yearly') d.setDate(d.getDate() + 365);
    else if (lic.plan === 'trial') d.setDate(d.getDate() + 14);
    newExpiresAt = d.toISOString();
  }

  const tx = await client.transaction('write');
  try {
    await tx.execute({
      sql: "UPDATE licenses SET expires_at = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [newExpiresAt, licenseId],
    });

    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, actor, details)
            VALUES (?, ?, 'renew_license', ?, ?)`,
      args: [
        crypto.randomUUID(),
        licenseId,
        actor,
        JSON.stringify({ previousExpiresAt: lic.expiresAt, newExpiresAt }),
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return { expiresAt: newExpiresAt };
}

/**
 * Updates license status (active, suspended, revoked) on Turso.
 */
export async function setLicenseStatusTurso(
  client: Client,
  licenseId: string,
  status: LicenseStatus,
  actor = 'admin'
): Promise<void> {
  const lic = await getLicenseByIdTurso(client, licenseId);
  if (!lic) {
    throw new LicenseError('LICENSE_NOT_FOUND', 'License not found.', 404);
  }

  const tx = await client.transaction('write');
  try {
    await tx.execute({
      sql: 'UPDATE licenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [status, licenseId],
    });

    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, actor, details)
            VALUES (?, ?, 'set_status', ?, ?)`,
      args: [
        crypto.randomUUID(),
        licenseId,
        actor,
        JSON.stringify({ previousStatus: lic.status, newStatus: status }),
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Fetches license by ID from Turso.
 */
export async function getLicenseByIdTurso(client: Client, id: string): Promise<LicenseRecord | null> {
  const res = await client.execute({
    sql: 'SELECT * FROM licenses WHERE id = ?',
    args: [id],
  });

  const r = res.rows[0] as any;
  if (!r) return null;

  return {
    id: String(r.id),
    licenseKey: String(r.license_key),
    customerName: String(r.customer_name),
    email: String(r.email),
    plan: r.plan as LicensePlan,
    maxDevices: Number(r.max_devices),
    status: r.status as LicenseStatus,
    features: JSON.parse(String(r.features)),
    issuedAt: String(r.issued_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    paymentReference: r.payment_reference ? String(r.payment_reference) : null,
    paymentProvider: r.payment_provider ? String(r.payment_provider) : null,
    paymentStatus: r.payment_status ? (r.payment_status as any) : null,
    notes: r.notes ? String(r.notes) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/**
 * Fetches license by key from Turso.
 */
export async function getLicenseByKeyTurso(client: Client, licenseKey: string): Promise<LicenseRecord | null> {
  const res = await client.execute({
    sql: 'SELECT * FROM licenses WHERE license_key = ?',
    args: [licenseKey.trim().toUpperCase()],
  });

  const r = res.rows[0] as any;
  if (!r) return null;

  return {
    id: String(r.id),
    licenseKey: String(r.license_key),
    customerName: String(r.customer_name),
    email: String(r.email),
    plan: r.plan as LicensePlan,
    maxDevices: Number(r.max_devices),
    status: r.status as LicenseStatus,
    features: JSON.parse(String(r.features)),
    issuedAt: String(r.issued_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    paymentReference: r.payment_reference ? String(r.payment_reference) : null,
    paymentProvider: r.payment_provider ? String(r.payment_provider) : null,
    paymentStatus: r.payment_status ? (r.payment_status as any) : null,
    notes: r.notes ? String(r.notes) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/**
 * Lists licenses with search, status/plan filtering, and active device counts from Turso.
 */
export async function listLicensesTurso(
  client: Client,
  options?: string | ListLicensesOptions
): Promise<Array<LicenseRecord & { activeDevices: number }>> {
  let sql = `
    SELECT l.*,
           (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.status = 'active') as active_devices
    FROM licenses l
  `;
  const conditions: string[] = [];
  const args: any[] = [];

  const opts: ListLicensesOptions =
    typeof options === 'string' ? { search: options } : options || {};

  if (opts.search?.trim()) {
    conditions.push(`(l.license_key LIKE ? OR l.customer_name LIKE ? OR l.email LIKE ?)`);
    const s = `%${opts.search.trim()}%`;
    args.push(s, s, s);
  }

  if (opts.status && opts.status !== 'all') {
    conditions.push(`l.status = ?`);
    args.push(opts.status);
  }

  if (opts.plan && opts.plan !== 'all') {
    conditions.push(`l.plan = ?`);
    args.push(opts.plan);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  const sortCol =
    opts.sortBy === 'expires_at'
      ? 'l.expires_at'
      : opts.sortBy === 'customer_name'
      ? 'l.customer_name'
      : 'l.created_at';
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';

  sql += ` ORDER BY ${sortCol} ${sortDir}`;

  const res = await client.execute({ sql, args });

  return res.rows.map((r: any) => ({
    id: String(r.id),
    licenseKey: String(r.license_key),
    customerName: String(r.customer_name),
    email: String(r.email),
    plan: r.plan as LicensePlan,
    maxDevices: Number(r.max_devices),
    status: r.status as LicenseStatus,
    features: JSON.parse(String(r.features)),
    issuedAt: String(r.issued_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    paymentReference: r.payment_reference ? String(r.payment_reference) : null,
    paymentProvider: r.payment_provider ? String(r.payment_provider) : null,
    paymentStatus: r.payment_status ? (r.payment_status as any) : null,
    notes: r.notes ? String(r.notes) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    activeDevices: Number(r.active_devices || 0),
  }));
}

/**
 * Fetches complete details (license, activations, audit logs) from Turso.
 */
export async function getLicenseDetailsTurso(
  client: Client,
  idOrKey: string
): Promise<LicenseDetailRecord | null> {
  const isKey = idOrKey.includes('-') && idOrKey.toUpperCase().startsWith('SELW');
  const sql = isKey
    ? 'SELECT * FROM licenses WHERE license_key = ?'
    : 'SELECT * FROM licenses WHERE id = ? OR license_key = ?';
  const args = isKey ? [idOrKey.toUpperCase()] : [idOrKey, idOrKey];

  const res = await client.execute({ sql, args });
  const r = res.rows[0] as any;
  if (!r) return null;

  const [actResult, auditResult] = await Promise.all([
    client.execute({
      sql: 'SELECT * FROM activations WHERE license_id = ? ORDER BY activated_at DESC',
      args: [r.id],
    }),
    client.execute({
      sql: 'SELECT * FROM license_audit_logs WHERE license_id = ? ORDER BY created_at DESC',
      args: [r.id],
    }),
  ]);

  const activationsRaw = actResult.rows as any[];
  const auditLogsRaw = auditResult.rows as any[];
  const activeDevices = activationsRaw.filter((a) => a.status === 'active').length;

  return {
    id: String(r.id),
    licenseKey: String(r.license_key),
    customerName: String(r.customer_name),
    email: String(r.email),
    plan: r.plan as LicensePlan,
    maxDevices: Number(r.max_devices),
    status: r.status as LicenseStatus,
    features: JSON.parse(String(r.features)),
    issuedAt: String(r.issued_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    paymentReference: r.payment_reference ? String(r.payment_reference) : null,
    paymentProvider: r.payment_provider ? String(r.payment_provider) : null,
    paymentStatus: r.payment_status ? (r.payment_status as any) : null,
    notes: r.notes ? String(r.notes) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    activeDevices,
    activations: activationsRaw.map((a) => ({
      id: String(a.id),
      licenseId: String(a.license_id),
      deviceId: String(a.device_id),
      deviceName: String(a.device_name),
      activatedAt: String(a.activated_at),
      lastSeenAt: String(a.last_seen_at),
      status: a.status as 'active' | 'deactivated',
      ipAddress: a.ip_address ? String(a.ip_address) : undefined,
    })),
    auditLogs: auditLogsRaw.map((al) => ({
      id: String(al.id),
      licenseId: al.license_id ? String(al.license_id) : null,
      action: String(al.action),
      actor: String(al.actor || 'admin'),
      details: al.details ? String(al.details) : null,
      createdAt: String(al.created_at),
    })),
  };
}

/**
 * Updates the maximum number of allowed devices for a license in Turso.
 */
export async function setMaxDevicesTurso(
  client: Client,
  licenseId: string,
  maxDevices: number,
  actor = 'admin'
): Promise<void> {
  if (!Number.isInteger(maxDevices) || maxDevices < 1) {
    throw new LicenseError('INVALID_INPUT', 'Max devices must be a positive integer of at least 1.');
  }
  const tx = await client.transaction('write');
  try {
    const res = await tx.execute({
      sql: 'UPDATE licenses SET max_devices = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [maxDevices, licenseId],
    });
    if (Number(res.rowsAffected) === 0) {
      await tx.rollback();
      throw new LicenseError('NOT_FOUND', 'License not found.');
    }
    await tx.execute({
      sql: `INSERT INTO license_audit_logs (id, license_id, action, actor, details)
            VALUES (?, ?, 'set_max_devices', ?, ?)`,
      args: [crypto.randomUUID(), licenseId, actor, JSON.stringify({ maxDevices })],
    });
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch {}
    throw err;
  }
}

/**
 * Calculates dashboard metrics from Turso.
 */
export async function getDashboardMetricsTurso(client: Client): Promise<LicenseDashboardMetrics> {
  const [totalRes, activeRes, trialRes, expiredRes, suspendedRes, revokedRes, activeDevRes] =
    await Promise.all([
      client.execute('SELECT COUNT(*) as c FROM licenses'),
      client.execute("SELECT COUNT(*) as c FROM licenses WHERE status = 'active'"),
      client.execute("SELECT COUNT(*) as c FROM licenses WHERE plan = 'trial'"),
      client.execute(
        "SELECT COUNT(*) as c FROM licenses WHERE status = 'expired' OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)"
      ),
      client.execute("SELECT COUNT(*) as c FROM licenses WHERE status = 'suspended'"),
      client.execute("SELECT COUNT(*) as c FROM licenses WHERE status = 'revoked'"),
      client.execute("SELECT COUNT(*) as c FROM activations WHERE status = 'active'"),
    ]);

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const expiringRes = await client.execute({
    sql: `SELECT COUNT(*) as c FROM licenses
          WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`,
    args: [now.toISOString(), sevenDaysLater],
  });

  return {
    totalLicenses: Number(totalRes.rows[0]?.c || 0),
    activeLicenses: Number(activeRes.rows[0]?.c || 0),
    trialLicenses: Number(trialRes.rows[0]?.c || 0),
    expiredLicenses: Number(expiredRes.rows[0]?.c || 0),
    suspendedLicenses: Number(suspendedRes.rows[0]?.c || 0),
    revokedLicenses: Number(revokedRes.rows[0]?.c || 0),
    activeDevices: Number(activeDevRes.rows[0]?.c || 0),
    expiringSoon: Number(expiringRes.rows[0]?.c || 0),
  };
}

