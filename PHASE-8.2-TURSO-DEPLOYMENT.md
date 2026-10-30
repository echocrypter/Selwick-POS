# SELWICK POS — PHASE 8.2 TURSO CLOUD LICENSE DATABASE DEPLOYMENT

> **Status:** Production-Ready & Verified (627/627 Regression Tests Passing)  
> **Target Cost:** $0.00 / month (Completely Free Tier Pilot)  
> **Architecture Model:** Turso (libSQL) Cloud Persistence for Licensing + 100% Local SQLite Operational Database (`selwick.db`)

---

## 1. Executive Summary & Architecture

In Phase 8.1, deployment of the License Server using local SQLite on free hosting (such as Render or Vercel) was blocked due to **ephemeral container disks** wiping local SQLite databases upon restarts or serverless reboots.

In **Phase 8.2**, this limitation has been resolved with **Turso (libSQL)**:
- **Turso Cloud Database** serves as the authoritative, durable cloud persistence layer for the **License Server ONLY**.
- The customer's **operational POS database (`selwick.db`) remains 100% local, offline-first, and completely untouched**.
- No business sales, inventory, customers, refunds, or Khata data are ever sent to Turso or dependent on network connectivity.
- The License Server can now be safely deployed on **Render Free Web Service** or **Vercel Serverless Functions** at **$0 cost** with full persistence.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER WINDOWS PC                             │
│                                                                        │
│  ┌───────────────────────┐             ┌────────────────────────────┐  │
│  │   Selwick POS App     │             │   Local SQLite Database    │  │
│  │   (Electron Desktop)  │◄───────────►│       (selwick.db)         │  │
│  └──────────┬────────────┘             │  • Sales & Items           │  │
│             │                          │  • Inventory & Categories  │  │
│             │ HTTPS (Ed25519)          │  • Customers & Khata       │  │
│             │ (Activation/Verify only) │  • Expenses & Settings     │  │
│             ▼                          └────────────────────────────┘  │
└─────────────┼──────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────┐
│              CLOUD LICENSE SERVER ($0 Free Tier Hosting)               │
│                   (Render / Vercel Serverless)                         │
│                                                                        │
│  • Public Key Signature Distribution (Ed25519)                         │
│  • Device Limit Atomicity (Write Transactions)                         │
│  • Admin Dashboard (/license-admin)                                    │
│  • Fail-Closed Security Guards                                         │
│  • Zero Secret Exposure in Client Distribution                         │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
                              │ TLS (libsql://)
                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│               TURSO CLOUD DATABASE ($0 Starter Plan)                   │
│                                                                        │
│  • licenses (IDs, keys, plans, features, status, expires_at)           │
│  • activations (device_id, device_name, last_seen_at, status)          │
│  • license_audit_logs (actor, action, details, timestamp)              │
│  • 9 GB storage / 1 Billion row reads/mo included free                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Security Invariants & Fail-Closed Guards

1. **Production Fail-Closed Guard:**
   If `SELWICK_ENV=production` or `NODE_ENV=production` and either `TURSO_DATABASE_URL` or `TURSO_AUTH_TOKEN` is missing, `getTursoClient()` throws a critical exception immediately. It **never silently falls back to local SQLite in production**.
2. **Development / Local Fallback:**
   In development or local test runs, if Turso environment variables are omitted, the system seamlessly uses local SQLite (`.data/license_server.db`) to enable fast offline unit testing without external dependencies.
3. **Zero Secret Leakage in Client:**
   - Neither `TURSO_AUTH_TOKEN` nor `SELWICK_LICENSE_PRIVATE_KEY` nor `SELWICK_LICENSE_ADMIN_SECRET` is bundled into the Electron installer or `.next/static`.
   - The desktop POS binary contains **only the Ed25519 public key** for offline signature verification.
4. **Device Limit Enforcement:**
   Turso transactions (`client.transaction('write')`) ensure atomic device count checks, preventing race conditions when multiple terminals attempt concurrent activation on the same license.
5. **Operational Database Isolation:**
   `selwick.db` contains operational POS business data only. Even during complete cloud database outages or license server downtime, POS checkout and inventory operate without disruption under the 14-day offline grace period.

---

## 3. Step-by-Step Turso Setup Guide ($0 Cost)

### Step 3.1: Create Free Turso Account
1. Open [turso.tech](https://turso.tech) in your browser.
2. Sign up using GitHub or email. **No credit card is required** for the Starter tier (9 GB storage, 1 Billion reads/month).
3. From the Turso dashboard (or via `turso` CLI):
   ```bash
   # If using Turso CLI:
   turso db create selwick-license
   ```
4. Note your database URL:
   ```text
   libsql://selwick-license-<your-username>.turso.io
   ```
5. Generate an authentication token:
   ```bash
   turso db tokens create selwick-license
   ```
   Save the generated token securely.

### Step 3.2: Initialize the Turso Schema
Run the provided automated initializer script from your machine:
```bash
TURSO_DATABASE_URL="libsql://selwick-license-<your-username>.turso.io" \
TURSO_AUTH_TOKEN="<your-auth-token>" \
node scripts/init-turso-db.cjs
```
The script automatically connects and executes the batch schema creation for:
- `licenses`
- `activations`
- `license_audit_logs`
- Indexes: `idx_licenses_key`, `idx_licenses_status`, `idx_activations_license_device`, `idx_activations_device`, `idx_license_audit_license_id`

---

## 4. Free Cloud Hosting Deployment Options

Both **Render** and **Vercel** are 100% compatible with Turso cloud persistence.

### Option A: Render Free Web Service (Recommended)
1. Push this repository to GitHub or GitLab.
2. Go to [dashboard.render.com](https://dashboard.render.com) and click **New + > Web Service**.
3. Select your repository.
4. Configure service settings:
   - **Environment:** Node
   - **Build Command:** `npm run build`
   - **Start Command:** `node .next/standalone/server.js` (or `npm start`)
   - **Instance Type:** Free (0.1 CPU, 512 MB RAM)
5. Under **Environment Variables**, add:
   | Variable | Value Description |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SELWICK_ENV` | `production` |
   | `TURSO_DATABASE_URL` | `libsql://selwick-license-<username>.turso.io` |
   | `TURSO_AUTH_TOKEN` | `<your-turso-token>` |
   | `SELWICK_LICENSE_PRIVATE_KEY` | Ed25519 Private Key PEM string |
   | `SELWICK_LICENSE_ADMIN_SECRET` | Strong random secret (min 32 characters) |
6. Click **Create Web Service**. Render provides a free HTTPS endpoint:
   `https://selwick-license.onrender.com`

---

## 5. Connecting Electron Desktop POS to the Production License Server

Once your License Server is deployed on HTTPS:
1. Set the remote server URL in your desktop build configuration or user environment:
   ```bash
   SELWICK_LICENSE_SERVER_URL="https://selwick-license.onrender.com"
   ```
2. Build the production Windows installer:
   ```bash
   npm run desktop:build
   ```
3. Distribute `desktop-dist/Selwick POS Setup 1.0.0.exe` to customer terminals.

---

## 6. Verification & Test Suite Matrix

The suite has been tested against libSQL with full transactional and isolation assertions:

| Test Group | Checks | Result |
|---|---|---|
| **Phase 1–5 Core POS & Packaging** | 560 checks | ✅ Passed |
| **Phase 6 Ed25519 Licensing Foundation** | 16 checks | ✅ Passed |
| **Phase 7 License Admin Dashboard** | 19 checks | ✅ Passed |
| **Phase 8 Production Hardening & Pilot** | 16 checks | ✅ Passed |
| **Phase 8.2 Turso Cloud Database Integration** | 16 checks | ✅ Passed |
| **Total Automated Regression Suite** | **627 checks** | **✅ 100% PASSED (0 Failures)** |

To re-run the verification suites at any time:
```bash
# Turso integration verification
npm run check:phase8.2

# All licensing verification
npm run check:phase6 && npm run check:phase7 && npm run check:phase8 && npm run check:phase8.2
```

---

## 7. Commercial Pilot Readiness Verdict

**Verdict:** ✅ **READY FOR PRODUCTION FREE CUSTOMER PILOT**

- **Zero Hosting Fees:** Uses Turso Starter Tier (Free) + Render/Vercel (Free).
- **Zero Data Loss Invariant:** Customer transactional data is exclusively stored in local `selwick.db`.
- **Fault-Tolerant:** POS operates without disruption during network cuts or cloud downtime for up to 14 days.
- **Tamper-Proof:** Cryptographically signed using asymmetric Ed25519 signatures.
- **Atomic Multi-Device Limits:** Protected by libSQL write transactions against over-allocation.

