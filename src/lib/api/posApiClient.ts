/**
 * Selwick POS — Typed SQLite API Client
 *
 * Implements authenticated HTTP calls to Next.js API endpoints with:
 *   - Structured error handling (ApiClientError)
 *   - Session expiry detection (401)
 *   - Stable client-generated idempotency keys for checkout & refunds
 *   - Safe retry behavior reusing the identical idempotency key on transient failures
 */

export interface ApiCallOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  code?: string;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isSessionExpired: boolean;
  public readonly isNetworkError: boolean;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isSessionExpired = status === 401;
    this.isNetworkError = status === 0;
  }
}

/**
 * Generates a stable UUID v4 idempotency key.
 */
export function createIdempotencyKey(prefix = 'pos'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  // Fallback UUID v4 generation
  return `${prefix}-${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  })}`;
}

export interface CheckoutPayloadItem {
  productId: string;
  quantity: number;
  discountCents?: number;
  customPriceCents?: number | null;
}

export interface CheckoutApiPayload {
  items: CheckoutPayloadItem[];
  paymentMethod: string;
  amountTenderedCents?: number | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  discountType?: 'fixed' | 'percent';
  discountValue?: number;
  enableTax?: boolean;
  taxRatePercent?: number;
  terminalId?: string;
  transactionRef?: string | null;
  notes?: string;
  businessId?: string;
  idempotencyKey?: string;
}

export interface CheckoutApiResult {
  sale: {
    id: string;
    invoiceNumber: string;
    totalCents?: number;
    subtotalCents?: number;
    discountCents?: number;
    taxCents?: number;
    total?: number;
    subtotal?: number;
    discount?: number;
    tax?: number;
    paymentMethod: string;
    status: string;
    timestamp?: string;
    dateStr?: string;
    items?: any[];
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    terminalId?: string;
  };
  invoiceNumber?: string;
  totals?: {
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    amountTenderedCents: number;
    changeDueCents: number;
  };
  idempotentReplay?: boolean;
}

export interface RefundApiPayload {
  saleId: string;
  reason?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface RefundApiResult {
  refundId: string;
  saleId: string;
  invoiceNumber: string;
  status: string;
  payoutMethod: string;
  cashPayoutCents: number;
  debtReversedCents: number;
  idempotentReplay: boolean;
}

export interface SessionInfo {
  userId: string;
  businessId: string;
  role: string;
  name?: string;
  userName?: string;
  expiresAt?: string;
}

export interface StaffDirectoryEntry {
  id: string;
  name: string;
  role: string;
  businessId: string;
  businessName?: string;
}

export interface PosApiClientConfig {
  baseUrl?: string;
  onSessionExpired?: () => void;
  defaultHeaders?: Record<string, string>;
}

export class PosApiClient {
  private readonly baseUrl: string;
  private readonly onSessionExpired?: () => void;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: PosApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || '';
    this.onSessionExpired = config.onSessionExpired;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'x-selwick-client': 'selwick-pos-renderer',
      ...(config.defaultHeaders || {}),
    };
  }

  /**
   * Internal request dispatcher with structured error extraction and session expiry callback.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit & { idempotencyKey?: string; maxRetries?: number } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const maxRetries = options.maxRetries ?? 2;
    let attempt = 0;

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const res = await fetch(url, {
          ...options,
          headers,
          credentials: 'include', // Ensure session cookie is transmitted
        });

        // Parse response body
        let json: Record<string, unknown> = {};
        const text = await res.text();
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            throw new ApiClientError(res.status, 'INVALID_JSON_RESPONSE', 'Server returned invalid JSON.', text);
          }
        }

        if (!res.ok) {
          if (res.status === 401) {
            this.onSessionExpired?.();
          }

          // Handle transient database locks with backoff if attempts remain
          if ((res.status === 503 || json.code === 'SYSTEM_BUSY') && attempt <= maxRetries) {
            await new Promise((r) => setTimeout(r, 100 * attempt));
            continue;
          }

          const errorCode = String(json.code || `HTTP_${res.status}`);
          const errorMessage = String(json.error || json.message || res.statusText || 'API request failed.');
          throw new ApiClientError(res.status, errorCode, errorMessage, json.details || json);
        }

        // Handle success wrapper
        if (json.success === true && json.data !== undefined) {
          return json.data as T;
        }

        return json as unknown as T;
      } catch (err) {
        if (err instanceof ApiClientError) {
          throw err;
        }
        // Network or fetch aborted error
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * attempt));
          continue;
        }
        throw new ApiClientError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network request failed.');
      }
    }

    throw new ApiClientError(0, 'MAX_RETRIES_EXCEEDED', 'Request failed after maximum retry attempts.');
  }

  // ─── Authentication ────────────────────────────────────────────────────────
  /**
   * Authenticates staff PIN against /api/auth/login and receives session cookie.
   */
  public async login(credentials: { name: string; pin: string; businessId: string }): Promise<{ ok: boolean; role: string; userId: string; businessId: string; name: string }> {
    return this.request<{ ok: boolean; role: string; userId: string; businessId: string; name: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  public async bootstrapBusiness(payload: {
    businessId?: string;
    businessName: string;
    ownerName: string;
    pin: string;
    address?: string;
    phone?: string;
    businessType?: string;
    ownerId?: string;
  }): Promise<{ ok: boolean; userId: string; businessId: string; role: string; name: string }> {
    return this.request('/api/auth/bootstrap-business', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async getAccountDirectory(): Promise<StaffDirectoryEntry[]> {
    const res = await this.request<{ ok: boolean; data: StaffDirectoryEntry[] }>('/api/auth/directory');
    return res.data || [];
  }

  public async listStaff(): Promise<StaffDirectoryEntry[]> {
    const res = await this.request<{ ok: boolean; data: StaffDirectoryEntry[] }>('/api/auth/staff');
    return res.data || [];
  }

  public async registerStaff(payload: { name: string; role: string; pin: string; businessId?: string }): Promise<{ ok: boolean; userId: string; name: string; role: string }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async deleteStaff(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean; deleted: boolean }>(`/api/auth/staff/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return Boolean(res.deleted);
  }

  /**
   * Retrieves active session details from /api/auth/session.
   */
  public async getSession(options: ApiCallOptions = {}): Promise<SessionInfo | null> {
    try {
      return await this.request<SessionInfo>('/api/auth/session', {
        method: 'GET',
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Revokes session via /api/auth/logout and clears cookie.
   */
  public async logout(options: ApiCallOptions = {}): Promise<{ success: boolean }> {
    try {
      const res = await this.request<{ ok?: boolean; success?: boolean }>('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
        signal: options.signal,
      });
      return { success: res.success ?? res.ok ?? true };
    } catch {
      return { success: false };
    }
  }

  // ─── Checkout ───────────────────────────────────────────────────────────────
  /**
   * Dispatches checkout request to /api/pos/checkout.
   * Generates a stable idempotency key if one is not provided, ensuring identical key on retries.
   */
  public async checkout(
    payload: Omit<CheckoutApiPayload, 'idempotencyKey'>,
    options: ApiCallOptions = {}
  ): Promise<CheckoutApiResult> {
    const key = options.idempotencyKey || createIdempotencyKey('chk');
    const res = await this.request<CheckoutApiResult | { ok: true; data: CheckoutApiResult }>('/api/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotencyKey: key }),
      idempotencyKey: key,
      signal: options.signal,
      maxRetries: options.maxRetries ?? 2,
    });
    const unwrapped = (res as { data?: CheckoutApiResult })?.data?.sale
      ? (res as { data: CheckoutApiResult }).data
      : (res as CheckoutApiResult);
    return unwrapped;
  }

  // ─── Refund ─────────────────────────────────────────────────────────────────
  /**
   * Dispatches refund request to /api/pos/refund.
   * Generates a stable idempotency key if one is not provided.
   */
  public async refund(
    payload: Omit<RefundApiPayload, 'idempotencyKey'>,
    options: ApiCallOptions = {}
  ): Promise<RefundApiResult> {
    const key = options.idempotencyKey || createIdempotencyKey('ref');
    const res = await this.request<RefundApiResult | { ok: true; data: RefundApiResult }>('/api/pos/refund', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotencyKey: key }),
      idempotencyKey: key,
      signal: options.signal,
      maxRetries: options.maxRetries ?? 2,
    });
    const unwrapped = (res as { data?: RefundApiResult })?.data?.refundId
      ? (res as { data: RefundApiResult }).data
      : (res as RefundApiResult);
    return unwrapped;
  }

  // ─── Migration Endpoints ────────────────────────────────────────────────────
  public async createBackup(
    payload: unknown,
    businessId?: string,
    options: ApiCallOptions = {}
  ): Promise<{
    backupId: string;
    businessId: string;
    filename: string;
    filePath: string;
    sha256: string;
    totalRecords: number;
    createdAt: string;
  }> {
    const res = await this.request<{ ok: boolean; backup: any }>('/api/migration/backup', {
      method: 'POST',
      body: JSON.stringify({ businessId, payload }),
      signal: options.signal,
    });
    return (res as any).backup;
  }

  public async verifyBackup(
    identifier: { fileName?: string; filename?: string; backupId?: string; rawJson?: string; expectedSha256?: string },
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    integrity?: any;
    validation?: any;
  }> {
    const res = await this.request<any>('/api/migration/verify-backup', {
      method: 'POST',
      body: JSON.stringify({
        filename: identifier.fileName || identifier.filename,
        backupId: identifier.backupId,
        rawJson: identifier.rawJson,
        expectedSha256: identifier.expectedSha256,
      }),
      signal: options.signal,
    });
    return res;
  }

  public async importBackup(
    payload: {
      backupId?: string;
      filename?: string;
      fileName?: string;
      payload?: unknown;
      businessId?: string;
      options?: { strict?: boolean; quarantineMalformed?: boolean };
    },
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    report: Record<string, unknown>;
  }> {
    const res = await this.request<any>('/api/migration/import', {
      method: 'POST',
      body: JSON.stringify({
        businessId: payload.businessId,
        backupId: payload.backupId,
        filename: payload.filename || payload.fileName,
        payload: payload.payload,
      }),
      signal: options.signal,
    });
    return res;
  }

  public async reverseExport(
    businessId?: string,
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    report: any;
  }> {
    const res = await this.request<any>('/api/migration/reverse-export', {
      method: 'POST',
      body: JSON.stringify({ businessId }),
      signal: options.signal,
    });
    return res;
  }

  public async reconcileMigration(
    payload: { businessId?: string; backupId?: string; filename?: string; sourcePayload?: unknown } = {},
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    balanced: boolean;
    isBalanced?: boolean;
    sourceTotals?: Record<string, unknown>;
    sqliteTotals?: Record<string, unknown>;
    differences?: string[];
  }> {
    const res = await this.request<any>('/api/migration/reconcile', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    return res;
  }

  public async activateSqliteMode(
    payload: { businessId?: string; reconciliation?: any } = {},
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    activated: boolean;
    mode: string;
  }> {
    const res = await this.request<any>('/api/migration/activate', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    return res;
  }

  public async rollbackMigration(
    payload: { businessId?: string } = {},
    options: ApiCallOptions = {}
  ): Promise<{
    ok: boolean;
    recovered: boolean;
    report?: any;
  }> {
    const res = await this.request<any>('/api/migration/rollback', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    return res;
  }

  // ─── Products ─────────────────────────────────────────────────────────────
  public async getProducts(params?: { search?: string; category?: string; activeOnly?: boolean }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category) q.set('category', params.category);
    if (params?.activeOnly !== undefined) q.set('activeOnly', String(params.activeOnly));
    const qs = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ ok: boolean; data: any[] }>(`/api/pos/products${qs}`);
    return res.data || [];
  }

  public async createProduct(payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async updateProduct(id: string, payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async deleteProduct(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean; deleted: boolean }>(`/api/pos/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.deleted;
  }

  public async archiveProduct(id: string): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/products/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    });
    return res.data;
  }

  // ─── Categories ───────────────────────────────────────────────────────────
  public async getCategories(): Promise<any[]> {
    const res = await this.request<{ ok: boolean; data: any[] }>('/api/pos/categories');
    return res.data || [];
  }

  public async createCategory(payload: { name: string; displayOrder?: number }): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async updateCategory(id: string, payload: { name?: string; displayOrder?: number }): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async deleteCategory(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean; deleted: boolean }>(`/api/pos/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.deleted;
  }

  public async reorderCategories(orderedIds: string[]): Promise<any[]> {
    const res = await this.request<{ ok: boolean; data: any[] }>('/api/pos/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    });
    return res.data || [];
  }

  // ─── Customers & Ledger ───────────────────────────────────────────────────
  public async getCustomers(params?: { search?: string; phone?: string }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.phone) q.set('phone', params.phone);
    const qs = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ ok: boolean; data: any[] }>(`/api/pos/customers${qs}`);
    return res.data || [];
  }

  public async createCustomer(payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async updateCustomer(id: string, payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/customers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async deleteCustomer(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean; deleted: boolean }>(`/api/pos/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return Boolean(res.deleted);
  }

  public async getCustomerLedger(id: string): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/customers/${encodeURIComponent(id)}/ledger`);
    return res.data;
  }

  // ─── Khata Settlements ────────────────────────────────────────────────────
  public async settleKhata(
    payload: { customerId: string; amountCents?: number; amount?: number; paymentMethod?: string; notes?: string; idempotencyKey?: string },
    options: ApiCallOptions = {}
  ): Promise<any> {
    const key = options.idempotencyKey || payload.idempotencyKey || createIdempotencyKey('stl');
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/khata/settle', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotencyKey: key }),
      idempotencyKey: key,
      signal: options.signal,
    });
    return res.data;
  }

  public async getKhataLedger(customerId: string): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/khata/ledger/${encodeURIComponent(customerId)}`);
    return res.data;
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────
  public async getExpenses(params?: { startDate?: string; endDate?: string; category?: string }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    if (params?.category) q.set('category', params.category);
    const qs = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ ok: boolean; data: any[] }>(`/api/pos/expenses${qs}`);
    return res.data || [];
  }

  public async createExpense(payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async deleteExpense(id: string): Promise<any> {
    const res = await this.request<{ ok: boolean; deleted: boolean; reversedExpense: any }>(`/api/pos/expenses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res;
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  public async getSettings(): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/settings');
    return res.data;
  }

  public async updateSettings(payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  // ─── Held Sales ───────────────────────────────────────────────────────────
  public async getHeldSales(): Promise<any[]> {
    const res = await this.request<{ ok: boolean; data: any[] }>('/api/pos/held');
    return res.data || [];
  }

  public async createHeldSale(payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>('/api/pos/held', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async updateHeldSale(id: string, payload: Record<string, unknown>): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/held/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.data;
  }

  public async deleteHeldSale(id: string): Promise<boolean> {
    const res = await this.request<{ ok: boolean; deleted: boolean }>(`/api/pos/held/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.deleted;
  }

  // ─── Sales & Reports ──────────────────────────────────────────────────────
  public async getSales(params?: { page?: number; limit?: number; startDate?: string; endDate?: string; status?: string; search?: string }): Promise<{ data: any[]; pagination: any }> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    if (params?.status) q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ ok: boolean; data: any[]; pagination: any }>(`/api/pos/sales${qs}`);
    return { data: res.data || [], pagination: res.pagination };
  }

  public async getSaleDetail(id: string): Promise<any> {
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/sales/${encodeURIComponent(id)}`);
    return res.data;
  }

  public async getReportSummary(params?: { startDate?: string; endDate?: string }): Promise<any> {
    const q = new URLSearchParams();
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    const qs = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ ok: boolean; data: any }>(`/api/pos/reports/summary${qs}`);
    return res.data;
  }
}

// Default client instance configured for localhost Next.js app
export const posApiClient = new PosApiClient();
