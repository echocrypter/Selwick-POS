# Selwick POS — Commercial Licensing & Activation Architecture (Phase 6)

## 1. Executive Summary

Phase 6 implements a zero-trust, cryptographically signed commercial licensing and activation subsystem for Selwick POS. This enables the same desktop installer to be distributed commercially to distinct businesses under different tiers (Trial, Monthly, Yearly, Lifetime) and device limits without compromising offline operability, tamper resistance, or operational database isolation.

---

## 2. Architecture & Subsystem Boundaries

The licensing system is strictly decoupled from the POS operational database:

```text
+-----------------------------------------------------------------------------------+
|                                 POS Desktop App                                   |
|                                                                                   |
|  +-------------------------+                     +-----------------------------+  |
|  |     POS Operational     |                     |    POS Licensing Engine     |  |
|  |   Database (selwick.db) |                     |  (posLicenseClient.ts)      |  |
|  |                         |                     |                             |  |
|  |  - Products             |                     |  - Embedded Ed25519 PubKey  |  |
|  |  - Sales & Khata        |                     |  - Local Signature Verify   |  |
|  |  - Customers            |                     |  - Offline Grace Timer      |  |
|  |  - Inventory            |                     |  - Hardware Fingerprint     |  |
|  +-------------------------+                     +--------------+--------------+  |
+-----------------------------------------------------------------|-----------------+
                                                                  |
                                              HTTPS / JSON API    | (Activation & Heartbeats)
                                                                  v
+-----------------------------------------------------------------------------------+
|                             License Server (Dedicated)                            |
|                                                                                   |
|  +-------------------------+                     +-----------------------------+  |
|  |  License Server Routes  |                     |   License Database          |  |
|  |  - /api/license/activate|                     |   (license_server.db)       |  |
|  |  - /api/license/verify  |                     |                             |  |
|  |  - /api/license/admin/* |                     |  - licenses                 |  |
|  +------------+------------+                     |  - activations              |  |
|               |                                  |  - license_audit_logs       |  |
|               v                                  +-----------------------------+  |
|  +-------------------------+                                                      |
|  |  Server Key Subsystem   |                                                      |
|  |  - Ed25519 Private Key  |                                                      |
|  |  - Canonical Signer     |                                                      |
|  +-------------------------+                                                      |
+-----------------------------------------------------------------------------------+
```

### Key Isolation Guarantees
1. **Zero Database Pollution**: `selwick.db` contains exclusively business data (`products`, `sales`, `customers`, `inventory`, `khata`). It contains zero license records or activation tokens.
2. **Asymmetric Key Security**: The POS desktop application contains **ONLY the Ed25519 public key**. The private signing key never ships with the client or installer.
3. **Non-Destructive Expiration**: If a license expires, gets suspended, or exceeds its grace period, POS operational data is **NEVER wiped, truncated, or modified**.

---

## 3. Cryptographic Model & Verification

- **Algorithm**: `Ed25519` (RFC 8032) asymmetric digital signature.
- **Embedded Public Key**:
  ```text
  MCowBQYDK2VwAyEA3YoQ8zyynwiJyAm8h+9lxBtBkmT7tNtvhsyEAqYeWUM=
  ```
- **Deterministic Canonicalization**:
  Before signing or verifying, the license payload is serialized with deterministically sorted keys (`canonicalizePayload`) to eliminate JSON whitespace or key-order malleability.

### Signed Payload Structure
```typescript
interface SignedLicensePayload {
  licenseId: string;
  licenseKey: string;
  customerName: string;
  plan: 'trial' | 'monthly' | 'yearly' | 'lifetime';
  maxDevices: number;
  deviceId: string;
  features: FeatureFlag[];
  issuedAt: string;
  expiresAt: string | null; // null for lifetime licenses
  serverTimestamp: string;
}
```

---

## 4. Hardware Fingerprinting & Device Binding

The POS client binds activations to a unique hardware fingerprint computed via non-invasive, privacy-preserving machine hashes (`src/lib/licensing/device.ts`):
- Windows Machine GUID (`SOFTWARE\Microsoft\Cryptography\MachineGuid`)
- CPU architecture and core topology
- Primary MAC address / Hostname hash
- Fallback OS identifier

If an activation file (`license_activation.json`) is copied to an unauthorized terminal, signature verification passes but device binding check detects a mismatch, preventing unauthorized duplication.

---

## 5. Offline Operation & Grace Period Engine

Retail POS terminals frequently encounter internet outages or run in isolated offline LANs.

1. **Instant Offline Operation**:
   Once activated, the signed activation payload is saved locally (`license_activation.json`). Verification runs completely offline using the embedded Ed25519 public key in `< 1ms`.
2. **Offline Grace Period (14 Days)**:
   The client records `lastVerifiedAt`. If the terminal remains completely disconnected from the internet:
   - **Days 1–9**: POS operates normally with zero interruptions.
   - **Days 10–14**: Gentle non-blocking banner notifies staff that internet connectivity is recommended.
   - **Day 15+**: Operational access pauses until terminal connects to re-validate heartbeat.
3. **Lifetime Licenses**:
   Lifetime licenses have `expiresAt = null` and never expire.

---

## 6. License Server Data Schema

Stored in an independent SQLite instance (`license_server.db`):

```sql
CREATE TABLE licenses (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activations (
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

CREATE TABLE license_audit_logs (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. API Endpoints

### Public & POS Endpoints
- `POST /api/license/activate`: Public endpoint for device activation and Ed25519 payload signing.
- `POST /api/license/verify`: Public heartbeat endpoint refreshing device `last_seen_at`.
- `GET /api/pos/license/status`: Local endpoint queried by POS UI for offline license state.
- `POST /api/pos/license/activate`: Local endpoint queried by POS UI to submit license keys.

### Administrative Endpoints
- `GET /api/license/admin/licenses`: List, filter, and inspect all commercial licenses and active device counts.
- `POST /api/license/admin/licenses`: Generate new commercial license keys.
- `PATCH /api/license/admin/licenses/[id]`: Renew expiry, suspend, revoke, or increase device limits.
- `POST /api/license/admin/activations/[id]`: Deactivate a device to free up an activation slot.

---

## 8. Verification & Test Suite Summary

The Phase 6 verification suite (`scripts/verify-phase6-licensing.cjs`) executes 16 rigorous tests:

| Test Case | Description | Result |
| :--- | :--- | :---: |
| **Test 1** | Valid activation creates signed payload and verifies Ed25519 signature | ✅ PASS |
| **Test 2** | Invalid license key rejected (404 error) | ✅ PASS |
| **Test 3** | Expired license rejected on activation | ✅ PASS |
| **Test 4** | Revoked license rejected on activation (403) | ✅ PASS |
| **Test 5** | Suspended license rejected on activation (403) | ✅ PASS |
| **Test 6** | Device limit enforcement (max 1 device: 1st succeeds, 2nd rejected) | ✅ PASS |
| **Test 7** | Device deactivation frees slot allowing second machine to activate | ✅ PASS |
| **Test 8** | Signed payload verification with public key alone | ✅ PASS |
| **Test 9** | Tampered payload rejection (customerName, expiry, plan, or features) | ✅ PASS |
| **Test 10** | Offline operation: POS evaluates authentic signed license with zero network calls | ✅ PASS |
| **Test 11** | Temporary license server outage: POS continues operating uninterrupted | ✅ PASS |
| **Test 12** | Offline grace period evaluation (14-day grace, warning nearing end, block after exhaustion) | ✅ PASS |
| **Test 13** | License renewal: Extending expiry updates status and allows reactivation | ✅ PASS |
| **Test 14** | Feature flags: `isFeatureEnabled` accurately validates enabled features | ✅ PASS |
| **Test 15** | Device mismatch rejection: Activation created for Device A fails on Device B | ✅ PASS |
| **Test 16** | POS SQLite database remains 100% untouched by any licensing error or expiration | ✅ PASS |

**Total Suite Result**: **16 / 16 PASSED (100%)**.

