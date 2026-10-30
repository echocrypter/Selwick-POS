/**
 * Selwick POS — Commercial Licensing Subsystem Types (Phase 6).
 */

export type LicensePlan = 'trial' | 'monthly' | 'yearly' | 'lifetime';

export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'revoked';

export type FeatureFlag =
  | 'inventory'
  | 'khata'
  | 'advanced_reports'
  | 'multi_user'
  | 'cloud_backup';

export interface LicenseRecord {
  id: string;
  licenseKey: string;
  customerName: string;
  email: string;
  plan: LicensePlan;
  maxDevices: number;
  status: LicenseStatus;
  features: FeatureFlag[];
  issuedAt: string;
  expiresAt: string | null;
  paymentReference?: string | null;
  paymentProvider?: string | null;
  paymentStatus?: 'unpaid' | 'paid' | 'refunded' | 'waived' | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationRecord {
  id: string;
  licenseId: string;
  deviceId: string;
  deviceName: string;
  activatedAt: string;
  lastSeenAt: string;
  status: 'active' | 'deactivated';
  ipAddress?: string;
}

export interface LicenseAuditRecord {
  id: string;
  licenseId: string | null;
  action: string;
  actor: string;
  details: string | null;
  createdAt: string;
}

export interface LicenseDashboardMetrics {
  totalLicenses: number;
  activeLicenses: number;
  trialLicenses: number;
  expiredLicenses: number;
  suspendedLicenses: number;
  revokedLicenses: number;
  activeDevices: number;
  expiringSoon: number;
}

export interface LicenseDetailRecord extends LicenseRecord {
  activeDevices: number;
  activations: ActivationRecord[];
  auditLogs: LicenseAuditRecord[];
}

/**
 * Exact canonical payload signed with Ed25519 by the License Server.
 * The POS client cryptographically verifies this payload with the embedded public key.
 */
export interface SignedLicensePayload {
  licenseId: string;
  licenseKey: string;
  customerName: string;
  plan: LicensePlan;
  maxDevices: number;
  deviceId: string;
  features: FeatureFlag[];
  issuedAt: string;
  expiresAt: string | null;
  serverTimestamp: string;
}

/**
 * Locally persisted activation record stored on the POS client machine.
 */
export interface LocalActivationData {
  signedPayload: SignedLicensePayload;
  signature: string; // Ed25519 base64
  lastVerifiedAt: string; // ISO
  gracePeriodDays: number; // e.g. 14 days
}

export type PosLicenseStatus =
  | 'active'
  | 'grace_period'
  | 'expired'
  | 'suspended'
  | 'revoked'
  | 'unlicensed'
  | 'invalid';

export interface PosLicenseState {
  status: PosLicenseStatus;
  isValid: boolean;
  canOperate: boolean;
  plan: LicensePlan | null;
  customerName: string | null;
  licenseKey: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  isGracePeriod: boolean;
  graceDaysRemaining: number | null;
  features: FeatureFlag[];
  deviceId: string;
  message: string;
}

export interface LicenseActivationRequest {
  licenseKey: string;
  deviceId: string;
  deviceName?: string;
}

export interface LicenseActivationResponse {
  ok: boolean;
  signedPayload?: SignedLicensePayload;
  signature?: string;
  error?: string;
  code?: string;
}

export interface LicenseVerificationRequest {
  licenseKey: string;
  deviceId: string;
  signature: string;
}

export interface LicenseVerificationResponse {
  ok: boolean;
  status: LicenseStatus;
  signedPayload?: SignedLicensePayload;
  signature?: string;
  error?: string;
  code?: string;
}

