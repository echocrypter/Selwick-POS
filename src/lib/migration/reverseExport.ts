/**
 * Selwick POS – SQLite-to-LocalStorage Reverse Export Engine.
 *
 * Reconstructs exact legacy LocalStorage format from SQLite for emergency recovery and rollback.
 * Reports any fields or records that cannot be represented cleanly in legacy schema.
 */

import { type DatabaseSync } from 'node:sqlite';
import { fromCents } from '../money.ts';
import { type OfflineMember } from '../offlineUsers.ts';
import { type Product, type Customer, type Sale, type CartItem, type HeldSale } from '../../types/pos.ts';
import {
  type ReverseExportReport,
  type MigrationCollectionCounts,
  type ExpenseRecord,
} from './types.ts';

export function exportSqliteToLocalStorage(
  db: DatabaseSync,
  businessId: string,
  options: { origin?: string } = {},
): ReverseExportReport {
  const unrepresentableData: ReverseExportReport['unrepresentableData'] = [];
  const origin = options.origin || 'http://127.0.0.1:3456';

  // 1. Check Business Record
  const bizStmt = db.prepare('SELECT id, name, business_type FROM businesses WHERE id = ?');
  const bizRow = bizStmt.get(businessId) as { id: string; name: string; business_type: string } | undefined;
  const businessType = bizRow?.business_type || 'retail';

  // 2. Offline Staff Users
  const usersStmt = db.prepare(`
    SELECT id, business_id, name, role, salt, hash
    FROM users
    WHERE business_id = ?
    ORDER BY created_at ASC
  `);
  const userRows = usersStmt.all(businessId) as Array<{
    id: string;
    business_id: string;
    name: string;
    role: string;
    salt: string;
    hash: string;
  }>;

  const users: OfflineMember[] = userRows.map((u) => ({
    id: u.id,
    businessId: u.business_id,
    name: u.name,
    role: (['owner', 'manager', 'cashier'].includes(u.role) ? u.role : 'cashier') as OfflineMember['role'],
    salt: u.salt,
    hash: u.hash,
  }));

  // 3. Categories
  const catStmt = db.prepare(`
    SELECT name
    FROM categories
    WHERE business_id = ?
    ORDER BY display_order ASC, name ASC
  `);
  const catRows = catStmt.all(businessId) as Array<{ name: string }>;
  const categories = catRows.map((c) => c.name);

  // 4. Products
  const prodStmt = db.prepare(`
    SELECT id, name, sku, barcode, category, price_cents, cost_price_cents,
           stock, min_stock_alert, description, badge, icon_type
    FROM products
    WHERE business_id = ?
    ORDER BY name ASC
  `);
  const prodRows = prodStmt.all(businessId) as Array<{
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    category: string;
    price_cents: number;
    cost_price_cents: number;
    stock: number;
    min_stock_alert: number;
    description: string | null;
    badge: string | null;
    icon_type: string;
  }>;

  const products: Product[] = prodRows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    barcode: p.barcode || '',
    category: p.category,
    price: fromCents(p.price_cents),
    costPrice: fromCents(p.cost_price_cents),
    stock: p.stock,
    minStockAlert: p.min_stock_alert,
    description: p.description || undefined,
    badge: p.badge || undefined,
    iconType: (p.icon_type as Product['iconType']) || 'other',
  }));

  // 5. Customers
  const custStmt = db.prepare(`
    SELECT id, name, phone, email, address, balance_cents,
           loyalty_points, total_orders, total_spent_cents, created_at
    FROM customers
    WHERE business_id = ?
    ORDER BY name ASC
  `);
  const custRows = custStmt.all(businessId) as Array<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    balance_cents: number;
    loyalty_points: number;
    total_orders: number;
    total_spent_cents: number;
    created_at: string;
  }>;

  const customers: Customer[] = custRows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email || undefined,
    address: c.address || undefined,
    balance: fromCents(c.balance_cents),
    loyaltyPoints: c.loyalty_points,
    totalOrders: c.total_orders,
    totalSpent: fromCents(c.total_spent_cents),
    createdAt: c.created_at,
  }));

  // 6. Expenses
  const expStmt = db.prepare(`
    SELECT id, date, category, description, amount_cents
    FROM expenses
    WHERE business_id = ?
    ORDER BY date DESC
  `);
  const expRows = expStmt.all(businessId) as Array<{
    id: string;
    date: string;
    category: string;
    description: string;
    amount_cents: number;
  }>;

  const expenses: ExpenseRecord[] = expRows.map((e) => ({
    id: e.id,
    date: e.date,
    category: e.category,
    description: e.description,
    amount: fromCents(e.amount_cents),
  }));

  // 7. Sales & Sale Items
  const salesStmt = db.prepare(`
    SELECT id, invoice_number, timestamp, date_str, subtotal_cents,
           discount_cents, discount_type, tax_cents, total_cents,
           payment_method, amount_tendered_cents, change_due_cents,
           customer_id, customer_name, customer_phone, notes,
           terminal_id, status
    FROM sales
    WHERE business_id = ?
    ORDER BY timestamp ASC
  `);
  const saleRows = salesStmt.all(businessId) as Array<{
    id: string;
    invoice_number: string;
    timestamp: string;
    date_str: string;
    subtotal_cents: number;
    discount_cents: number;
    discount_type: string;
    tax_cents: number;
    total_cents: number;
    payment_method: string;
    amount_tendered_cents: number;
    change_due_cents: number;
    customer_id: string | null;
    customer_name: string;
    customer_phone: string | null;
    notes: string | null;
    terminal_id: string;
    status: string;
  }>;

  const itemsStmt = db.prepare(`
    SELECT id, sale_id, product_id, product_name, product_sku, product_barcode,
           category, quantity, price_cents, cost_price_cents, discount_cents, custom_price_cents
    FROM sale_items
    WHERE sale_id = ?
  `);

  let totalExportedSaleItems = 0;
  const sales: Sale[] = [];

  for (const s of saleRows) {
    if (s.invoice_number.includes('_MIG_')) {
      unrepresentableData.push({
        itemType: 'sale',
        itemId: s.id,
        field: 'invoice_number',
        detail: `Sale invoice "${s.invoice_number}" was remapped during SQLite migration to prevent duplicate collision.`,
      });
    }

    const itemRows = itemsStmt.all(s.id) as Array<{
      id: string;
      sale_id: string;
      product_id: string | null;
      product_name: string;
      product_sku: string | null;
      product_barcode: string | null;
      category: string | null;
      quantity: number;
      price_cents: number;
      cost_price_cents: number;
      discount_cents: number;
      custom_price_cents: number | null;
    }>;

    totalExportedSaleItems += itemRows.length;

    const cartItems: CartItem[] = itemRows.map((it) => ({
      product: {
        id: it.product_id || crypto.randomUUID(),
        name: it.product_name,
        sku: it.product_sku || '',
        barcode: it.product_barcode || '',
        category: it.category || 'General',
        price: fromCents(it.price_cents),
        costPrice: fromCents(it.cost_price_cents),
        stock: 0,
        minStockAlert: 5,
        iconType: 'other',
      },
      quantity: it.quantity,
      discount: fromCents(it.discount_cents),
      customPrice: it.custom_price_cents !== null ? fromCents(it.custom_price_cents) : undefined,
    }));

    sales.push({
      id: s.id,
      invoiceNumber: s.invoice_number,
      timestamp: s.timestamp,
      dateStr: s.date_str,
      items: cartItems,
      subtotal: fromCents(s.subtotal_cents),
      discount: fromCents(s.discount_cents),
      discountType: s.discount_type === 'percent' ? 'percent' : 'fixed',
      tax: fromCents(s.tax_cents),
      total: fromCents(s.total_cents),
      paymentMethod: s.payment_method as Sale['paymentMethod'],
      amountTendered: fromCents(s.amount_tendered_cents),
      changeDue: fromCents(s.change_due_cents),
      customerId: s.customer_id || undefined,
      customerName: s.customer_name,
      customerPhone: s.customer_phone || undefined,
      notes: s.notes || undefined,
      terminalId: s.terminal_id,
      status: (['completed', 'refunded', 'cancelled'].includes(s.status) ? s.status : 'completed') as Sale['status'],
    });
  }

  // 8. Held Sales
  const heldStmt = db.prepare(`
    SELECT id, invoice_number, date_str, timestamp, customer_json, note, items_json
    FROM held_sales
    WHERE business_id = ?
    ORDER BY timestamp DESC
  `);
  const heldRows = heldStmt.all(businessId) as Array<{
    id: string;
    invoice_number: string;
    date_str: string;
    timestamp: number;
    customer_json: string | null;
    note: string | null;
    items_json: string;
  }>;

  const heldSales: HeldSale[] = heldRows.map((h) => {
    let customer: Customer | undefined;
    let items: CartItem[] = [];
    try {
      if (h.customer_json) customer = JSON.parse(h.customer_json);
    } catch { /* ignore */ }
    try {
      items = JSON.parse(h.items_json);
    } catch { /* ignore */ }

    return {
      id: h.id,
      invoiceNumber: h.invoice_number,
      dateStr: h.date_str,
      timestamp: h.timestamp,
      items,
      customer,
      note: h.note || undefined,
    };
  });

  // 9. Settings
  const setStmt = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE business_id = ?
  `);
  const setRows = setStmt.all(businessId) as Array<{ key: string; value: string }>;
  const settingsObj: Record<string, unknown> = {};
  for (const s of setRows) {
    try {
      settingsObj[s.key] = JSON.parse(s.value);
    } catch {
      settingsObj[s.key] = s.value;
    }
  }

  // Assemble Data Dictionary for LocalStorage
  const data: Record<string, string> = {};
  const prefix = `selwick_business:${businessId}:`;

  data[`${prefix}pos_products`] = JSON.stringify(products);
  data[`${prefix}pos_customers`] = JSON.stringify(customers);
  data[`${prefix}pos_sales`] = JSON.stringify(sales);
  data[`${prefix}pos_expenses`] = JSON.stringify(expenses);
  data[`${prefix}pos_categories`] = JSON.stringify(categories);
  data[`${prefix}pos_held`] = JSON.stringify(heldSales);
  data[`${prefix}pos_settings`] = JSON.stringify(settingsObj);
  data[`${prefix}selwick_offline_business_type`] = businessType;

  // Active business pointer for frontend offline selection
  data['selwick_active_offline_business_v1'] = businessId;

  // If exporting the legacy business, also populate unscoped legacy keys for full backward compatibility
  if (businessId === 'legacy-installation') {
    data['pos_products'] = JSON.stringify(products);
    data['pos_customers'] = JSON.stringify(customers);
    data['pos_sales'] = JSON.stringify(sales);
    data['pos_expenses'] = JSON.stringify(expenses);
    data['pos_categories'] = JSON.stringify(categories);
    data['pos_held'] = JSON.stringify(heldSales);
    data['pos_settings'] = JSON.stringify(settingsObj);
    data['selwick_offline_business_type'] = businessType;
  }

  if (users.length > 0) {
    data['selwick_offline_users_v1'] = JSON.stringify(users);
  }

  const exportedCounts: MigrationCollectionCounts = {
    users: users.length,
    categories: categories.length,
    products: products.length,
    customers: customers.length,
    sales: sales.length,
    saleItems: totalExportedSaleItems,
    expenses: expenses.length,
    heldSales: heldSales.length,
    settings: Object.keys(settingsObj).length > 0 ? 1 : 0,
  };

  return {
    success: true,
    businessId,
    payload: {
      format: 'selwick-localstorage-v1',
      exportedAt: new Date().toISOString(),
      sourceOrigin: origin,
      app: 'selwick-pos',
      totalKeys: Object.keys(data).length,
      data,
    },
    exportedCounts,
    unrepresentableData,
  };
}
