
'use client';
import {removeBusinessItem,setOfflineBusiness,LEGACY_ID} from '@/lib/offlineBusinessStorage';

import React, { useState, useEffect } from 'react';

import { LocalBackupScheduler } from '@/components/pos/LocalBackupScheduler';
import PosAccessGate, {
  usePosAccess,
} from '@/components/pos/PosAccessGate';
import {
  getDataAccessLayer,
  getDataAccessMode,
  isTestSqliteModeActive,
  setTestSqliteMode,
  TEST_SQLITE_BUSINESS_ID,
} from '@/lib/data/dataAccessLayer';
import {
  createIdempotencyKey,
  posApiClient,
  ApiClientError,
} from '@/lib/api/posApiClient';

import {
  INITIAL_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_PAST_SALES,
} from '@/data/mockData';

import {
  Product,
  CartItem,
  Customer,
  Sale,
  HeldSale,
  StoreSettings,
} from '@/types/pos';

import { type ActiveTab } from '@/components/pos/Header';
import { Sidebar } from '@/components/pos/Sidebar';
import { BusinessSetupModal } from '@/components/pos/BusinessSetupModal';
import { BUSINESS_TEMPLATES, normalizeCategories } from '@/data/businessTemplates';
import { TopBar } from '@/components/pos/TopBar';
import { DashboardView } from '@/components/pos/DashboardView';
import { RegisterView } from '@/components/pos/RegisterView';
import { PaymentModal, PaymentResult } from '@/components/pos/PaymentModal';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { HeldSalesModal } from '@/components/pos/HeldSalesModal';
import { InventoryView } from '@/components/pos/InventoryView';
import { CustomersView } from '@/components/pos/CustomersView';
import { SalesHistoryView } from '@/components/pos/SalesHistoryView';
import { ExpensesReportsView, isBusinessExpense, type BusinessExpense } from '@/components/pos/ExpensesReportsView';
import { UsersView } from '@/components/pos/UsersView';
import { OfflineLogin, OfflineUsers } from '@/components/pos/OfflineStaff';
import {offlineDisplayName, type OfflineMember} from '@/lib/offlineUsers';
import { SettingsView } from '@/components/pos/SettingsView';
import { ShortcutsModal } from '@/components/pos/ShortcutsModal';
import { playSound } from '@/utils/sound';

import {
  loadCloudPosRecords,
  completeCloudPosSale,
  saveCloudPosRecord,
  deleteCloudPosRecord,
  subscribeToCloudPosChanges,
  type CloudPosRecord,
} from '@/lib/supabase/posSync';

const WALK_IN_CUSTOMER: Customer = {
  id: 'walk-in',
  name: 'Walk-in Sale',
  phone: '',
  balance: 0,
  totalOrders: 0,
  totalSpent: 0,
  loyaltyPoints: 0,
  createdAt: '',
};

const SELWICK_BRANDING = {
  storeName: 'Selwick POS',
  tagline: 'Smart Business Management',
  version: 'v1.0',
  defaultTerminalId: 'SEL-0001',
  receiptHeader: 'Thank you for choosing Selwick!',
  receiptFooter: 'Thank you for your business. Visit again!',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isProduct(value: unknown): value is Product {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.price === 'number'
  );
}

function isCustomer(value: unknown): value is Customer {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.phone === 'string'
  );
}

function isSale(value: unknown): value is Sale {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.invoiceNumber === 'string' &&
    Array.isArray(value.items) &&
    typeof value.total === 'number'
  );
}

function isHeldSale(value: unknown): value is HeldSale {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.invoiceNumber === 'string' &&
    Array.isArray(value.items)
  );
}

function getCategoryName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (isObject(value)) {
    if (typeof value.name === 'string' && value.name.trim()) {
      return value.name.trim();
    }

    if (
      typeof value.category === 'string' &&
      value.category.trim()
    ) {
      return value.category.trim();
    }
  }

  return null;
}

function getCloudSettings(records: CloudPosRecord[]): StoreSettings {
  const settingRecords = records.filter(
    (record) => record.record_type === 'setting',
  );

  const latestSetting = settingRecords[settingRecords.length - 1];
  const savedSettings = isObject(latestSetting?.data)
    ? (latestSetting.data as Partial<StoreSettings>)
    : {};

  return {
    ...INITIAL_SETTINGS,
    ...SELWICK_BRANDING,
    ...savedSettings,
    terminalId:
      savedSettings.terminalId ||
      SELWICK_BRANDING.defaultTerminalId,
    theme: 'light',
  };
}

function getNextInvoiceSequence(sales: Sale[]): number {
  const highest = sales.reduce((currentHighest, sale) => {
    const match = sale.invoiceNumber?.match(/(\d+)$/);

    return match
      ? Math.max(currentHighest, Number(match[1]))
      : currentHighest;
  }, 41);

  return highest + 1;
}

function createProductId(): string {
  return `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function PosPageContent() {
  const { mode, activeBusinessId, businessRole } = usePosAccess();
  const isCloudMode = mode === 'cloud';
  const [offlineUser,setOfflineUser] = useState<OfflineMember|null>(null);
  const [offlineUsersVersion,setOfflineUsersVersion] = useState(0);
  const isCashier = isCloudMode ? businessRole === 'cashier' : offlineUser?.role === 'cashier';
  const canManageUsers = isCloudMode ? (businessRole === 'owner' || businessRole === 'manager') : (offlineUser?.role === 'owner' || offlineUser?.role === 'manager');

  const [isTestMode, setIsTestMode] = useState(false);
  const checkoutIdempotencyKeyRef = React.useRef<string>('');

  useEffect(() => {
    setIsTestMode(isTestSqliteModeActive());
  }, []);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [businessSetupOpen, setBusinessSetupOpen] = useState(false);
  const [businessSetupBusy, setBusinessSetupBusy] = useState(false);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);

  const [settings, setSettings] = useState<StoreSettings>({
    ...INITIAL_SETTINGS,
    ...SELWICK_BRANDING,
    terminalId: SELWICK_BRANDING.defaultTerminalId,
    theme: 'light',
  });

  const [cart, setCart] = useState<CartItem[]>([]);
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [selectedCustomer, setSelectedCustomer] =
    useState<Customer>(WALK_IN_CUSTOMER);

  const [activeTab, setActiveTab] = useState<ActiveTab>('register');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [discount, setDiscount] = useState<number>(0);
  const [discountType, setDiscountType] =
    useState<'fixed' | 'percent'>('fixed');

  const [isHydrated, setIsHydrated] = useState(false);
  const [cloudLoadError, setCloudLoadError] = useState('');
  const [cloudLoadStatus, setCloudLoadStatus] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >('idle');

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [activeReceiptSale, setActiveReceiptSale] =
    useState<Sale | null>(null);
  const [isHeldOpen, setIsHeldOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [nextInvoiceSeq, setNextInvoiceSeq] = useState(42);

  const cloudHasLoaded = cloudLoadStatus === 'loaded';
  const hasExistingBusinessData = products.length > 0 || sales.length > 0 || categories.some(c => c !== 'All Items');
  const needsBusinessSetup = isHydrated && (!isCloudMode || cloudHasLoaded) && !businessType && !hasExistingBusinessData;

  // Keep the stored category records intact, but present the selected industry's
  // categories first. Legacy categories remain available when actual products
  // still use them, so changing industries never hides inventory.
  const visibleCategories = React.useMemo(() => {
    if (!businessType) return normalizeCategories(categories);
    const template = BUSINESS_TEMPLATES.find(item => item.id === businessType);
    if (!template || businessType === 'custom') return normalizeCategories(categories);
    const usedByProducts = products.map(product => product.category);
    return normalizeCategories([...template.categories, ...usedByProducts]);
  }, [businessType, categories, products]);


  const applyBusinessSetup = async (type: string, newCategories: string[]) => {
    if (isCloudMode && !cloudHasLoaded) throw new Error('Cloud records are not ready.');
    setBusinessSetupBusy(true);
    try {
      const finalCategories = normalizeCategories(newCategories);
      if (isCloudMode) {
        // Save the template marker last: an interrupted setup will be retried safely.
        const existing = new Set(categories.map(c => c.toLowerCase()));
        for (const name of finalCategories.filter(c => c !== 'All Items' && !existing.has(c.toLowerCase()))) {
          await saveCloudPosRecord({ record_type: 'category', record_id: `business-category-${encodeURIComponent(name.toLowerCase())}`, data: { name } });
        }
        await saveCloudPosRecord({ record_type: 'category', record_id: 'selwick-business-template', data: { businessType: type } });
      } else {
        // SQLite is authoritative — persist categories through the DAL.
        const dal = getDataAccessLayer();
        await dal.saveCategories(finalCategories);
        // businessType is a non-financial UI preference; keep in localStorage for migration wizard compatibility.
        try { window.localStorage.setItem('selwick_offline_business_type', type); } catch { /* ignore */ }
      }
      setCategories(finalCategories);
      setBusinessType(type);
      setBusinessSetupOpen(false);
    } finally { setBusinessSetupBusy(false); }
  };

  const isCloudLoading =
    isCloudMode && cloudLoadStatus === 'loading';

  const requireCloudInventoryReady = (): boolean => {
    if (!isCloudMode) return true;

    if (!activeBusinessId) {
      window.alert('Select a business before editing inventory.');
      return false;
    }

    if (!cloudHasLoaded) {
      window.alert(
        'Cloud data has not loaded successfully. Please wait or reload the business before editing inventory.',
      );
      return false;
    }

    return true;
  };

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      if (!isCloudMode && !offlineUser) { setIsHydrated(false); return; }
      setIsHydrated(false);
      setCloudLoadError('');
      setCloudLoadStatus(isCloudMode ? 'loading' : 'idle');

      if (isCloudMode) {
        setProducts([]);
        setCategories([]);
        setBusinessType(null);
        setCustomers([]);
        setSales([]);
        setHeldSales([]);
        setCart([]);
        setSelectedCustomer(WALK_IN_CUSTOMER);
        setDiscount(0);
        setDiscountType('fixed');
        setNextInvoiceSeq(42);

        setSettings({
          ...INITIAL_SETTINGS,
          ...SELWICK_BRANDING,
          terminalId: SELWICK_BRANDING.defaultTerminalId,
          theme: 'light',
        });

        if (!activeBusinessId) {
          setCloudLoadError(
            'No business is selected. Return to business selection and choose a business.',
          );
          setCloudLoadStatus('error');
          setIsHydrated(true);
          return;
        }

        try {
          const records = await loadCloudPosRecords();

          if (cancelled) return;

          const cloudProducts = records
            .filter((record) => record.record_type === 'product')
            .map((record) => record.data)
            .filter(isProduct);

          const cloudCustomers = records
            .filter((record) => record.record_type === 'customer')
            .map((record) => record.data)
            .filter(isCustomer)
            .filter(
              (customer) =>
                customer.id !== 'walk-in' &&
                customer.id !== 'cust-walkin',
            );

          const cloudSales = records
            .filter((record) => record.record_type === 'sale')
            .map((record) => record.data)
            .filter(isSale);

          const cloudHeldSales = records
            .filter((record) => record.record_type === 'held_sale')
            .map((record) => record.data)
            .filter(isHeldSale);

          const cloudCategories = records
            .filter((record) => record.record_type === 'category')
            .map((record) => getCategoryName(record.data))
            .filter((name): name is string => name !== null);

          setProducts(cloudProducts);
          setCustomers(cloudCustomers);
          setSales(cloudSales);
          setHeldSales(cloudHeldSales);
          setBusinessType((records.find(record => record.record_type === 'category' && record.record_id === 'selwick-business-template')?.data as {businessType?: string} | undefined)?.businessType ?? null);
          setCategories(
            Array.from(new Set(cloudCategories)).sort((a, b) =>
              a.localeCompare(b),
            ),
          );
          setSettings(getCloudSettings(records));
          setNextInvoiceSeq(getNextInvoiceSequence(cloudSales));
          setCloudLoadStatus('loaded');
        } catch (error) {
          if (cancelled) return;

          console.error('Failed to load cloud POS records:', error);

          setProducts([]);
          setCategories([]);
          setCustomers([]);
          setSales([]);
          setHeldSales([]);
          setNextInvoiceSeq(42);

          setCloudLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load this business from the cloud.',
          );
          setCloudLoadStatus('error');
        } finally {
          if (!cancelled) {
            setIsHydrated(true);
          }
        }

        return;
      }

      if (!isCloudMode && getDataAccessMode() === 'sqlite') {
        try {
          const dal = getDataAccessLayer();
          const [
            loadedProducts,
            loadedCustomers,
            loadedSales,
            loadedExpenses,
            loadedSettings,
            loadedHeld,
            loadedCats,
          ] = await Promise.all([
            dal.getProducts(),
            dal.getCustomers(),
            dal.getSales(),
            dal.getExpenses(),
            dal.getSettings(),
            dal.getHeldSales(),
            dal.getCategories(),
          ]);

          if (cancelled) return;

          setProducts(loadedProducts);
          setCustomers(loadedCustomers.filter((c) => c.id !== 'walk-in' && c.id !== 'cust-walkin'));
          setSales(loadedSales);
          setExpenses(loadedExpenses);
          if (loadedSettings) {
            setSettings({
              ...INITIAL_SETTINGS,
              ...SELWICK_BRANDING,
              ...loadedSettings,
              terminalId: loadedSettings.terminalId || SELWICK_BRANDING.defaultTerminalId,
              theme: 'light',
            });
          }
          setHeldSales(loadedHeld);
          setCategories(loadedCats);
          setNextInvoiceSeq(getNextInvoiceSequence(loadedSales));
        } catch (error) {
          if (cancelled) return;
          console.error('[SQLITE_DATA] Failed to load data from SQLite backend:', error);
          setCloudLoadError(
            error instanceof Error ? error.message : 'Failed to load data from SQLite backend',
          );
        } finally {
          if (!cancelled) {
            setIsHydrated(true);
          }
        }
        return;
      }

      // localStorage fallback removed — getDataAccessMode() is always 'sqlite'.
      // All data loading now routes exclusively through the SQLite branch above.
      if (!cancelled) setIsHydrated(true);
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [isCloudMode, activeBusinessId, offlineUser?.businessId, offlineUser?.id]);

  // Cloud mode: keep this screen in sync with changes made by other employees.
  // Each event triggers a fresh read so the UI reflects the authoritative DB state.
  useEffect(() => {
    if (!isCloudMode || !activeBusinessId || !cloudHasLoaded) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let refreshInProgress = false;
    let refreshQueued = false;

    const refreshCloudRecords = async () => {
      if (cancelled) return;
      if (refreshInProgress) {
        refreshQueued = true;
        return;
      }

      refreshInProgress = true;
      try {
        const records = await loadCloudPosRecords();
        if (cancelled) return;

        const cloudProducts = records
          .filter((record) => record.record_type === 'product')
          .map((record) => record.data)
          .filter(isProduct);

        const cloudCustomers = records
          .filter((record) => record.record_type === 'customer')
          .map((record) => record.data)
          .filter(isCustomer)
          .filter(
            (customer) =>
              customer.id !== 'walk-in' &&
              customer.id !== 'cust-walkin',
          );

        const cloudSales = records
          .filter((record) => record.record_type === 'sale')
          .map((record) => record.data)
          .filter(isSale);

        const cloudHeldSales = records
          .filter((record) => record.record_type === 'held_sale')
          .map((record) => record.data)
          .filter(isHeldSale);

        const cloudCategories = records
          .filter((record) => record.record_type === 'category')
          .map((record) => getCategoryName(record.data))
          .filter((name): name is string => name !== null);

        setProducts(cloudProducts);
        setCustomers(cloudCustomers);
        setSales(cloudSales);
        setHeldSales(cloudHeldSales);
        setBusinessType((records.find(record => record.record_type === 'category' && record.record_id === 'selwick-business-template')?.data as {businessType?: string} | undefined)?.businessType ?? null);
        setCategories(
          Array.from(new Set(cloudCategories)).sort((a, b) =>
            a.localeCompare(b),
          ),
        );
        setSettings(getCloudSettings(records));
        setNextInvoiceSeq(getNextInvoiceSequence(cloudSales));
      } catch (error) {
        console.error('Failed to refresh cloud POS records:', error);
      } finally {
        refreshInProgress = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void refreshCloudRecords();
        }
      }
    };

    void (async () => {
      try {
        const stop = await subscribeToCloudPosChanges(() => {
          void refreshCloudRecords();
        });

        if (cancelled) {
          stop();
        } else {
          unsubscribe = stop;
        }
      } catch (error) {
        console.error('Failed to subscribe to cloud POS changes:', error);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isCloudMode, activeBusinessId, cloudHasLoaded]);

  // SQLite is the authoritative data store. Operational localStorage sync hooks removed —
  // all writes now happen inline via dal.* calls in the mutation handlers above.

  const currentInvoiceNumber = `#${String(nextInvoiceSeq).padStart(4, '0')}`;

  const handleHoldCart = async () => {
    if (cart.length === 0) return;

    const held: HeldSale = {
      id: `held-${Date.now()}`,
      invoiceNumber: currentInvoiceNumber,
      dateStr: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      timestamp: Date.now(),
      items: [...cart],
      customer: selectedCustomer,
    };

    if (getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        await dal.createHeldSale?.(held);
      } catch (err) {
        console.error('[SQLITE_HELD] Failed to save held sale:', err);
      }
    }

    setHeldSales((previous) => [held, ...previous]);
    setCart([]);
    setDiscount(0);
    setDiscountType('fixed');
    setNextInvoiceSeq((previous) => previous + 1);
    playSound('hold', settings.soundEnabled);
  };

  const handleClearCart = () => {
    if (
      cart.length > 0 &&
      window.confirm('Are you sure you want to clear current order items?')
    ) {
      setCart([]);
      setDiscount(0);
      setDiscountType('fixed');
      playSound('hold', settings.soundEnabled);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setIsPaymentOpen(false);
      setIsReceiptOpen(false);
      setIsHeldOpen(false);
      setIsShortcutsOpen(false);
    } else if (event.key === 'F1') {
      event.preventDefault();
      setActiveTab('register');
    } else if (event.key === 'F3') {
      event.preventDefault();
      setActiveTab('inventory');
    } else if (event.key === 'F4') {
      event.preventDefault();
      if (cart.length > 0) handleHoldCart();
    } else if (event.key === 'F6') {
      event.preventDefault();
      setActiveTab('customers');
    } else if (event.key === 'F7') {
      event.preventDefault();
      setActiveTab('sales');
    } else if (event.key === 'F8') {
      event.preventDefault();
      if (cart.length > 0) handleClearCart();
    } else if (event.key === 'F9') {
      event.preventDefault();

      if (cart.length > 0 && activeTab === 'register' && (!isCloudMode || cloudHasLoaded)) {
        setIsPaymentOpen(true);
      }
    } else if (event.key === 'F10') {
      event.preventDefault();
      setActiveTab('settings');
    } else if (
      event.key === '?' &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target instanceof HTMLBodyElement
    ) {
      event.preventDefault();
      setIsShortcutsOpen(true);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleAddToCart = (product: Product) => {
    setCart((previous) => {
      const existing = previous.find(
        (item) => item.product.id === product.id,
      );

      if (existing) {
        if (existing.quantity >= product.stock) {
          playSound('error', settings.soundEnabled);
          return previous;
        }

        playSound('beep', settings.soundEnabled);
        return previous.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }

      if (product.stock <= 0) {
        playSound('error', settings.soundEnabled);
        return previous;
      }

      playSound('beep', settings.soundEnabled);
      return [...previous, { product, quantity: 1, discount: 0 }];
    });
  };

  const handleUpdateQuantity = (productId: string, delta: number) => {
    setCart((previous) =>
      previous
        .map((item) => {
          if (item.product.id !== productId) return item;

          const quantity = item.quantity + delta;
          if (quantity <= 0) return null;

          if (quantity > item.product.stock) {
            playSound('error', settings.soundEnabled);
            return item;
          }

          playSound('click', settings.soundEnabled);
          return { ...item, quantity };
        })
        .filter(Boolean) as CartItem[],
    );
  };

  const handleSetQuantity = (productId: string, quantity: number) => {
    setCart((previous) =>
      previous
        .map((item) => {
          if (item.product.id !== productId) return item;
          if (quantity <= 0) return null;

          return {
            ...item,
            quantity: Math.min(quantity, item.product.stock),
          };
        })
        .filter(Boolean) as CartItem[],
    );
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart((previous) =>
      previous.filter((item) => item.product.id !== productId),
    );
    playSound('click', settings.soundEnabled);
  };

  const subtotal = cart.reduce((total, item) => {
    const price = item.customPrice ?? item.product.price;
    return total + price * item.quantity - (item.discount || 0);
  }, 0);

  const calculatedDiscount =
    discountType === 'percent'
      ? Math.round((subtotal * discount) / 100)
      : Math.min(discount, subtotal);

  const calculatedTax =
    settings.enableTax && settings.taxRate > 0
      ? Math.round(
          (Math.max(0, subtotal - calculatedDiscount) *
            settings.taxRate) /
            100,
        )
      : 0;

  const grandTotal = Math.max(
    0,
    subtotal - calculatedDiscount + calculatedTax,
  );

  const handleCompleteSale = async (result: PaymentResult): Promise<void> => {
    if (!cloudHasLoaded && isCloudMode) {
      throw new Error('Cloud data is not ready. Please wait for the business data to finish loading.');
    }

    if (cart.length === 0) {
      throw new Error('Your cart is empty. Add at least one product before checkout.');
    }

    const customer = selectedCustomer ?? WALK_IN_CUSTOMER;

    if (result.paymentMethod === 'credit') {
      if (customer.id === WALK_IN_CUSTOMER.id) {
        throw new Error(
          'Select a customer before completing a Credit/Khata/Udhar sale.',
        );
      }

      if (
        !Number.isFinite(result.amountTendered) ||
        result.amountTendered < 0 ||
        result.amountTendered > grandTotal
      ) {
        throw new Error(
          'Credit/Khata/Udhar down payment must be between 0 and the sale total.',
        );
      }
    }

    const newSale: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      invoiceNumber: currentInvoiceNumber,
      timestamp: new Date().toISOString(),
      dateStr: new Date().toLocaleString(),
      items: [...cart],
      subtotal,
      discount: calculatedDiscount,
      discountType,
      tax: calculatedTax,
      total: grandTotal,
      paymentMethod: result.paymentMethod,
      amountTendered: result.amountTendered,
      changeDue: result.changeDue,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      notes: result.notes,
      terminalId: settings.terminalId,
      status: 'completed',
    };

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      const dal = getDataAccessLayer();
      try {
        if (!checkoutIdempotencyKeyRef.current) {
          checkoutIdempotencyKeyRef.current = createIdempotencyKey('sale');
        }

        const authoritativeSale = await dal.checkout({
          cart,
          payment: result,
          customer: customer.id !== WALK_IN_CUSTOMER.id ? customer : null,
          discount,
          discountType,
          settings,
          terminalId: settings.terminalId,
          notes: result.notes,
        }, checkoutIdempotencyKeyRef.current);

        // SUCCESS: Only on success, generate a fresh idempotency key for the NEXT checkout
        checkoutIdempotencyKeyRef.current = createIdempotencyKey('sale');

        setSales((previous) => [authoritativeSale, ...previous]);

        const sold = new Map<string, number>();
        cart.forEach((item) => {
          sold.set(
            item.product.id,
            (sold.get(item.product.id) ?? 0) + item.quantity,
          );
        });

        setProducts((previous) =>
          previous.map((product) => {
            const quantity = sold.get(product.id);
            return quantity
              ? { ...product, stock: Math.max(0, product.stock - quantity) }
              : product;
          }),
        );

        if (customer.id !== WALK_IN_CUSTOMER.id) {
          const updatedCustomers = await dal.getCustomers();
          setCustomers(updatedCustomers.filter((c) => c.id !== 'walk-in' && c.id !== 'cust-walkin'));
        }

        setActiveReceiptSale(authoritativeSale);
        setIsPaymentOpen(false);
        setIsReceiptOpen(true);
        setCart([]);
        setDiscount(0);
        setDiscountType('fixed');
        setNextInvoiceSeq((previous) => previous + 1);
        playSound('beep', settings.soundEnabled);
        return;
      } catch (err: any) {
        console.error('[SQLITE_CHECKOUT] Checkout failed:', err);
        const errMsg = err?.message || 'Checkout failed on SQLite backend.';
        window.alert(`Checkout failed: ${errMsg}`);
        throw err;
      }
    }

    if (isCloudMode) {
      // The database transaction records the sale and deducts stock atomically.
      // Do not update the UI or clear the cart unless Supabase confirms success.
      await completeCloudPosSale(newSale);

      const sold = new Map<string, number>();
      cart.forEach((item) => {
        sold.set(
          item.product.id,
          (sold.get(item.product.id) ?? 0) + item.quantity,
        );
      });

      setProducts((previous) =>
        previous.map((product) => {
          const quantity = sold.get(product.id);
          return quantity
            ? { ...product, stock: Math.max(0, product.stock - quantity) }
            : product;
        }),
      );
    } else {
      // Preserve the existing offline checkout behavior.
      const sold = new Map<string, number>();
      cart.forEach((item) => {
        sold.set(
          item.product.id,
          (sold.get(item.product.id) ?? 0) + item.quantity,
        );
      });

      setProducts((previous) =>
        previous.map((product) => {
          const quantity = sold.get(product.id);
          return quantity
            ? { ...product, stock: Math.max(0, product.stock - quantity) }
            : product;
        }),
      );

      if (customer.id !== WALK_IN_CUSTOMER.id) {
        const unpaidCredit =
          result.paymentMethod === 'credit'
            ? Math.max(0, grandTotal - result.amountTendered)
            : 0;

        setCustomers((previous) =>
          previous.map((item) =>
            item.id === customer.id
              ? {
                  ...item,
                  totalOrders: item.totalOrders + 1,
                  totalSpent: item.totalSpent + grandTotal,
                  loyaltyPoints:
                    item.loyaltyPoints + Math.floor(grandTotal / 100),
                  balance: item.balance + unpaidCredit,
                }
              : item,
          ),
        );
      }
    }

    setSales((previous) => [newSale, ...previous]);
    setActiveReceiptSale(newSale);
    setIsPaymentOpen(false);
    setIsReceiptOpen(true);
    setCart([]);
    setDiscount(0);
    setDiscountType('fixed');
    setNextInvoiceSeq((previous) => previous + 1);
  };

  const handleRefundSale = async (saleId: string) => {
    if (isCloudMode) {
      window.alert(
        'Cloud refunds are temporarily disabled until refund and stock restoration synchronization is implemented.',
      );
      return;
    }

    const sale = sales.find((item) => item.id === saleId);
    if (!sale || sale.status === 'refunded') return;

    if (getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        const refundKey = createIdempotencyKey('ref');
        const refundResult = await dal.refund({
          saleId,
          reason: 'Customer refund request',
        }, refundKey);

        setSales((previous) =>
          previous.map((item) =>
            item.id === saleId
              ? { ...item, status: 'refunded' as const }
              : item,
          ),
        );

        setProducts((previous) => {
          const restore = new Map<string, number>();
          sale.items.forEach((item) => {
            restore.set(
              item.product.id,
              (restore.get(item.product.id) ?? 0) + item.quantity,
            );
          });

          return previous.map((product) => {
            const quantity = restore.get(product.id);
            return quantity
              ? { ...product, stock: product.stock + quantity }
              : product;
          });
        });

        const updatedCustomers = await dal.getCustomers();
        setCustomers(updatedCustomers.filter((c) => c.id !== 'walk-in' && c.id !== 'cust-walkin'));

        window.alert(`Refund completed successfully. Cash payout: Rs. ${refundResult.cashPayout.toFixed(2)}, Debt reversed: Rs. ${refundResult.debtReversed.toFixed(2)}`);
        return;
      } catch (err: any) {
        console.error('[SQLITE_REFUND] Refund failed:', err);
        window.alert(`Refund failed: ${err?.message || 'Error processing refund'}`);
        return;
      }
    }

    setProducts((previous) => {
      const restore = new Map<string, number>();
      sale.items.forEach((item) => {
        restore.set(
          item.product.id,
          (restore.get(item.product.id) ?? 0) + item.quantity,
        );
      });

      return previous.map((product) => {
        const quantity = restore.get(product.id);
        return quantity
          ? { ...product, stock: product.stock + quantity }
          : product;
      });
    });

    // LocalStorage/offline credit (Khata) refund accounting.
    if (sale.paymentMethod === 'credit' && sale.customerId) {
      const originalDebt = Math.max(0, sale.total - (sale.amountTendered ?? 0));
      setCustomers((previous) =>
        previous.map((customer) => {
          if (customer.id !== sale.customerId) return customer;
          const debtToReverse = Math.min(
            originalDebt,
            Math.max(0, customer.balance),
          );
          return {
            ...customer,
            balance: Math.max(0, customer.balance - debtToReverse),
            totalOrders: Math.max(0, customer.totalOrders - 1),
            totalSpent: Math.max(0, customer.totalSpent - sale.total),
            loyaltyPoints: Math.max(
              0,
              customer.loyaltyPoints - Math.floor(sale.total / 100),
            ),
          };
        }),
      );
    }

    setSales((previous) =>
      previous.map((item) =>
        item.id === saleId
          ? { ...item, status: 'refunded' as const }
          : item,
      ),
    );
  };

  const handleSettleKhata = async (
    customerId: string,
    amount: number,
    note: string,
  ) => {
    if (isCloudMode) {
      window.alert(
        'Cloud customer balance updates are not enabled yet.',
      );
      return;
    }

    if (getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        const settleKey = createIdempotencyKey('stl');
        await dal.settleKhata?.({
          customerId,
          amount,
          notes: note,
          idempotencyKey: settleKey,
        });

        const updatedCustomers = await dal.getCustomers();
        setCustomers(updatedCustomers.filter((c) => c.id !== 'walk-in' && c.id !== 'cust-walkin'));
        playSound('beep', settings.soundEnabled);
        return;
      } catch (err: any) {
        console.error('[SQLITE_SETTLE] Settle Khata failed:', err);
        window.alert(`Khata settlement failed: ${err?.message || 'Error processing settlement'}`);
        return;
      }
    }

    setCustomers((previous) =>
      previous.map((customer) =>
        customer.id === customerId
          ? { ...customer, balance: customer.balance - amount }
          : customer,
      ),
    );

    void note;
  };

  // INVENTORY: cloud writes complete before React state is updated.
  // Offline mode retains the existing local-state/localStorage behavior.
  const handleAddProduct = async (product: Omit<Product, 'id'>) => {
    if (isCashier) return;
    if (!requireCloudInventoryReady()) return;

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        const created = await dal.createProduct?.(product);
        if (created) {
          setProducts((previous) => [created, ...previous]);
          playSound('beep', settings.soundEnabled);
        }
        return;
      } catch (error) {
        console.error('[SQLITE_PRODUCT] Failed to add product:', error);
        window.alert(`Product was not added: ${error instanceof Error ? error.message : 'Database error'}`);
        return;
      }
    }

    const newProduct: Product = {
      ...product,
      id: createProductId(),
    };

    try {
      if (isCloudMode) {
        await saveCloudPosRecord({
          record_type: 'product',
          record_id: newProduct.id,
          data: newProduct,
        });
      }

      setProducts((previous) => [newProduct, ...previous]);
      playSound('beep', settings.soundEnabled);
    } catch (error) {
      console.error('Failed to save product:', error);
      window.alert(
        `Product was not added. ${
          error instanceof Error ? error.message : 'Cloud save failed.'
        }`,
      );
    }
  };

  const handleUpdateProduct = async (updated: Product) => {
    if (isCashier) return;
    if (!requireCloudInventoryReady()) return;

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        const saved = await dal.updateProduct?.(updated.id, updated);
        const resolved = saved || updated;
        setProducts((previous) => previous.map((p) => p.id === resolved.id ? resolved : p));
        setCart((previous) => previous.map((item) => item.product.id === resolved.id ? { ...item, product: resolved } : item));
        playSound('beep', settings.soundEnabled);
        return;
      } catch (error) {
        console.error('[SQLITE_PRODUCT] Failed to update product:', error);
        window.alert(`Product changes were not saved: ${error instanceof Error ? error.message : 'Database error'}`);
        return;
      }
    }

    try {
      if (isCloudMode) {
        await saveCloudPosRecord({
          record_type: 'product',
          record_id: updated.id,
          data: updated,
        });
      }

      setProducts((previous) =>
        previous.map((product) =>
          product.id === updated.id ? updated : product,
        ),
      );

      setCart((previous) =>
        previous.map((item) =>
          item.product.id === updated.id
            ? { ...item, product: updated }
            : item,
        ),
      );

      playSound('beep', settings.soundEnabled);
    } catch (error) {
      console.error('Failed to update product:', error);
      window.alert(
        `Product changes were not saved. ${
          error instanceof Error ? error.message : 'Cloud save failed.'
        }`,
      );
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (isCashier) return;
    if (!requireCloudInventoryReady()) return;

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        await dal.deleteProduct?.(productId);
        setProducts((previous) => previous.filter((product) => product.id !== productId));
        setCart((previous) => previous.filter((item) => item.product.id !== productId));
        return;
      } catch (error: any) {
        if (error instanceof ApiClientError && error.status === 409) {
          const archive = window.confirm(
            'This product is referenced in historical sales and cannot be deleted. Would you like to archive it instead?',
          );
          if (archive) {
            try {
              const dal = getDataAccessLayer();
              await dal.archiveProduct?.(productId);
              setProducts((previous) => previous.filter((product) => product.id !== productId));
              setCart((previous) => previous.filter((item) => item.product.id !== productId));
              return;
            } catch (archiveErr: any) {
              window.alert(`Failed to archive product: ${archiveErr?.message || 'Database error'}`);
              return;
            }
          }
          return;
        }
        console.error('[SQLITE_PRODUCT] Failed to delete product:', error);
        window.alert(`Product was not deleted: ${error instanceof Error ? error.message : 'Database error'}`);
        return;
      }
    }

    try {
      if (isCloudMode) {
        await deleteCloudPosRecord('product', productId);
      }

      setProducts((previous) =>
        previous.filter((product) => product.id !== productId),
      );

      setCart((previous) =>
        previous.filter((item) => item.product.id !== productId),
      );
    } catch (error) {
      console.error('Failed to delete product:', error);
      window.alert(
        `Product was not deleted. ${
          error instanceof Error ? error.message : 'Cloud delete failed.'
        }`,
      );
    }
  };

  const handleAdjustStock = async (
    productId: string,
    delta: number,
  ) => {
    if (!requireCloudInventoryReady()) return;

    const currentProduct = products.find(
      (product) => product.id === productId,
    );

    if (!currentProduct) return;

    const updatedProduct: Product = {
      ...currentProduct,
      stock: Math.max(0, currentProduct.stock + delta),
    };

    try {
      if (isCloudMode) {
        await saveCloudPosRecord({
          record_type: 'product',
          record_id: updatedProduct.id,
          data: updatedProduct,
        });
      }

      setProducts((previous) =>
        previous.map((product) =>
          product.id === productId ? updatedProduct : product,
        ),
      );

      setCart((previous) =>
        previous.map((item) =>
          item.product.id === productId
            ? { ...item, product: updatedProduct }
            : item,
        ),
      );
    } catch (error) {
      console.error('Failed to adjust product stock:', error);
      window.alert(
        `Stock was not changed. ${
          error instanceof Error ? error.message : 'Cloud save failed.'
        }`,
      );
    }
  };

  const handleAddCustomer = async (
    customerData: Omit<
      Customer,
      'id' | 'createdAt' | 'totalOrders' | 'totalSpent' | 'loyaltyPoints'
    >,
  ) => {
    if (isCloudMode) {
      window.alert(
        'Cloud customer creation is not enabled yet. No customer was added.',
      );
      return;
    }

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        const created = await dal.createCustomer?.(customerData);
        if (created) {
          setCustomers((previous) => [...previous, created]);
          setSelectedCustomer(created);
        }
        return;
      } catch (error) {
        console.error('[SQLITE_CUSTOMER] Failed to add customer:', error);
        window.alert(`Customer was not added: ${error instanceof Error ? error.message : 'Database error'}`);
        return;
      }
    }

    const customer: Customer = {
      ...customerData,
      id: `cust-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0],
      totalOrders: 0,
      totalSpent: 0,
      loyaltyPoints: 0,
    };

    setCustomers((previous) => [...previous, customer]);
    setSelectedCustomer(customer);
  };

  const handleDeleteCustomer = (customerId: string) => {
    if (
      customerId === 'walk-in' ||
      customerId === 'cust-walkin'
    ) {
      return;
    }

    if (isCloudMode) {
      window.alert(
        'Cloud customer deletion is not enabled yet. No customer was deleted.',
      );
      return;
    }

    setCustomers((previous) =>
      previous.filter((customer) => customer.id !== customerId),
    );

    setSelectedCustomer((previous) =>
      previous.id === customerId ? WALK_IN_CUSTOMER : previous,
    );
  };

  const handleResumeSale = (held: HeldSale) => {
    if (isCloudMode) {
      window.alert(
        'Cloud held-sale updates are not enabled yet.',
      );
      return;
    }

    if (
      cart.length > 0 &&
      !window.confirm(
        'Current cart has items. Overwrite with resumed order?',
      )
    ) {
      return;
    }

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        void dal.deleteHeldSale?.(held.id);
      } catch (err) {
        console.error('[SQLITE_HELD] Failed to delete held sale on resume:', err);
      }
    }

    setCart(held.items);
    setSelectedCustomer(held.customer ?? WALK_IN_CUSTOMER);
    setHeldSales((previous) =>
      previous.filter((item) => item.id !== held.id),
    );
    setIsHeldOpen(false);
    setActiveTab('register');
  };

  const handleDiscardHeldSale = (id: string) => {
    if (isCloudMode) {
      window.alert(
        'Cloud held-sale deletion is not enabled yet.',
      );
      return;
    }

    if (!isCloudMode && getDataAccessMode() === 'sqlite') {
      try {
        const dal = getDataAccessLayer();
        void dal.deleteHeldSale?.(id);
      } catch (err) {
        console.error('[SQLITE_HELD] Failed to delete held sale:', err);
      }
    }

    setHeldSales((previous) =>
      previous.filter((held) => held.id !== id),
    );
  };

  const handleResetDemoData = () => {
    if (isCloudMode) {
      window.alert(
        'Reset Demo Data is disabled in Cloud Mode. Cloud records have not been changed.',
      );
      return;
    }

    if (getDataAccessMode() === 'sqlite') {
      window.alert(
        'Reset Demo Data is not available in SQLite mode. Use the Migration tools in Settings to manage data.',
      );
      return;
    }

    const confirmed = window.confirm(
      'This will remove products, customers, sales, held orders, and categories saved by this POS in this browser. Store settings will be preserved. Back up genuine business records before continuing. Continue?',
    );

    if (!confirmed) return;

    try {
      removeBusinessItem('pos_products');
      removeBusinessItem('pos_customers');
      removeBusinessItem('pos_sales');
      removeBusinessItem('pos_held');
      removeBusinessItem('pos_categories');
    } catch (error) {
      console.error('Failed to reset POS data:', error);
      window.alert(
        'The POS data could not be reset. Check browser storage permissions.',
      );
      return;
    }

    setProducts([]);
    setCategories([]);
    setCustomers([]);
    setSales([]);
    setHeldSales([]);
    setCart([]);
    setSelectedCustomer(WALK_IN_CUSTOMER);
    setDiscount(0);
    setDiscountType('fixed');
    setNextInvoiceSeq(42);
    setIsPaymentOpen(false);
    setIsReceiptOpen(false);
    setActiveReceiptSale(null);
    setIsHeldOpen(false);
  };

  if (!isCloudMode && !offlineUser) {
    return (
      <div>
        {isTestMode && (
          <div className="sticky top-0 z-50 flex items-center justify-between border-b border-amber-600/40 bg-amber-500/90 px-4 py-2 text-xs font-semibold text-slate-950 backdrop-blur-sm shadow-md">
            <div className="flex items-center gap-2">
              <span className="rounded bg-black/20 px-2 py-0.5 uppercase tracking-wider font-bold">TEST MODE</span>
              <span>Isolated SQLite Backend Active (Disposable Test Database) — LocalStorage Data Is Untouched</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setTestSqliteMode(false);
                setIsTestMode(false);
                window.location.reload();
              }}
              className="rounded bg-slate-900 px-3 py-1 font-bold text-white hover:bg-slate-800 transition"
            >
              Exit Test Mode
            </button>
          </div>
        )}
        <OfflineLogin onLogin={(user)=>{
          setOfflineBusiness(user.businessId||LEGACY_ID);
          setIsHydrated(false);
          // loadInitialData (triggered by setOfflineUser below) will fetch all data from
          // SQLite — no need to seed React state from localStorage here.
          setOfflineUser(user);setActiveTab('register');
        }} />
      </div>
    );
  }

  return (
    <div>
      {isTestMode && (
        <div className="sticky top-0 z-50 flex items-center justify-between border-b border-amber-600/40 bg-amber-500/90 px-4 py-2 text-xs font-semibold text-slate-950 backdrop-blur-sm shadow-md">
          <div className="flex items-center gap-2">
            <span className="rounded bg-black/20 px-2 py-0.5 uppercase tracking-wider font-bold">TEST MODE</span>
            <span>Isolated SQLite Backend Active (Disposable Test Database) — LocalStorage Data Is Untouched</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setTestSqliteMode(false);
              setIsTestMode(false);
              window.location.reload();
            }}
            className="rounded bg-slate-900 px-3 py-1 font-bold text-white hover:bg-slate-800 transition"
          >
            Exit Test Mode
          </button>
        </div>
      )}
      {isCloudMode && cloudLoadStatus !== 'idle' && (
        <div
          role={cloudLoadStatus === 'error' ? 'alert' : 'status'}
          className={`border-b px-4 py-2 text-sm ${
            cloudLoadStatus === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              : cloudHasLoaded
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-blue-500/30 bg-blue-500/10 text-blue-200'
          }`}
        >
          {isCloudLoading && 'Loading this business from Supabase…'}
          {cloudHasLoaded &&
            `Cloud records loaded. ${products.length} products, ${customers.length} customers, and ${sales.length} sales. Inventory changes will be saved to Supabase.`}
          {cloudLoadStatus === 'error' &&
            `Cloud data could not be loaded: ${cloudLoadError}`}
        </div>
      )}

      <BusinessSetupModal
        open={needsBusinessSetup || businessSetupOpen}
        canClose={!needsBusinessSetup}
        busy={businessSetupBusy}
        currentCategories={categories}
        onClose={() => setBusinessSetupOpen(false)}
        onApply={applyBusinessSetup}
      />
      <div
        data-theme="light"
        className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-950 font-sans text-slate-100 selection:bg-blue-600 selection:text-white"
      >
        <LocalBackupScheduler />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            settings={settings}
            activeTab={activeTab}
            cashierMode={isCashier}
            showExpenses={!isCloudMode}
            showUsers={!!offlineUser || canManageUsers}
            onTabChange={(tab) => {
              if (isCashier && !['register', 'customers', 'users'].includes(tab)) return;
              setActiveTab(tab);
              playSound('click', settings.soundEnabled);
            }}
            cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((previous) => !previous)}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TopBar
              settings={settings}
              activeTab={activeTab}
              heldCount={heldSales.length}
              onOpenHeld={() => setIsHeldOpen(true)}
              onOpenShortcuts={() => setIsShortcutsOpen(true)}
              onToggleSound={() => {
                setSettings((previous) => ({
                  ...previous,
                  soundEnabled: !previous.soundEnabled,
                }));
                playSound('click', true);
              }}
              onToggleMobileSidebar={() => setIsSidebarOpen(true)}
            />
            <main className={`flex min-h-0 min-w-0 flex-1 flex-col ${activeTab === 'register' ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto'}`}>
              {activeTab === 'users' && !isCloudMode && offlineUser && (
                <section className="mx-auto w-full max-w-5xl px-5 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#EAE6F6] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F0ECFF] text-lg font-bold text-[#6347D9]">{offlineDisplayName(offlineUser).charAt(0).toUpperCase()}</div>
                      <div><h2 className="font-bold text-[#211D35]">My Account</h2><p className="text-sm text-[#625B78]">{offlineDisplayName(offlineUser)} · <span className="capitalize">{offlineUser.role}</span></p><p className="mt-1 text-xs text-[#756E89]">{offlineUser.role === 'owner' ? 'Administrator · ' : ''}Terminal {settings.terminalId}</p></div>
                    </div>
                    <button type="button" onClick={async () => {
                      try { await posApiClient.logout(); } catch {}
                      setIsHydrated(false);
                      setOfflineUser(null);
                      setOfflineBusiness(null);
                      setActiveTab('register');
                      setCart([]);
                    }} className="rounded-xl bg-[#7357E8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6045D2]">Switch User / Lock</button>
                  </div>
                </section>
              )}
              {activeTab === 'users' && !isCloudMode && offlineUser && canManageUsers && (
                <OfflineUsers key={offlineUsersVersion} businessId={offlineUser.businessId||LEGACY_ID} role={offlineUser.role as 'owner'|'manager'} onChange={()=>setOfflineUsersVersion(v=>v+1)} />
              )}
              {activeTab === 'users' && isCloudMode && activeBusinessId && (businessRole === 'owner' || businessRole === 'manager') && (
                <UsersView businessId={activeBusinessId} role={businessRole} />
              )}
              {activeTab === 'dashboard' && !isCashier && (
                <DashboardView
                  products={products}
                  sales={sales}
                  customers={customers}
                  settings={settings}
                  onNavigate={(tab) => { if (!isCashier) setActiveTab(tab); }}
                  onViewReceipt={(sale) => {
                    setActiveReceiptSale(sale);
                    setIsReceiptOpen(true);
                  }}
                />
              )}
          {activeTab === 'register' && (
            <RegisterView
              products={products}
              cart={cart}
              customers={customers}
              selectedCustomer={selectedCustomer}
              onSelectCustomer={(customer) => {
                setSelectedCustomer(customer);
              }}
              onAddToCart={handleAddToCart}
              onUpdateQuantity={handleUpdateQuantity}
              onSetQuantity={handleSetQuantity}
              onRemoveFromCart={handleRemoveFromCart}
              onClearCart={handleClearCart}
              onHoldCart={handleHoldCart}
              onOpenPayment={() => {
                if (isCloudMode && !cloudHasLoaded) {
                  window.alert('Cloud data is not ready yet. Please wait for loading to finish.');
                  return;
                }
                if (!checkoutIdempotencyKeyRef.current) {
                  checkoutIdempotencyKeyRef.current = createIdempotencyKey('sale');
                }
                setIsPaymentOpen(true);
              }}
              discount={discount}
              discountType={discountType}
              onChangeDiscount={(value, type) => {
                setDiscount(value);
                setDiscountType(type);
              }}
              settings={settings}
              categories={visibleCategories}
              invoiceNumber={currentInvoiceNumber}
            />
          )}

          {activeTab === 'inventory' && !isCashier && (
            <InventoryView
              products={products}
              categories={visibleCategories}
              settings={settings}
              onAddProduct={handleAddProduct}
              onUpdateProduct={handleUpdateProduct}
              onDeleteProduct={handleDeleteProduct}
              onAdjustStock={handleAdjustStock}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersView
              customers={customers}
              settings={settings}
              onAddCustomer={handleAddCustomer}
              onSettleKhata={handleSettleKhata}
              onDeleteCustomer={handleDeleteCustomer}
            />
          )}

          {activeTab === 'expenses' && !isCashier && !isCloudMode && (
            <ExpensesReportsView sales={sales} expenses={expenses} settings={settings}
              onAdd={async item => {
                if (getDataAccessMode() === 'sqlite') {
                  try {
                    const dal = getDataAccessLayer();
                    await dal.createExpense?.(item);
                  } catch (err) {
                    console.error('[SQLITE_EXPENSE] Failed to create expense:', err);
                  }
                }
                setExpenses(current => [...current, item]);
              }}
              onUpdate={item => setExpenses(current => current.map(e => e.id === item.id ? item : e))}
              onDelete={async id => {
                if (getDataAccessMode() === 'sqlite') {
                  try {
                    const dal = getDataAccessLayer();
                    await dal.deleteExpense?.(id);
                  } catch (err) {
                    console.error('[SQLITE_EXPENSE] Failed to delete expense:', err);
                  }
                }
                setExpenses(current => current.filter(e => e.id !== id));
              }}
            />
          )}

          {activeTab === 'sales' && !isCashier && (
            <SalesHistoryView
              sales={sales}
              settings={settings}
              onViewReceipt={(sale) => {
                setActiveReceiptSale(sale);
                setIsReceiptOpen(true);
              }}
              onRefundSale={handleRefundSale}
            />
          )}

          {activeTab === 'settings' && !isCashier && (
            <div className="flex flex-col">
              <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EAE6F6] bg-white p-4 shadow-sm">
                <div><p className="font-bold text-[#242824]">Business category template</p><p className="text-sm text-[#59645B]">{businessType ? `Current type: ${businessType}` : 'Existing categories preserved'} · Add industry-specific categories without deleting products.</p></div>
                <button type="button" onClick={() => setBusinessSetupOpen(true)} className="rounded-xl bg-[#7357E8] px-4 py-2 text-sm font-bold text-white hover:bg-[#6045D2]">Change Business Type</button>
              </div>
            <SettingsView
              settings={settings}
              onUpdateSettings={async (newSettings) => {
                if (isCloudMode) {
                  window.alert(
                    'Cloud settings cannot be saved yet. No settings were changed.',
                  );
                  return;
                }
                if (getDataAccessMode() === 'sqlite') {
                  try {
                    const dal = getDataAccessLayer();
                    await dal.saveSettings(newSettings);
                  } catch (err) {
                    console.error('[SQLITE_SETTINGS] Failed to save settings:', err);
                  }
                }
                setSettings(newSettings);
              }}
              onResetDemoData={handleResetDemoData}
            />
            </div>
          )}
            </main>
          </div>
        </div>

        <PaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          cart={cart}
          subtotal={subtotal}
          discount={calculatedDiscount}
          tax={calculatedTax}
          total={grandTotal}
          customer={selectedCustomer}
          settings={settings}
          onCompleteSale={handleCompleteSale}
        />

        <ReceiptModal
          isOpen={isReceiptOpen}
          onClose={() => setIsReceiptOpen(false)}
          sale={activeReceiptSale}
          settings={settings}
        />

        <HeldSalesModal
          isOpen={isHeldOpen}
          onClose={() => setIsHeldOpen(false)}
          heldSales={heldSales}
          onResumeSale={handleResumeSale}
          onDiscardHeldSale={handleDiscardHeldSale}
          settings={settings}
        />

        <ShortcutsModal
          isOpen={isShortcutsOpen}
          onClose={() => setIsShortcutsOpen(false)}
        />
      </div>
    </div>
  );
}

export default function PosPage() {
  return (
    <PosAccessGate>
      <PosPageContent />
    </PosAccessGate>
  );
}
