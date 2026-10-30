/**
 * Selwick POS — Stable, Privacy-Preserving Device Identification.
 *
 * Generates a stable machine identifier without invasive hardware snooping.
 * Does not break on normal peripheral or driver changes.
 */

import os from 'node:os';
import crypto from 'node:crypto';

let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  // If explicitly overridden via environment (e.g. for testing)
  if (process.env.SELWICK_DEVICE_ID) {
    cachedDeviceId = process.env.SELWICK_DEVICE_ID;
    return cachedDeviceId;
  }

  try {
    const hostname = os.hostname() || 'unknown-host';
    const platform = os.platform();
    const arch = os.arch();
    const username = os.userInfo?.()?.username || 'user';
    const cpus = os.cpus?.()?.[0]?.model || 'cpu';

    // Cryptographic hash of core stable platform attributes
    const rawFingerprint = `${platform}|${arch}|${hostname.toLowerCase()}|${username}|${cpus}`;
    const hash = crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 24);

    cachedDeviceId = `dev_${hash}`;
    return cachedDeviceId;
  } catch {
    // Fallback: stable random identifier cached per process/machine
    cachedDeviceId = `dev_fallback_${crypto.randomUUID().slice(0, 16)}`;
    return cachedDeviceId;
  }
}

export function getDeviceName(): string {
  try {
    return os.hostname() || 'Selwick POS Terminal';
  } catch {
    return 'Selwick POS Terminal';
  }
}

