/**
 * Selwick POS — Data-access layer
 *
 * Production operational ledger is always SQLite via authenticated Next.js APIs.
 * localStorage is not an authoritative source for sales, stock, money, or inventory.
 * A LocalStorage provider remains only as a read helper for leftover migration snapshots.
 */

import {
  getBusinessItem,
  setBusinessItem,
  removeBusinessItem,
} from '../offlineBusinessStorage';
import { readUsers, OfflineMember } from '../offlineUsers';
import { posApiClient, PosApiClient } from '../api/posApiClient';
import {
  toBackendCheckoutPayload,
  fromBackendCheckoutResult,
  toBackendRefundPayload,
  fromBackendRefundResult,
  FrontendCheckoutParams,
  FrontendRefundParams,
  FrontendRefundResult,
} from '../api/adapters';
import { Product, Customer, Sale, StoreSettings, HeldSale } from '../../types/pos';
import type { BusinessExpense } from '../../components/pos/ExpensesReportsView';

export type Category = string;

export type DataAccessMode = 'localstorage' | 'sqlite';

const DATA_ACCESS_MODE_KEY = 'selwick_data_access_mode_v1';
const TEST_SQLITE_MODE_KEY = 'selwick_test_sqlite_mode_v1';
const MIGRATION_ACTIVATION_KEY = 'selwick_migration_activated_v1';

export const TEST_SQLITE_BUSINESS_ID = 'test-sqlite-isolated-biz';

/**
 * Returns true if the isolated test SQLite mode is currently active.
 */
export function isTestSqliteModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage?.getItem(TEST_SQLITE_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}
/**
 * Returns true when an Owner has explicitly activated the SQLite cutover.
 */
export function isMigrationActivated(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(MIGRATION_ACTIVATION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMigrationActivated(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) window.localStorage?.setItem(MIGRATION_ACTIVATION_KEY, 'true');
    else window.localStorage?.removeItem(MIGRATION_ACTIVATION_KEY);
  } catch (err) {
    console.warn('[MIGRATION] Could not persist activation flag:', err);
  }
}

/**
 * Toggles isolated test SQLite mode.
 * Activates SQLite mode ONLY for the disposable test business;
 * leaves real LocalStorage business data untouched.
 */
export function setTestSqliteMode(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.sessionStorage?.setItem(TEST_SQLITE_MODE_KEY, 'true');
      window.sessionStorage?.setItem(DATA_ACCESS_MODE_KEY, 'sqlite');
    } else {
      window.sessionStorage?.removeItem(TEST_SQLITE_MODE_KEY);
      window.sessionStorage?.removeItem(DATA_ACCESS_MODE_KEY);
      window.localStorage?.removeItem(DATA_ACCESS_MODE_KEY);
    }
  } catch (err) {
    console.warn('[TEST_MODE] Error setting test mode:', err);
  }
}

/**
 * Returns current operational data access mode.
 * Production always uses SQLite. Browser flags cannot switch the financial ledger.
 */
export function getDataAccessMode(): DataAccessMode {
  return 'sqlite';
}

/**
 * Explicitly sets data access mode.
 * Restricted to Owner-controlled workflows in non-production verification environments.
 */
export function setDataAccessMode(_mode: DataAccessMode): void {
  // Ledger selection is architectural. localStorage cannot switch production data mode.
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem(DATA_ACCESS_MODE_KEY, 'sqlite');
    window.localStorage?.removeItem(DATA_ACCESS_MODE_KEY);
  } catch (err) {
    console.warn('[DATA_ACCESS] Could not persist data access mode:', err);
  }
}

/**
 * Abstracted Data Access Interface
 */
export interface IDataAccessLayer {
  getMode(): DataAccessMode;
  checkout(params: FrontendCheckoutParams, idempotencyKey?: string): Promise<Sale>;
  refund(params: FrontendRefundParams, idempotencyKey?: string): Promise<FrontendRefundResult>;
  getProducts(): Promise<Product[]>;
  saveProducts(products: Product[]): Promise<void>;
  createProduct?(product: Partial<Product>): Promise<Product>;
  updateProduct?(id: string, product: Partial<Product>): Promise<Product>;
  deleteProduct?(id: string): Promise<boolean>;
  archiveProduct?(id: string): Promise<boolean>;
  getCustomers(): Promise<Customer[]>;
  saveCustomers(customers: Customer[]): Promise<void>;
  createCustomer?(customer: Partial<Customer>): Promise<Customer>;
  updateCustomer?(id: string, customer: Partial<Customer>): Promise<Customer>;
  deleteCustomer?(id: string): Promise<boolean>;
  getCustomerLedger?(id: string): Promise<any>;
  getSales(): Promise<Sale[]>;
  saveSales(sales: Sale[]): Promise<void>;
  getSaleDetail?(id: string): Promise<any>;
  getExpenses(): Promise<BusinessExpense[]>;
  saveExpenses(expenses: BusinessExpense[]): Promise<void>;
  createExpense?(expense: Partial<BusinessExpense>): Promise<BusinessExpense>;
  deleteExpense?(id: string): Promise<boolean>;
  getSettings(): Promise<StoreSettings | null>;
  saveSettings(settings: StoreSettings): Promise<void>;
  getCategories(): Promise<Category[]>;
  saveCategories(categories: Category[]): Promise<void>;
  createCategory?(name: string, displayOrder?: number): Promise<any>;
  reorderCategories?(categoryIds: string[]): Promise<any>;
  getHeldSales(): Promise<HeldSale[]>;
  saveHeldSales(held: HeldSale[]): Promise<void>;
  createHeldSale?(held: Partial<HeldSale>): Promise<HeldSale>;
  deleteHeldSale?(id: string): Promise<boolean>;
  settleKhata?(params: { customerId: string; amount: number; paymentMethod?: string; notes?: string; idempotencyKey?: string }): Promise<any>;
  getKhataLedger?(customerId: string): Promise<any>;
  getReportSummary?(params?: { startDate?: string; endDate?: string }): Promise<any>;
  getUsers(): Promise<OfflineMember[]>;
}

/**
 * Legacy LocalStorage Data Access Provider
 * Directly wraps existing offline storage functions without modifying any storage keys.
 */
export class LocalStorageDataProvider implements IDataAccessLayer {
  public getMode(): DataAccessMode {
    return 'localstorage';
  }

  public async checkout(params: FrontendCheckoutParams): Promise<Sale> {
    // In LocalStorage mode, checkout state calculation is handled by page.tsx
    // This is maintained for pure interface parity
    const now = new Date();
    return {
      id: `sale-${now.getTime()}`,
      invoiceNumber: `INV-${now.getTime()}`,
      items: [...params.cart],
      subtotal: params.payment.amountTendered || 0,
      discount: params.discount || 0,
      discountType: params.discountType || 'fixed',
      tax: 0,
      total: params.payment.amountTendered || 0,
      paymentMethod: params.payment.paymentMethod,
      dateStr: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      timestamp: now.toISOString(),
      customerId: params.customer?.id,
      customerName: params.customer?.name || 'Walk-in Customer',
      customerPhone: params.customer?.phone,
      status: 'completed',
      amountTendered: params.payment.amountTendered,
      changeDue: params.payment.changeDue,
      notes: params.payment.notes,
      terminalId: params.terminalId || params.settings.terminalId,
    };
  }

  public async refund(params: FrontendRefundParams): Promise<FrontendRefundResult> {
    return {
      refundId: `ref-local-${Date.now()}`,
      saleId: params.saleId,
      invoiceNumber: 'LOCAL-REFUND',
      status: 'refunded',
      payoutMethod: 'cash_payout',
      cashPayout: 0,
      debtReversed: 0,
      idempotentReplay: false,
    };
  }

  public async getProducts(): Promise<Product[]> {
    const raw = getBusinessItem('pos_products');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveProducts(products: Product[]): Promise<void> {
    setBusinessItem('pos_products', JSON.stringify(products));
  }

  public async getCustomers(): Promise<Customer[]> {
    const raw = getBusinessItem('pos_customers');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveCustomers(customers: Customer[]): Promise<void> {
    setBusinessItem('pos_customers', JSON.stringify(customers));
  }

  public async getSales(): Promise<Sale[]> {
    const raw = getBusinessItem('pos_sales');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveSales(sales: Sale[]): Promise<void> {
    setBusinessItem('pos_sales', JSON.stringify(sales));
  }

  public async getExpenses(): Promise<BusinessExpense[]> {
    const raw = getBusinessItem('pos_expenses');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveExpenses(expenses: BusinessExpense[]): Promise<void> {
    setBusinessItem('pos_expenses', JSON.stringify(expenses));
  }

  public async getSettings(): Promise<StoreSettings | null> {
    const raw = getBusinessItem('pos_settings');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public async saveSettings(settings: StoreSettings): Promise<void> {
    setBusinessItem('pos_settings', JSON.stringify(settings));
  }

  public async getCategories(): Promise<Category[]> {
    const raw = getBusinessItem('pos_categories');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveCategories(categories: Category[]): Promise<void> {
    setBusinessItem('pos_categories', JSON.stringify(categories));
  }

  public async getHeldSales(): Promise<HeldSale[]> {
    const raw = getBusinessItem('pos_held');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async saveHeldSales(held: HeldSale[]): Promise<void> {
    setBusinessItem('pos_held', JSON.stringify(held));
  }

  public async createProduct(product: Partial<Product>): Promise<Product> {
    const list = await this.getProducts();
    const id = product.id || `prod-${Date.now()}`;
    const newProd = { ...product, id } as Product;
    await this.saveProducts([...list, newProd]);
    return newProd;
  }

  public async updateProduct(id: string, product: Partial<Product>): Promise<Product> {
    const list = await this.getProducts();
    const updated = list.map((p) => (p.id === id ? ({ ...p, ...product } as Product) : p));
    await this.saveProducts(updated);
    return updated.find((p) => p.id === id)!;
  }

  public async deleteProduct(id: string): Promise<boolean> {
    const list = await this.getProducts();
    await this.saveProducts(list.filter((p) => p.id !== id));
    return true;
  }

  public async archiveProduct(id: string): Promise<boolean> {
    await this.updateProduct(id, { isActive: false } as any);
    return true;
  }

  public async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    const list = await this.getCustomers();
    const id = customer.id || `cust-${Date.now()}`;
    const newCust = { balance: 0, totalOrders: 0, totalSpent: 0, loyaltyPoints: 0, ...customer, id } as Customer;
    await this.saveCustomers([...list, newCust]);
    return newCust;
  }

  public async updateCustomer(id: string, customer: Partial<Customer>): Promise<Customer> {
    const list = await this.getCustomers();
    const updated = list.map((c) => (c.id === id ? ({ ...c, ...customer } as Customer) : c));
    await this.saveCustomers(updated);
    return updated.find((c) => c.id === id)!;
  }

  public async getCustomerLedger(id: string): Promise<any> {
    const sales = (await this.getSales()).filter((s) => s.customerId === id);
    return { creditSales: sales, settlements: [], allocations: [] };
  }

  public async getSaleDetail(id: string): Promise<any> {
    const sales = await this.getSales();
    return sales.find((s) => s.id === id) || null;
  }

  public async createExpense(expense: Partial<BusinessExpense>): Promise<BusinessExpense> {
    const list = await this.getExpenses();
    const id = expense.id || `exp-${Date.now()}`;
    const newExp = { ...expense, id } as BusinessExpense;
    await this.saveExpenses([...list, newExp]);
    return newExp;
  }

  public async deleteExpense(id: string): Promise<boolean> {
    const list = await this.getExpenses();
    await this.saveExpenses(list.filter((e) => e.id !== id));
    return true;
  }

  public async createCategory(name: string, displayOrder = 0): Promise<any> {
    const list = await this.getCategories();
    if (!list.includes(name)) {
      await this.saveCategories([...list, name]);
    }
    return { name, displayOrder };
  }

  public async reorderCategories(categoryIds: string[]): Promise<any> {
    await this.saveCategories(categoryIds);
    return categoryIds;
  }

  public async createHeldSale(held: Partial<HeldSale>): Promise<HeldSale> {
    const list = await this.getHeldSales();
    const id = held.id || `held-${Date.now()}`;
    const newHeld = { ...held, id } as HeldSale;
    await this.saveHeldSales([...list, newHeld]);
    return newHeld;
  }

  public async deleteHeldSale(id: string): Promise<boolean> {
    const list = await this.getHeldSales();
    await this.saveHeldSales(list.filter((h) => h.id !== id));
    return true;
  }

  public async settleKhata(params: { customerId: string; amount: number; paymentMethod?: string; notes?: string; idempotencyKey?: string }): Promise<any> {
    const custs = await this.getCustomers();
    const updated = custs.map((c) => (c.id === params.customerId ? { ...c, balance: Math.max(0, c.balance - params.amount) } : c));
    await this.saveCustomers(updated);
    return { ok: true, amount: params.amount, customerId: params.customerId };
  }

  public async getKhataLedger(customerId: string): Promise<any> {
    return { settlements: [], allocations: [] };
  }

  public async getReportSummary(params?: { startDate?: string; endDate?: string }): Promise<any> {
    const sales = await this.getSales();
    const exps = await this.getExpenses();
    const grossSales = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalExpenses = exps.reduce((sum, e) => sum + (e.amount || 0), 0);
    return { grossSales, totalExpenses, salesCount: sales.length };
  }

  public async getUsers(): Promise<OfflineMember[]> {
    return readUsers();
  }
}

/**
 * SQLite Backend Data Access Provider
 * Prepared for Stage B cutover. Communicates through typed Next.js API endpoints.
 */
export class SqliteApiDataProvider implements IDataAccessLayer {
  private readonly client: PosApiClient;

  constructor(client: PosApiClient = posApiClient) {
    this.client = client;
  }

  public getMode(): DataAccessMode {
    return 'sqlite';
  }

  public async checkout(params: FrontendCheckoutParams, idempotencyKey?: string): Promise<Sale> {
    const payload = toBackendCheckoutPayload(params);
    const result = await this.client.checkout(payload, { idempotencyKey });
    return fromBackendCheckoutResult(result, params);
  }

  public async refund(params: FrontendRefundParams, idempotencyKey?: string): Promise<FrontendRefundResult> {
    const payload = toBackendRefundPayload(params);
    const result = await this.client.refund(payload, { idempotencyKey });
    return fromBackendRefundResult(result);
  }

  // Milestone 6 Stage B methods (calling REST routes)
  public async getProducts(): Promise<Product[]> {
    return this.client.getProducts();
  }

  public async saveProducts(products: Product[]): Promise<void> {
    for (const p of products) {
      await this.client.createProduct(p as any);
    }
  }

  public async createProduct(product: Partial<Product>): Promise<Product> {
    return this.client.createProduct(product as any);
  }

  public async updateProduct(id: string, product: Partial<Product>): Promise<Product> {
    return this.client.updateProduct(id, product as any);
  }

  public async deleteProduct(id: string): Promise<boolean> {
    return this.client.deleteProduct(id);
  }

  public async archiveProduct(id: string): Promise<boolean> {
    await this.client.archiveProduct(id);
    return true;
  }

  public async getCustomers(): Promise<Customer[]> {
    return this.client.getCustomers();
  }

  public async saveCustomers(customers: Customer[]): Promise<void> {
    for (const c of customers) {
      await this.client.createCustomer(c as any);
    }
  }

  public async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    return this.client.createCustomer(customer as any);
  }

  public async updateCustomer(id: string, customer: Partial<Customer>): Promise<Customer> {
    return this.client.updateCustomer(id, customer as any);
  }

  public async deleteCustomer(id: string): Promise<boolean> {
    return this.client.deleteCustomer(id);
  }

  public async getCustomerLedger(id: string): Promise<any> {
    return this.client.getCustomerLedger(id);
  }

  public async getSales(): Promise<Sale[]> {
    const all: Sale[] = [];
    let page = 1;
    while (page <= 50) {
      const res = await this.client.getSales({ limit: 1000, page });
      all.push(...(res.data || []));
      const totalPages = Number(res.pagination?.totalPages || 1);
      if (page >= totalPages || !res.data?.length) break;
      page += 1;
    }
    return all;
  }

  public async saveSales(sales: Sale[]): Promise<void> {
    // Sales are created transactionally via checkout
  }

  public async getSaleDetail(id: string): Promise<any> {
    return this.client.getSaleDetail(id);
  }

  public async getExpenses(): Promise<BusinessExpense[]> {
    return this.client.getExpenses();
  }

  public async saveExpenses(expenses: BusinessExpense[]): Promise<void> {
    for (const e of expenses) {
      await this.client.createExpense(e as any);
    }
  }

  public async createExpense(expense: Partial<BusinessExpense>): Promise<BusinessExpense> {
    return this.client.createExpense(expense as any);
  }

  public async deleteExpense(id: string): Promise<boolean> {
    const res = await this.client.deleteExpense(id);
    return res.deleted;
  }

  public async getSettings(): Promise<StoreSettings | null> {
    return this.client.getSettings();
  }

  public async saveSettings(settings: StoreSettings): Promise<void> {
    await this.client.updateSettings(settings as any);
  }

  public async getCategories(): Promise<Category[]> {
    const rows = await this.client.getCategories();
    return rows.map((r: any) => (typeof r === 'string' ? r : r.name));
  }

  public async saveCategories(categories: Category[]): Promise<void> {
    for (let i = 0; i < categories.length; i++) {
      try {
        await this.client.createCategory({ name: categories[i], displayOrder: i });
      } catch {}
    }
  }

  public async createCategory(name: string, displayOrder = 0): Promise<any> {
    return this.client.createCategory({ name, displayOrder });
  }

  public async reorderCategories(categoryIds: string[]): Promise<any> {
    return this.client.reorderCategories(categoryIds);
  }

  public async getHeldSales(): Promise<HeldSale[]> {
    return this.client.getHeldSales();
  }

  public async saveHeldSales(held: HeldSale[]): Promise<void> {
    for (const h of held) {
      await this.client.createHeldSale(h as any);
    }
  }

  public async createHeldSale(held: Partial<HeldSale>): Promise<HeldSale> {
    return this.client.createHeldSale(held as any);
  }

  public async deleteHeldSale(id: string): Promise<boolean> {
    return this.client.deleteHeldSale(id);
  }

  public async settleKhata(params: { customerId: string; amount: number; paymentMethod?: string; notes?: string; idempotencyKey?: string }): Promise<any> {
    return this.client.settleKhata(params);
  }

  public async getKhataLedger(customerId: string): Promise<any> {
    return this.client.getKhataLedger(customerId);
  }

  public async getReportSummary(params?: { startDate?: string; endDate?: string }): Promise<any> {
    return this.client.getReportSummary(params);
  }

  public async getUsers(): Promise<OfflineMember[]> {
    const rows = await this.client.listStaff();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role as OfflineMember['role'],
      salt: '',
      hash: '',
      businessId: row.businessId,
    }));
  }
}

/**
 * Factory returning the active data access layer according to current mode.
 */
export function getDataAccessLayer(): IDataAccessLayer {
  return new SqliteApiDataProvider();
}
