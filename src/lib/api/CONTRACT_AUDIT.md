# Selwick POS — Milestone 6 Frontend-to-Backend API Contract & Parity Audit

## 1. Executive Summary

This document establishes the comprehensive frontend-to-backend API contract, LocalStorage usage audit, and feature parity mapping for Selwick POS ahead of Milestone 6 frontend cutover.

As mandated by Milestone 6 Stage A guidelines:
- The active data layer remains **legacy LocalStorage by default**.
- SQLite APIs are integrated via an abstracted client layer with dual-mode isolation.
- No live buttons or workflows switch to SQLite mode until Stage B.
- No existing LocalStorage records are cleared, modified, or overwritten.

---

## 2. Frontend LocalStorage Audit (All Reads & Writes)

| Collection / Domain | Frontend Storage Key(s) | Read Locations | Write Locations | Data Format | Currency Unit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Products & Inventory** | `pos_products`<br>`selwick_business:<id>:pos_products` | `src/app/page.tsx:405`<br>`src/components/pos/InventoryView.tsx` | `src/app/page.tsx:631`<br>`src/app/page.tsx:1028` | JSON Array of `Product` | Rupees (`price`, `costPrice`) |
| **Categories** | `pos_categories`<br>`selwick_business:<id>:pos_categories` | `src/app/page.tsx:414`<br>`src/components/pos/InventoryView.tsx` | `src/app/page.tsx:661`<br>`src/app/page.tsx:1082` | JSON Array of `Category` | N/A |
| **Customers & Khata** | `pos_customers`<br>`selwick_business:<id>:pos_customers` | `src/app/page.tsx:406`<br>`src/components/pos/CustomersView.tsx` | `src/app/page.tsx:636`<br>`src/app/page.tsx:922` | JSON Array of `Customer` | Rupees (`balance`, `totalSpent`) |
| **Sales & Receipts** | `pos_sales`<br>`selwick_business:<id>:pos_sales` | `src/app/page.tsx:407`<br>`src/components/pos/SalesHistoryView.tsx` | `src/app/page.tsx:641`<br>`src/app/page.tsx:938` | JSON Array of `Sale` | Rupees (`total`, `subtotal`, `tax`) |
| **Refunds** | Mutates `pos_sales` (`status = 'refunded'`) | `src/components/pos/SalesHistoryView.tsx` | `src/app/page.tsx:976` | Status flag in `Sale` | Rupees |
| **Held Sales** | `pos_held`<br>`selwick_business:<id>:pos_held` | `src/app/page.tsx:413`<br>`src/components/pos/HeldSalesModal.tsx` | `src/app/page.tsx:656`<br>`src/app/page.tsx:684` | JSON Array of `HeldSale` | Rupees (`items`, `customer`) |
| **Expenses** | `pos_expenses`<br>`selwick_business:<id>:pos_expenses` | `src/app/page.tsx:408`<br>`src/components/pos/ExpensesReportsView.tsx` | `src/app/page.tsx:646`<br>`src/app/page.tsx:1120` | JSON Array of `BusinessExpense` | Rupees (`amount`) |
| **Store Settings** | `pos_settings`<br>`selwick_business:<id>:pos_settings` | `src/app/page.tsx:412`<br>`src/components/pos/SettingsView.tsx` | `src/app/page.tsx:651`<br>`src/app/page.tsx:1140` | JSON Object of `StoreSettings` | Tax % & Currency Symbol |
| **Business Scope** | `selwick_offline_business_type`<br>`selwick_active_offline_business_v1` | `src/app/page.tsx:415`<br>`src/lib/offlineBusinessStorage.ts:9` | `src/lib/offlineBusinessStorage.ts:5`<br>`src/components/pos/BusinessSetupModal.tsx` | String business ID / Type | N/A |
| **Staff & Auth** | `selwick_offline_users_v1` | `src/lib/offlineUsers.ts:5`<br>`src/components/pos/OfflineStaff.tsx:50` | `src/components/pos/OfflineStaff.tsx:78`<br>`src/components/pos/OfflineStaff.tsx:165` | JSON Array of `OfflineMember` | N/A (PIN hash + salt) |
| **Backup Ledger** | `selwick_last_backup_date`<br>`selwick_last_backup_timestamp` | `src/utils/localBackup.ts:176` | `src/utils/localBackup.ts:220` | ISO Timestamp string | N/A |
| **Cloud Config** | `pos_cloud_config` | `src/components/pos/CloudSyncSettings.tsx:38` | `src/components/pos/CloudSyncSettings.tsx:51` | JSON object (`url`, `key`) | N/A |

---

## 3. Existing SQLite Backend Endpoints

The following SQLite endpoints have been built, remediated, and verified in Milestones 1–5:

1. **Authentication & Session Management**:
   - `POST /api/auth/login`: Authenticates with PIN/username, creates session token, updates persistent SQLite rate limiter.
   - `POST /api/auth/logout`: Revokes current SQLite session token.
   - `POST /api/auth/register`: Owner/Manager registration of staff accounts with role-based checks.
   - `GET /api/auth/session`: Validates session cookie, returns user role and business scope.

2. **Durable Backup & Migration**:
   - `POST /api/migration/backup`: Generates SHA-256 integrity-verified LocalStorage backup in `.data/backups/`.
   - `POST /api/migration/verify-backup`: Audits backup file integrity without writing to SQLite.
   - `POST /api/migration/import`: Atomic, transactional import with financial verification and pre-commit rollback.
   - `POST /api/migration/reverse-export`: Generates clean, compatible LocalStorage reverse export for emergency rollback.

3. **POS Checkout & Refunds**:
   - `POST /api/pos/checkout`: Single-transaction checkout with in-lock composite idempotency, stock deductions, monetary invariant validation, customer credit ledger updates, and collision-free invoice numbering.
   - `POST /api/pos/refund`: Dedicated append-only refund ledger recording, stock restoration, FIFO credit debt reversal, cash down payment refunding, and duplicate refund prevention.

---

## 4. Gap Analysis: Missing SQLite Endpoints for Complete Cutover

While Checkout, Refunds, Auth, and Migration are fully implemented in SQLite, several CRUD and query workflows currently rely entirely on in-memory React state synced to LocalStorage. Before legacy LocalStorage can be retired, the following endpoints or data access operations must be implemented:

| Feature Area | Current Frontend LocalStorage Workflow | Missing SQLite Backend Route | SQLite Table Available? | Action Required in Milestone 6 |
| :--- | :--- | :--- | :--- | :--- |
| **Product Catalog** | Reads `pos_products` on boot; writes updated array on edit/add/delete | `GET /api/pos/products`<br>`POST /api/pos/products`<br>`PUT /api/pos/products/:id`<br>`DELETE /api/pos/products/:id` | **YES** (`products`) | Implement RESTful route handlers wrapping `productRepository.ts` |
| **Category Management**| Reads `pos_categories`; saves ordered array | `GET /api/pos/categories`<br>`POST /api/pos/categories`<br>`PUT /api/pos/categories/reorder` | **YES** (`categories`) | Implement category route handlers wrapping `categoryRepository.ts` |
| **Customer Management**| Reads `pos_customers`; updates phone/name/notes | `GET /api/pos/customers`<br>`POST /api/pos/customers`<br>`PUT /api/pos/customers/:id` | **YES** (`customers`) | Implement customer route handlers wrapping `customerRepository.ts` |
| **Khata Settlements** | Directly decrements `customer.balance` in frontend state | `POST /api/pos/khata/settle`<br>`GET /api/pos/khata/ledger/:customerId` | **YES** (`khata_settlements`, `credit_sales_ledger`) | Implement endpoint wrapping `khataEngine.ts` |
| **Expense Tracking** | Appends to `pos_expenses` in LocalStorage | `GET /api/pos/expenses`<br>`POST /api/pos/expenses`<br>`DELETE /api/pos/expenses/:id` | **YES** (`expenses`) | Implement expense route handlers wrapping `expenseRepository.ts` |
| **Store Settings** | Reads and writes `pos_settings` JSON | `GET /api/pos/settings`<br>`PUT /api/pos/settings` | **YES** (`settings`) | Implement settings route handlers wrapping `settingsRepository.ts` |
| **Held Carts** | Saves active carts in `pos_held` | `GET /api/pos/held`<br>`POST /api/pos/held`<br>`DELETE /api/pos/held/:id` | **YES** (`held_sales`) | Implement held cart route handlers |
| **Sales & Reports** | Loops through in-memory `pos_sales` in React | `GET /api/pos/sales`<br>`GET /api/pos/reports/summary` | **YES** (`sales`, `sale_items`) | Implement query endpoints for sales history pagination and reporting aggregates |

---

## 5. Bidirectional Rupees <-> Paisa Adapter Rules

To avoid floating-point drift and schema mismatches between frontend Rupees and backend integer Paisa:

1. **Currency Invariant**:
   - `1 Rupee === 100 Paisa` (1.00 PKR = 100 integer cents/paisa).
   - Conversions from frontend Rupees to backend Paisa use `toCents(amount, false)` (string-split arithmetic, no IEEE 754 precision artifacts).
   - Conversions from backend Paisa to frontend Rupees use `fromCents(cents)`.
2. **Discounts**:
   - Fixed discounts: Converted via `toCents(discountRupees)` to `discountValue`.
   - Percentage discounts: Handled as integer basis or percentage points (e.g. 15 for 15%).
3. **Taxes**:
   - Backend expects `enableTax: boolean` and `taxRatePercent: number`.
4. **Idempotency Keys**:
   - The frontend API client generates a stable UUID v4 idempotency key per checkout / refund user action.
   - Retries for network timeouts or `SQLITE_BUSY` MUST reuse the exact same key.
   - Initiating a new transaction (e.g. modifying the cart) MUST issue a new key.

---

## 6. Stage B Implementation Status & Frontend Contract Parity

All endpoints identified in the Milestone 6 Stage A Gap Analysis have now been implemented and authenticated in Stage B:

1. **Products & Inventory**:
   - `GET /api/pos/products`: Lists products with search, category, active filters. Returns domain `Product[]`.
   - `POST /api/pos/products`: Creates product. Price/cost can be provided in Rupees (`price`) or integer Paisa (`priceCents`).
   - `PUT /api/pos/products/[id]`: Updates product fields.
   - `DELETE /api/pos/products/[id]`: Hard deletion is blocked with 409 Conflict if historical sales exist in `sale_items`.
   - `POST /api/pos/products/[id]/archive`: Sets `is_active = 0` safely preserving sales history.

2. **Categories**:
   - `GET /api/pos/categories`, `POST /api/pos/categories`, `PUT /api/pos/categories/[id]`, `DELETE /api/pos/categories/[id]`, `PUT /api/pos/categories/reorder`. Case-insensitive duplicate name conflict enforcement.

3. **Customers & Ledger**:
   - `GET /api/pos/customers`, `POST /api/pos/customers`, `PUT /api/pos/customers/[id]`.
   - **Balance Invariant**: `balance`, `balanceCents`, and `balance_cents` cannot be updated via ordinary customer edits.
   - `GET /api/pos/customers/[id]/ledger`: Returns full ledger breakdown (credit sales, khata settlements, allocations, refunds).

4. **Khata Settlements**:
   - `POST /api/pos/khata/settle`: Enforces mandatory idempotency key, FIFO settlement allocation, amount validation (cannot exceed debt), and records cashier ID.
   - `GET /api/pos/khata/ledger/[customerId]`: Retrieves historical settlements and allocations.

5. **Expenses**:
   - `GET /api/pos/expenses`, `POST /api/pos/expenses`.
   - `DELETE /api/pos/expenses/[id]`: Manager/Owner only; returns deleted snapshot and audit metadata.

6. **Settings**:
   - `GET /api/pos/settings`, `PUT /api/pos/settings`: Validates tax rate, default discount, and store name.

7. **Held Sales**:
   - `GET /api/pos/held`, `POST /api/pos/held`, `GET /api/pos/held/[id]`, `PUT /api/pos/held/[id]`, `DELETE /api/pos/held/[id]`: Full cart serialization without inventory deduction.

8. **Sales & Reports**:
   - `GET /api/pos/sales`: Paginated sales list with items and customer details.
   - `GET /api/pos/sales/[id]`: Sale detail with items, refund ledger, and credit ledger.
   - `GET /api/pos/reports/summary`: Financial summary distinguishing gross sales, discounts, tax, cash actually received, credit receivables, Khata settlements, physical cash refund payouts, pending electronic reversals, expenses, and net cash flow.

**Remaining Gaps Ahead of Stage C/D**:
- Active frontend remains on legacy LocalStorage (`getDataAccessMode() === 'localstorage'`).
- Live checkout and refund buttons remain on client/Supabase handlers until cutover.
