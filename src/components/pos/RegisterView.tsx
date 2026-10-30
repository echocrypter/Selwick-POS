'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Barcode,
  Plus,
  Minus,
  Trash2,
  Pause,
  ArrowRight,
  User,
  X,
  Zap,
  Tag,
  SlidersHorizontal,
  Smartphone,
  Headphones,
  Shield,
  BatteryCharging,
  Keyboard,
  Printer,
  Package,
  Percent,
} from 'lucide-react';
import { Product, CartItem, Customer, StoreSettings } from '@/types/pos';
import { playSound } from '@/utils/sound';

interface RegisterViewProps {
  products: Product[];
  cart: CartItem[];
  customers: Customer[];
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onClearCart: () => void;
  onHoldCart: () => void;
  onOpenPayment: () => void;
  discount: number;
  discountType: 'fixed' | 'percent';
  onChangeDiscount: (amount: number, type: 'fixed' | 'percent') => void;
  settings: StoreSettings;
  categories: string[];
  invoiceNumber: string;
}

export const RegisterView: React.FC<RegisterViewProps> = ({
  products,
  cart,
  customers,
  selectedCustomer,
  onSelectCustomer,
  onAddToCart,
  onUpdateQuantity,
  onSetQuantity,
  onRemoveFromCart,
  onClearCart,
  onHoldCart,
  onOpenPayment,
  discount,
  discountType,
  onChangeDiscount,
  settings,
  categories,
  invoiceNumber,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Items');
  useEffect(() => {
    if (!categories.includes(selectedCategory)) setSelectedCategory('All Items');
  }, [categories, selectedCategory]);
  const [sortBy, setSortBy] = useState<
    'name' | 'price-asc' | 'price-desc' | 'stock'
  >('name');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [tempDiscount, setTempDiscount] = useState(discount);
  const [tempDiscountType, setTempDiscountType] = useState(discountType);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use a safe fallback for display when there are no registered customers.
  const displayCustomer = selectedCustomer;

  // Focus the search input when F2 is pressed.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter and sort products without mutating the original products array.
  const filteredProducts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return [...products]
      .filter((product) => {
        const matchesCategory =
          selectedCategory === 'All Items' ||
          product.category?.toLowerCase() === selectedCategory.toLowerCase();

        const matchesSearch =
          !query ||
          product.name?.toLowerCase().includes(query) ||
          product.sku?.toLowerCase().includes(query) ||
          product.barcode?.toLowerCase().includes(query);

        return matchesCategory && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'price-asc') return a.price - b.price;
        if (sortBy === 'price-desc') return b.price - a.price;
        if (sortBy === 'stock') return a.stock - b.stock;
        return a.name.localeCompare(b.name);
      });
  }, [products, selectedCategory, searchQuery, sortBy]);

  // Barcode or Enter quick-add.
  const handleSearchKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key !== 'Enter' || !searchQuery.trim()) return;

    const query = searchQuery.trim().toLowerCase();

    const exactMatch = products.find(
      (product) =>
        product.barcode?.toLowerCase() === query ||
        product.sku?.toLowerCase() === query
    );

    if (exactMatch) {
      if (exactMatch.stock > 0) {
        onAddToCart(exactMatch);
        setSearchQuery('');
      } else {
        playSound('error', settings.soundEnabled);
      }
      return;
    }

    if (filteredProducts.length === 1) {
      const product = filteredProducts[0];

      if (product.stock > 0) {
        onAddToCart(product);
        setSearchQuery('');
      } else {
        playSound('error', settings.soundEnabled);
      }
    }
  };

  // Cart subtotal.
  const subtotal = useMemo(
    () =>
      cart.reduce((total, item) => {
        const unitPrice = item.customPrice ?? item.product.price;
        return (
          total +
          Math.max(0, unitPrice * item.quantity - (item.discount || 0))
        );
      }, 0),
    [cart]
  );

  // Discount calculation.
  const calculatedDiscount = useMemo(() => {
    if (discountType === 'percent') {
      const safePercentage = Math.min(100, Math.max(0, discount));
      return Math.round((subtotal * safePercentage) / 100);
    }

    return Math.min(subtotal, Math.max(0, discount));
  }, [subtotal, discount, discountType]);

  // Tax calculation.
  const calculatedTax = useMemo(() => {
    if (!settings.enableTax || settings.taxRate <= 0) return 0;

    const taxableAmount = Math.max(0, subtotal - calculatedDiscount);
    return Math.round((taxableAmount * settings.taxRate) / 100);
  }, [
    subtotal,
    calculatedDiscount,
    settings.enableTax,
    settings.taxRate,
  ]);

  const grandTotal = Math.max(
    0,
    subtotal - calculatedDiscount + calculatedTax
  );

  const totalItemCount = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  // Product icon helper.
  const getProductIcon = (iconType: Product['iconType']) => {
    switch (iconType) {
      case 'charger':
        return <Zap className="w-5 h-5 text-amber-400" />;
      case 'cable':
        return <BatteryCharging className="w-5 h-5 text-orange-400" />;
      case 'earbuds':
        return <Headphones className="w-5 h-5 text-purple-400" />;
      case 'glass':
      case 'case':
        return <Shield className="w-5 h-5 text-emerald-400" />;
      case 'keyboard':
        return <Keyboard className="w-5 h-5 text-sky-400" />;
      case 'printer':
        return <Printer className="w-5 h-5 text-cyan-400" />;
      default:
        return <Smartphone className="w-5 h-5 text-blue-400" />;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 lg:flex-row">
      {/* LEFT: Product catalog and search */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-800/80 bg-slate-900/50">
        {/* Search and filter toolbar */}
        <div className="flex flex-col items-center justify-between gap-2.5 border-b border-slate-800 bg-slate-900/90 p-3 sm:flex-row">
          <div className="relative w-full flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

            <input
              ref={searchInputRef}
              type="text"
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by name, SKU, or scan barcode (F2)..."
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-24 text-sm text-slate-100 shadow-inner transition-all placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {searchQuery ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}

              <span className="hidden items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 sm:inline-flex">
                <Barcode className="h-3 w-3 text-cyan-400" />
                Enter
              </span>
            </div>
          </div>

          {/* Sort selector */}
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />

              <select
                aria-label="Sort products"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as
                      | 'name'
                      | 'price-asc'
                      | 'price-desc'
                      | 'stock'
                  )
                }
                className="cursor-pointer border-none bg-transparent text-xs text-slate-200 focus:outline-none"
              >
                <option value="name" className="bg-slate-900">
                  Name (A-Z)
                </option>
                <option value="price-asc" className="bg-slate-900">
                  Price: Low to High
                </option>
                <option value="price-desc" className="bg-slate-900">
                  Price: High to Low
                </option>
                <option value="stock" className="bg-slate-900">
                  Lowest Stock
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-slate-800/80 bg-slate-950/70 px-3 py-2">
          {categories.map((category) => {
            const count =
              category === 'All Items'
                ? products.length
                : products.filter(
                    (product) =>
                      product.category?.toLowerCase() ===
                      category.toLowerCase()
                  ).length;

            const isSelected = selectedCategory === category;

            return (
              <button
                type="button"
                key={category}
                onClick={() => {
                  setSelectedCategory(category);
                  playSound('click', settings.soundEnabled);
                }}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 ring-1 ring-blue-400'
                    : 'border border-slate-800/80 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>{category}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                    isSelected
                      ? 'bg-blue-800/80 text-blue-200'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Products grid */}
        <div className="flex-1 overflow-y-auto p-3.5">
          {filteredProducts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-slate-500">
              <Package className="mb-2 h-12 w-12 stroke-[1.5] text-slate-600" />
              <p className="text-base font-medium text-slate-300">
                {products.length === 0
                  ? 'No products added yet'
                  : 'No products found'}
              </p>
              <p className="mt-1 text-center text-xs text-slate-500">
                {products.length === 0
                  ? 'Add your genuine products to begin using the register.'
                  : 'Try adjusting your search query or category filter.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredProducts.map((product) => {
                const isOutOfStock = product.stock <= 0;
                const isLowStock =
                  product.stock > 0 &&
                  product.stock <= product.minStockAlert;
                const inCart = cart.find(
                  (item) => item.product.id === product.id
                );

                return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => {
                      if (!isOutOfStock) {
                        onAddToCart(product);
                      } else {
                        playSound('error', settings.soundEnabled);
                      }
                    }}
                    disabled={isOutOfStock}
                    className={`group relative flex select-none flex-col justify-between rounded-xl border p-3 text-left transition-all duration-150 ${
                      isOutOfStock
                        ? 'cursor-not-allowed border-slate-800/40 bg-slate-900/40 opacity-50'
                        : inCart
                          ? 'border-blue-500/50 bg-blue-950/30 ring-1 ring-blue-500/30 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-900/20 active:scale-[0.98]'
                          : 'border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-850 hover:shadow-md active:scale-[0.98]'
                    }`}
                  >
                    <div className="mb-2 flex w-full items-start justify-between gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 group-hover:border-slate-700">
                        {getProductIcon(product.iconType)}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {product.badge && (
                          <span className="rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">
                            {product.badge}
                          </span>
                        )}

                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            isOutOfStock
                              ? 'border border-rose-500/30 bg-rose-500/20 text-rose-300'
                              : isLowStock
                                ? 'border border-amber-500/30 bg-amber-500/20 text-amber-300'
                                : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {isOutOfStock ? 'Out' : `${product.stock} left`}
                        </span>
                      </div>
                    </div>

                    <div className="mb-2.5">
                      <h3 className="line-clamp-2 text-xs font-semibold leading-tight text-slate-100 transition-colors group-hover:text-blue-300 sm:text-sm">
                        {product.name}
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                        <span>{product.sku}</span>
                      </div>
                    </div>

                    <div className="flex w-full items-center justify-between border-t border-slate-800/80 pt-2">
                      <div>
                        <span className="mr-1 text-[10px] text-slate-400">
                          {settings.currencySymbol}
                        </span>
                        <span className="text-sm font-bold tracking-tight text-white sm:text-base">
                          {product.price.toLocaleString()}
                        </span>
                      </div>

                      {inCart ? (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-md shadow-blue-500/40">
                          {inCart.quantity}
                        </span>
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-slate-400 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart and checkout */}
      <div className="grid h-full min-h-0 w-full shrink-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden border-l border-slate-800 bg-slate-900 shadow-2xl lg:w-96 xl:w-[420px]">
        {/* Cart header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 font-mono text-xs font-bold text-blue-300">
              {invoiceNumber}
            </span>
            <span className="text-xs text-slate-400">Current Sale</span>
          </div>

          {cart.length > 0 && (
            <button
              type="button"
              onClick={onClearCart}
              title="Clear Cart (F8)"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Customer selector */}
        <div className="relative border-b border-slate-800/80 bg-slate-950 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <User className="h-3.5 w-3.5 text-blue-400" />
              Customer:
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setCustomerDropdownOpen((open) => !open)}
                aria-expanded={customerDropdownOpen}
                className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900 px-2 py-1 font-medium text-slate-200 hover:text-white"
              >
                <span className="max-w-[180px] truncate">
                  {displayCustomer?.name || 'Walk-in Sale'}
                </span>
                <span className="text-[10px] text-blue-400">▼</span>
              </button>

              {customerDropdownOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-900 p-1.5 text-xs shadow-2xl">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Select Customer
                  </div>

                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                    {customers.length === 0 ? (
                      <div className="px-2 py-3 text-center text-slate-400">
                        No registered customers yet.
                        <p className="mt-1 text-[10px] text-slate-500">
                          You can still make a walk-in sale.
                        </p>
                      </div>
                    ) : (
                      customers.map((customer) => (
                        <button
                          type="button"
                          key={customer.id}
                          onClick={() => {
                            onSelectCustomer(customer);
                            setCustomerDropdownOpen(false);
                            playSound('click', settings.soundEnabled);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${
                            displayCustomer?.id === customer.id
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <div>
                            <div className="font-semibold">{customer.name}</div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {customer.phone}
                            </div>
                          </div>

                          {customer.balance !== 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                customer.balance > 0
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-emerald-500/20 text-emerald-300'
                              }`}
                            >
                              {customer.balance > 0
                                ? `Due: ${customer.balance}`
                                : `Credit: ${Math.abs(customer.balance)}`}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {displayCustomer && displayCustomer.balance !== 0 && (
            <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-slate-400">
              <span>Account Khata Balance:</span>
              <span
                className={`font-mono font-semibold ${
                  displayCustomer.balance > 0
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {displayCustomer.balance > 0
                  ? `Due: ${settings.currencySymbol} ${displayCustomer.balance.toLocaleString()}`
                  : `Advance Credit: ${settings.currencySymbol} ${Math.abs(displayCustomer.balance).toLocaleString()}`}
              </span>
            </div>
          )}
        </div>

        {/* Cart items */}
        <div className="min-h-0 space-y-2 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-slate-500">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/80">
                <Tag className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm font-semibold text-slate-300">
                Cart is Empty
              </p>
              <p className="mt-1 max-w-[200px] text-xs text-slate-500">
                Click items on the left or scan a barcode with your scanner.
              </p>
            </div>
          ) : (
            cart.map((item) => {
              const unitPrice = item.customPrice ?? item.product.price;
              const itemTotal = Math.max(
                0,
                unitPrice * item.quantity - (item.discount || 0)
              );

              return (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950 p-2.5 shadow-sm transition-all hover:border-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-xs font-semibold text-slate-200">
                      {item.product.name}
                    </h4>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {settings.currencySymbol} {unitPrice.toLocaleString()} each
                    </div>
                  </div>

                  <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                    <button
                      type="button"
                      aria-label={`Decrease ${item.product.name} quantity`}
                      onClick={() => onUpdateQuantity(item.product.id, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                    >
                      <Minus className="h-3 w-3" />
                    </button>

                    <input
                      type="number"
                      min="1"
                      max={item.product.stock}
                      value={item.quantity}
                      aria-label={`${item.product.name} quantity`}
                      onChange={(e) =>
                        onSetQuantity(
                          item.product.id,
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        )
                      }
                      className="w-8 bg-transparent text-center text-xs font-bold text-white focus:outline-none"
                    />

                    <button
                      type="button"
                      aria-label={`Increase ${item.product.name} quantity`}
                      onClick={() => onUpdateQuantity(item.product.id, 1)}
                      disabled={item.quantity >= item.product.stock}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-30"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="pl-2 text-right">
                    <div className="whitespace-nowrap font-mono text-xs font-bold text-white">
                      {settings.currencySymbol} {itemTotal.toLocaleString()}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${item.product.name} from cart`}
                      onClick={() => onRemoveFromCart(item.product.id)}
                      className="mt-0.5 p-0.5 text-slate-500 transition-colors hover:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Totals and checkout */}
        <div className="z-10 min-h-0 space-y-1.5 border-t border-slate-800 bg-slate-950 p-3 text-xs shadow-[0_-8px_22px_rgba(48,30,105,0.06)]">
          <div className="flex items-center justify-between text-slate-400">
            <span>Subtotal ({totalItemCount} items)</span>
            <span className="font-mono text-slate-200">
              {settings.currencySymbol} {subtotal.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setTempDiscount(discount);
                setTempDiscountType(discountType);
                setShowDiscountModal(true);
              }}
              className="flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300"
            >
              <Percent className="h-3 w-3" />
              <span>
                Discount
                {discount > 0
                  ? ` (${discount}${discountType === 'percent' ? '%' : ''})`
                  : ''}
              </span>
            </button>

            <span className="font-mono text-emerald-400">
              {calculatedDiscount > 0
                ? `-${settings.currencySymbol} ${calculatedDiscount.toLocaleString()}`
                : `${settings.currencySymbol} 0`}
            </span>
          </div>

          {settings.enableTax && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Tax ({settings.taxRate}%)</span>
              <span className="font-mono text-slate-200">
                +{settings.currencySymbol} {calculatedTax.toLocaleString()}
              </span>
            </div>
          )}

          <div className="flex items-baseline justify-between border-t border-slate-800 pt-2">
            <span className="text-sm font-bold text-white">GRAND TOTAL</span>
            <div className="text-right">
              <span className="mr-1 text-xs font-bold text-blue-400">
                {settings.currencySymbol}
              </span>
              <span className="font-mono text-2xl font-black tracking-tight text-white">
                {grandTotal.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={onHoldCart}
              disabled={cart.length === 0}
              className="flex items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2 py-2.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-700 disabled:opacity-40"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>Hold (F4)</span>
            </button>

            <button
              type="button"
              onClick={onOpenPayment}
              disabled={cart.length === 0}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 px-3 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>Pay &amp; Charge</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Discount modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">
                Apply Cart Discount
              </h3>
              <button
                type="button"
                aria-label="Close discount dialog"
                onClick={() => setShowDiscountModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTempDiscountType('fixed')}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                    tempDiscountType === 'fixed'
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                >
                  Amount ({settings.currencySymbol})
                </button>

                <button
                  type="button"
                  onClick={() => setTempDiscountType('percent')}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                    tempDiscountType === 'percent'
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                >
                  Percentage (%)
                </button>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Discount Value
                </label>
                <input
                  type="number"
                  min="0"
                  max={tempDiscountType === 'percent' ? 100 : subtotal}
                  value={tempDiscount || ''}
                  onChange={(e) =>
                    setTempDiscount(Math.max(0, parseFloat(e.target.value) || 0))
                  }
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[0, 50, 100, 200].map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => {
                      setTempDiscountType('fixed');
                      setTempDiscount(value);
                    }}
                    className="rounded bg-slate-800 py-1 font-mono text-xs text-slate-300 hover:bg-slate-700"
                  >
                    {value === 0 ? 'Clear' : `${settings.currencySymbol} ${value}`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {[5, 10, 15, 20].map((percentage) => (
                  <button
                    type="button"
                    key={percentage}
                    onClick={() => {
                      setTempDiscountType('percent');
                      setTempDiscount(percentage);
                    }}
                    className="rounded bg-slate-800 py-1 font-mono text-xs text-slate-300 hover:bg-slate-700"
                  >
                    {percentage}% Off
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 border-t border-slate-800 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="flex-1 rounded-xl py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  const safeDiscount =
                    tempDiscountType === 'percent'
                      ? Math.min(100, Math.max(0, tempDiscount))
                      : Math.min(subtotal, Math.max(0, tempDiscount));

                  onChangeDiscount(safeDiscount, tempDiscountType);
                  setShowDiscountModal(false);
                }}
                className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-bold text-white shadow-md hover:bg-blue-500"
              >
                Apply Discount
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};