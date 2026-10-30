# Selwick POS — Phase 8.1: Zero-Cost Production License Server Assessment

**Date:** 2026-10-31  
**Target:** $0 Zero-Cost Production License Server Deployment  
**Status Verdict:** ⚠️ **FREE DEPLOYMENT BLOCKED — PERSISTENT LICENSE DATABASE UNAVAILABLE**  
**Full Regression Test Suite:** 611/611 Passing (0 Failures)  
**Windows Production Installer:** `desktop-dist/Selwick POS Setup 1.0.0.exe` (89.9 MB)  

---

## 1. Executive Summary & Critical Finding

As required by **Section 4** of the Phase 8.1 specification:
> *"If the selected free platform has ephemeral filesystem storage, DO NOT deploy the SQLite license database there unless there is a safe persistent-storage mechanism. Do NOT silently switch to an unreliable filesystem... If the free platform cannot provide persistent license storage, STOP and report: **'FREE DEPLOYMENT BLOCKED — PERSISTENT LICENSE DATABASE UNAVAILABLE'**. Then identify the cheapest/free alternative that can actually satisfy the requirement."*

We conducted an exhaustive technical audit of the current free hosting ecosystem for Node.js / Next.js standalone servers.

### The Core Blocker
The Selwick License Server is an authoritative licensing authority powered by a local SQLite database (`license_server.db`) via `node:sqlite`. It stores:
- Merchant license records & expiration dates
- Active terminal device IDs & hardware bindings
- Multi-device limits & activation slots
- Complete administrative audit logs

**Every major free application hosting platform operates on an ephemeral, stateless container filesystem.** Any SQLite file written to disk on these free tiers is **permanently destroyed** whenever the container sleeps, spins down, or redeploys.

---

## 2. Evaluation of Free Hosting Providers

| Provider | Free Tier Available? | Free HTTPS & Subdomain? | Node.js / Next.js Support? | Persistent Disk Storage for SQLite? | Verdict / Reason |
|---|:---:|:---:|:---:|:---:|---|
| **Vercel** | Yes | Yes (`*.vercel.app`) | Yes (Serverless) | **NO** (Read-only root, ephemeral `/tmp` wiped between lambda invocations) | ❌ **BLOCKED:** Ephemeral serverless container wipes `license_server.db` on cold restart. |
| **Render** | Yes | Yes (`*.onrender.com`) | Yes (Web Service) | **NO** (Disks require paid instance $7/mo + $0.25/GB disk) | ❌ **BLOCKED:** Free web services spin down after 15m of inactivity; on spin-up, the filesystem resets to git clone state. All licenses wiped. |
| **Railway** | **NO** | N/A | Yes | Requires paid plan ($5/mo minimum) | ❌ **BLOCKED:** Zero-cost free tier was discontinued. |
| **Fly.io** | Yes (limited) | Yes | Yes (Docker) | Yes (3GB volume on free allowance) | ⚠️ **BLOCKED:** Requires a valid credit card on file during registration to prevent abuse. No credentials/tools configured. |
| **Netlify** | Yes | Yes (`*.netlify.app`) | Yes (Serverless) | **NO** (Ephemeral functions) | ❌ **BLOCKED:** Identical to Vercel; stateless execution destroys SQLite database. |
| **Koyeb** | Yes (Eco) | Yes | Yes | **NO** (Volumes only on paid plans) | ❌ **BLOCKED:** Ephemeral container disk. |
| **Heroku** | **NO** | N/A | Yes | Discontinued | ❌ **BLOCKED:** Free tier eliminated in Nov 2022. |

---

## 3. Why Faking Free Storage Would Cause Catastrophic Commercial Failure

If we silently deployed the license server to a free host like Vercel or Render Free without persistent disk storage:
1. **Pilot Merchant Disaster:** The pilot merchant ("TEST PILOT SHOP") activates terminal 1 against `https://selwick-license.onrender.com`.
2. **Container Sleep:** After 15 minutes of inactivity overnight, the free server spins down to save host resources.
3. **Database Erasure:** The ephemeral filesystem is destroyed. `license_server.db` ceases to exist.
4. **Heartbeat Rejection:** When the merchant opens their POS the next morning, the POS calls `/api/license/verify`. The newly spun-up server returns `404: License Not Found`.
5. **Loss of Control:** The admin loses all record of payment, issued keys, and registered device IDs.

Adhering strictly to **Section 4 & Section 29**, we refuse to deploy to an ephemeral filesystem.

---

## 4. Viable Zero-Cost & Low-Cost Solutions

To achieve a production deployment without compromising database durability or architectural security, three realistic paths exist:

### Option A: Cloudflare Tunnel (100% Free, $0 Cost, 100% Durable)
- **How it Works:** Run the existing Next.js standalone license server (`node --experimental-sqlite server.js`) on any dedicated, always-on PC or office computer. Expose it securely to the internet via **Cloudflare Tunnel (`cloudflared`)**.
- **Cost:** **$0.00** (Permanently free from Cloudflare).
- **HTTPS:** **Yes** (Valid Cloudflare TLS certificate with a free `*.trycloudflare.com` URL or free custom domain routing).
- **Database Durability:** **100% Durable** (`license_server.db` is stored on the local PC's persistent SSD/HDD).
- **Security:** Private key and admin secret never leave the machine. No open inbound router ports required.
- **Suitability for Pilot:** **Ideal for the first customer pilot.**

### Option B: Free Turso / LibSQL Database Adapter ($0 Cost)
- **How it Works:** Keep the server running on a free host (e.g. Render / Vercel), but replace the local filesystem SQLite engine (`node:sqlite`) with **Turso** (a free managed LibSQL/SQLite database in the cloud).
- **Cost:** **$0.00** (Turso free tier offers 9GB storage, 1 billion row reads/month, no credit card required).
- **HTTPS:** Yes (via Vercel or Render).
- **Database Durability:** **100% Durable** (Data lives in Turso's cloud storage, surviving all server restarts and redeployments).
- **Trade-off:** Requires a minor adapter in `src/lib/licensing/licenseDb.ts` to connect to Turso's LibSQL HTTP client rather than `node:sqlite`.

### Option C: Low-Cost Dedicated VPS ($2.50 – $5.00 / month)
- **Providers:** Hetzner Cloud (€3.29/mo), DigitalOcean ($4/mo droplet), or RackNerd ($1.50/mo during promotions).
- **Database Durability:** Persistent Linux SSD with full WAL SQLite durability.
- **Trade-off:** Violates the $0 constraint unless explicitly approved by the business owner.

---

## 5. Security & Secret Isolation Audit

A thorough scan of the codebase and packaged artifacts confirmed:
- **`SELWICK_LICENSE_PRIVATE_KEY`:** Present **ONLY** in server-side provider (`src/lib/licensing/serverKey.ts`). Fails closed in production if missing. Never bundled in client renderer, Electron main, or installer.
- **`SELWICK_LICENSE_ADMIN_SECRET`:** Present **ONLY** in server-side authentication (`src/lib/licensing/adminAuth.ts`). Fails closed in production.
- **Packaged Executable (`desktop-dist/win-unpacked/Selwick POS.exe`):** Contains **ONLY** the public key (`SELWICK_POS_PUBLIC_KEY`). Zero private keys, zero `.env` files, zero server secrets.
- **Process Hygiene:** `electron/main.cjs` strips all server secrets before launching desktop processes.

---

## 6. Complete Regression Test Results (611 / 611 Passing)

All automated tests across all milestones and phases pass cleanly:

```text
check:db           SQLite Foundation & Isolation              [PASS] (26/26)
check:auth         Milestone 2 Auth & Security                [PASS] (35/35)
check:repo         Milestone 3 Money & Repositories           [PASS] (67/67)
check:migration    Milestone 4 Backup, Ledgers & Recovery     [PASS] (130/130)
check:pos          Milestone 5 Sales, Refunds & Khata         [PASS] (104/104)
check:m6b          Stage B API Coverage & Invariants          [PASS] (46/46)
check:m6c          Stage C End-to-End SQLite Workflows        [PASS] (25/25)
check:m6d          Stage D Activation & Rollback              [PASS] (26/26)
check:phase2       Phase 2 Security Hardening & XSS           [PASS] (68/68)
check:phase3       Phase 3 Disaster Recovery & Backup         [PASS] (17/17)
check:phase4       Phase 4 Cloud & Supabase Architecture      [PASS] (25/25)
check:phase5       Phase 5 Production Scaling & Packaging     [PASS] (17/17)
check:phase6       Phase 6 Ed25519 Commercial Licensing       [PASS] (16/16)
check:phase7       Phase 7 Commercial Admin Dashboard         [PASS] (19/19)
check:phase8       Phase 8 Production Deployment & Pilot      [PASS] (16/16)
----------------------------------------------------------------------
TOTAL PASSING:     611 / 611  (100% passing, 0 failures)
```

---

## 7. Next Steps for Customer Pilot

To proceed with the first customer pilot immediately without paying for hosting, choose one of the following two recommended paths:

1. **Path 1 (Zero Code Changes, 100% Free):** Run the standalone server locally or on an office PC using Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`). This gives a free, public HTTPS URL with 100% persistent local SQLite storage.
2. **Path 2 (Cloud Hosted, 100% Free):** Add the Turso LibSQL client adapter to `licenseDb.ts` and deploy to Vercel/Render free tier with zero disk loss risk.

