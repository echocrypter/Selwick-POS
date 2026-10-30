/**
 * Selwick POS Database Schema Definitions and Migration DDL.
 * Foundation tables, constraints, integer monetary units, and performance indexes.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export const INITIAL_MIGRATION_NAME = '001_foundation_tables';

export const INITIAL_MIGRATION_SQL = `
-- 1. Schema Migrations Ledger
CREATE TABLE IF NOT EXISTS _schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Businesses
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'retail',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Offline Staff Accounts
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'cashier')),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'cashier')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Product Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(business_id, name)
);

-- 6. Products / Inventory (Prices in Integer Minor Units / Paisa / Cents)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  cost_price_cents INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock_alert INTEGER NOT NULL DEFAULT 5,
  description TEXT,
  badge TEXT,
  icon_type TEXT NOT NULL DEFAULT 'other',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Sales Master Table
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  idempotency_key TEXT,
  timestamp TEXT NOT NULL,
  date_str TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed', 'percent')),
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  amount_tendered_cents INTEGER NOT NULL,
  change_due_cents INTEGER NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  notes TEXT,
  terminal_id TEXT NOT NULL,
  cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  cashier_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('completed', 'refunded', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, invoice_number),
  UNIQUE (business_id, idempotency_key)
);

-- 9. Sale Line Items (Normalized from CartItem[])
CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  product_barcode TEXT,
  category TEXT,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  cost_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  custom_price_cents INTEGER
);

-- 10. Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Held Sales (Parked Carts)
CREATE TABLE IF NOT EXISTS held_sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  date_str TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  customer_json TEXT,
  note TEXT,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. Store Settings (Key-Value per business)
CREATE TABLE IF NOT EXISTS settings (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, key)
);

-- 13. API Idempotency Keys (Deduplication per business)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  request_hash TEXT,
  response_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, key)
);

-- 14. Durable File-System Backup Ledger
CREATE TABLE IF NOT EXISTS durable_backup_ledger (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  total_records INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 15. Persistent Rate Limiting Ledger
CREATE TABLE IF NOT EXISTS login_attempts (
  identity_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  locked_until INTEGER
);

-- 16. Invoice Sequences (Monotonic sequencing per business and day)
CREATE TABLE IF NOT EXISTS invoice_sequences (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date_str TEXT NOT NULL,
  current_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, date_str)
);

-- 17. Dedicated Append-Only Refund Ledger
CREATE TABLE IF NOT EXISTS refund_ledger (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payout_method TEXT NOT NULL,
  cash_payout_cents INTEGER NOT NULL DEFAULT 0,
  debt_reversal_cents INTEGER NOT NULL DEFAULT 0,
  terminal_id TEXT,
  reason TEXT NOT NULL,
  idempotency_key TEXT,
  payout_status TEXT NOT NULL CHECK(payout_status IN ('completed', 'pending_manual_reversal')),
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 18. Credit Sales Ledger (Tracks original debt and settled portions per credit sale)
CREATE TABLE IF NOT EXISTS credit_sales_ledger (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  original_credit_cents INTEGER NOT NULL,
  settled_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('open', 'settled', 'refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 19. Khata Settlements (Durably records customer debt payments)
CREATE TABLE IF NOT EXISTS khata_settlements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 20. Khata Settlement Allocations (Deterministic invoice-level payment allocations)
CREATE TABLE IF NOT EXISTS khata_settlement_allocations (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES khata_settlements(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  allocated_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(business_id, category);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_sales_business_date ON sales(business_id, date_str);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(business_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_idempotency ON sales(business_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_id, date);
CREATE INDEX IF NOT EXISTS idx_held_sales_business ON held_sales(business_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_business_key ON idempotency_keys(business_id, key);
CREATE INDEX IF NOT EXISTS idx_refund_ledger_business ON refund_ledger(business_id);
CREATE INDEX IF NOT EXISTS idx_refund_ledger_sale ON refund_ledger(sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_ledger_idem ON refund_ledger(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_sales_lookup ON credit_sales_ledger(business_id, customer_id, status);
CREATE INDEX IF NOT EXISTS idx_khata_settlements_cust ON khata_settlements(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_allocations_sale ON khata_settlement_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_allocations_settlement ON khata_settlement_allocations(settlement_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts(locked_until);
`;
