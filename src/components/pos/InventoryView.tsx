'use client';

import React, { useState, useMemo } from 'react';
import { ProductExcelTools } from '@/components/pos/ProductExcelTools';
import {
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  AlertTriangle,
  Edit,
  Trash2,
  TrendingUp,
  DollarSign,
  Tag,
  Check,
  X,
  Layers,
} from 'lucide-react';
import { Product, StoreSettings } from '@/types/pos';
import { playSound } from '@/utils/sound';

interface InventoryViewProps {
  products: Product[];
  categories: string[];
  settings: StoreSettings;
  onAddProduct: (product: Omit<Product, 'id'>) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onAdjustStock: (productId: string, delta: number) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  categories,
  settings,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onAdjustStock,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All Items');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'low' | 'out'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form state
  const [formData, setFormData] = useState<Omit<Product, 'id'>>({
    name: '',
    sku: '',
    barcode: '',
    category: categories[1] || '',
    price: 0,
    costPrice: 0,
    stock: 0,
    minStockAlert: 5,
    iconType: 'other',
    badge: '',
    description: '',
  });

  // KPI Metrics
  const totalStockUnits = useMemo(() => products.reduce((sum, p) => sum + p.stock, 0), [products]);
  const totalRetailValue = useMemo(() => products.reduce((sum, p) => sum + p.price * p.stock, 0), [products]);
  const totalCostValue = useMemo(() => products.reduce((sum, p) => sum + p.costPrice * p.stock, 0), [products]);
  const lowStockCount = useMemo(
    () => products.filter((p) => p.stock > 0 && p.stock <= p.minStockAlert).length,
    [products]
  );
  const outOfStockCount = useMemo(() => products.filter((p) => p.stock <= 0).length, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q);

      const matchesCategory =
        categoryFilter === 'All Items' || p.category.toLowerCase() === categoryFilter.toLowerCase();

      let matchesStock = true;
      if (stockStatusFilter === 'low') matchesStock = p.stock > 0 && p.stock <= p.minStockAlert;
      if (stockStatusFilter === 'out') matchesStock = p.stock <= 0;

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [products, search, categoryFilter, stockStatusFilter]);

  const openAddModal = () => {
    setFormData({
      name: '',
      sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      barcode: `890${Math.floor(100000000 + Math.random() * 900000000)}`,
      category: categories[1] || '',
      price: 500,
      costPrice: 300,
      stock: 20,
      minStockAlert: 5,
      iconType: 'other',
      badge: '',
      description: '',
    });
    setEditingProduct(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormData({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: p.category,
      price: p.price,
      costPrice: p.costPrice,
      stock: p.stock,
      minStockAlert: p.minStockAlert,
      iconType: p.iconType,
      badge: p.badge || '',
      description: p.description || '',
    });
    setIsAddModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.sku.trim()) return;

    if (editingProduct) {
      onUpdateProduct({
        ...formData,
        id: editingProduct.id,
      });
    } else {
      onAddProduct(formData);
    }
    setIsAddModalOpen(false);
    playSound('beep', settings.soundEnabled);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-6 space-y-5">
      <ProductExcelTools
  products={products}
  onImport={(importedProducts) => {
    importedProducts.forEach((product) => {
      onAddProduct(product);
    });
  }}
/>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Total Catalog</span>
            <Package className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">{products.length} Items</div>
          <div className="text-xs text-slate-500 mt-1">{totalStockUnits} units in stock</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Inventory Value</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {settings.currencySymbol} {totalRetailValue.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-400/80 mt-1">
            Cost: {settings.currencySymbol} {totalCostValue.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Low Stock Alert</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{lowStockCount} Items</div>
          <div className="text-xs text-slate-500 mt-1">Requires restock soon</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Out of Stock</span>
            <X className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{outOfStockCount} Items</div>
          <div className="text-xs text-slate-500 mt-1">Zero units remaining</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products by name, SKU, or barcode..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c} className="bg-slate-900">
                  {c}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
              <button
                onClick={() => setStockStatusFilter('all')}
                className={`px-2 py-1 text-xs rounded-lg font-medium transition-all ${
                  stockStatusFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStockStatusFilter('low')}
                className={`px-2 py-1 text-xs rounded-lg font-medium transition-all ${
                  stockStatusFilter === 'low' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Low ({lowStockCount})
              </button>
              <button
                onClick={() => setStockStatusFilter('out')}
                className={`px-2 py-1 text-xs rounded-lg font-medium transition-all ${
                  stockStatusFilter === 'out' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Out ({outOfStockCount})
              </button>
            </div>
          </div>

          <button
            onClick={openAddModal}
            className="w-full md:w-auto px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Product</span>
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Product</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Barcode / SKU</th>
                <th className="p-3.5">Cost Price</th>
                <th className="p-3.5">Selling Price</th>
                <th className="p-3.5">Margin</th>
                <th className="p-3.5">Stock Level</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No products matched your filters.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isOutOfStock = p.stock <= 0;
                  const isLow = p.stock > 0 && p.stock <= p.minStockAlert;
                  const marginPct = p.costPrice > 0 ? Math.round(((p.price - p.costPrice) / p.costPrice) * 100) : 0;

                  return (
                    <tr key={p.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="p-3.5">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>{p.name}</span>
                          {p.badge && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              {p.badge}
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <div className="text-[11px] text-slate-500 truncate max-w-xs">{p.description}</div>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-300 font-medium">{p.category}</td>
                      <td className="p-3.5 font-mono text-[11px] text-slate-400">
                        <div>{p.sku}</div>
                        <div className="text-slate-500">{p.barcode}</div>
                      </td>
                      <td className="p-3.5 font-mono text-slate-400">
                        {settings.currencySymbol} {p.costPrice.toLocaleString()}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-white">
                        {settings.currencySymbol} {p.price.toLocaleString()}
                      </td>
                      <td className="p-3.5 font-mono">
                        <span className="text-emerald-400 font-semibold">+{marginPct}%</span>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                              isOutOfStock
                                ? 'bg-rose-500/20 text-rose-300'
                                : isLow
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-emerald-500/10 text-emerald-400'
                            }`}
                          >
                            {p.stock}
                          </span>
                          {/* Quick Adjust Buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onAdjustStock(p.id, -1)}
                              disabled={p.stock <= 0}
                              className="w-5 h-5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center justify-center disabled:opacity-30"
                              title="Decrease stock by 1"
                            >
                              -
                            </button>
                            <button
                              onClick={() => onAdjustStock(p.id, 1)}
                              className="w-5 h-5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center justify-center"
                              title="Increase stock by 1"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition-colors"
                            title="Edit Product"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete ${p.name}?`)) {
                                onDeleteProduct(p.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                            title="Delete Product"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">
                {editingProduct ? 'Edit Product Details' : 'Add New Inventory Item'}
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-5 overflow-y-auto space-y-3.5 text-xs" autoComplete="off">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Product Name *</label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. 20W Fast Charger"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories
                      .filter((c) => c !== 'All Items')
                      .map((c) => (
                        <option key={c} value={c} className="bg-slate-900">
                          {c}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Badge Tag (Optional)</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={formData.badge}
                    onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                    placeholder="e.g. Fast PD, 9H, TWS"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">SKU Code *</label>
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Barcode</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">
                    Cost Price ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.costPrice}
                    onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">
                    Retail Price ({settings.currencySymbol}) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono font-bold text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Initial Stock Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Low Stock Alert Threshold</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.minStockAlert}
                    onChange={(e) => setFormData({ ...formData, minStockAlert: parseInt(e.target.value) || 5 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Icon Type</label>
                <select
                  value={formData.iconType}
                  onChange={(e) => setFormData({ ...formData, iconType: e.target.value as Product['iconType'] })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none"
                >
                  <option value="charger" className="bg-slate-900">Charger / Adapter</option>
                  <option value="cable" className="bg-slate-900">Cable / Wire</option>
                  <option value="earbuds" className="bg-slate-900">Earbuds / Audio</option>
                  <option value="glass" className="bg-slate-900">Tempered Glass</option>
                  <option value="case" className="bg-slate-900">Phone Cover / Case</option>
                  <option value="powerbank" className="bg-slate-900">Power Bank</option>
                  <option value="keyboard" className="bg-slate-900">Keyboard / Mouse</option>
                  <option value="printer" className="bg-slate-900">Printer & Ink Paper</option>
                  <option value="other" className="bg-slate-900">Other General</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  autoComplete="off"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Short item description or specs..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-md"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
