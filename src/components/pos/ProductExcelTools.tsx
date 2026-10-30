
'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, FileUp, Upload } from 'lucide-react';
import type { Product } from '@/types/pos';

type NewProduct = Omit<Product, 'id'>;

interface ProductExcelToolsProps {
  products: Product[];
  onImport: (products: NewProduct[]) => void;
}

const columns = [
  'name',
  'sku',
  'barcode',
  'category',
  'price',
  'costPrice',
  'stock',
  'minStockAlert',
  'iconType',
  'badge',
  'description',
];

const normalize = (value: unknown) =>
  String(value ?? '').trim().toLowerCase();

export function ProductExcelTools({
  products,
  onImport,
}: ProductExcelToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const downloadWorkbook = (rows: object[], filename: string) => {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
    XLSX.writeFile(workbook, filename);
  };

  const downloadTemplate = () => {
    downloadWorkbook(
      [
        {
          name: 'Example Charger',
          sku: 'CHG-001',
          barcode: '8901234567890',
          category: 'Chargers',
          price: 1200,
          costPrice: 800,
          stock: 25,
          minStockAlert: 5,
          iconType: 'charger',
          badge: '',
          description: '20W fast charger',
        },
      ],
      'pos-products-template.xlsx'
    );
  };

  const exportProducts = () => {
    if (!products.length) {
      setMessage('There are no products to export.');
      return;
    }

    downloadWorkbook(
      products.map((p) => ({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category: p.category,
        price: p.price,
        costPrice: p.costPrice,
        stock: p.stock,
        minStockAlert: p.minStockAlert,
        iconType: p.iconType,
        badge: p.badge ?? '',
        description: p.description ?? '',
      })),
      'pos-products.xlsx'
    );

    setMessage(`${products.length} products exported successfully.`);
  };

  const importFile = async (file?: File) => {
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension ?? '')) {
      setMessage('Please select an .xlsx, .xls, or .csv file.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!firstSheet) {
        throw new Error('The workbook has no worksheet.');
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        firstSheet,
        { defval: '' }
      );

      if (!rows.length) {
        throw new Error('The spreadsheet contains no product rows.');
      }

      const imported: NewProduct[] = [];
      const errors: string[] = [];
      const usedSkus = new Set(products.map((p) => normalize(p.sku)));
      const usedBarcodes = new Set(
        products.map((p) => normalize(p.barcode)).filter(Boolean)
      );

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const normalizedRow: Record<string, unknown> = {};

        Object.entries(row).forEach(([key, value]) => {
          normalizedRow[normalize(key).replace(/[\s_-]/g, '')] = value;
        });

        const get = (key: string) =>
          normalizedRow[key.toLowerCase().replace(/[\s_-]/g, '')];

        const name = String(get('name') ?? '').trim();
        const sku = String(get('sku') ?? '').trim();
        const barcode = String(get('barcode') ?? '').trim();
        const category = String(get('category') ?? '').trim();

        const price = Number(get('price'));
        const costPrice = Number(get('costPrice') || 0);
        const stock = Number(get('stock') || 0);
        const minStockAlert = Number(get('minStockAlert') || 5);

        if (!name || !sku || !category) {
          errors.push(`Row ${rowNumber}: name, sku, and category are required.`);
          return;
        }

        if (
          get('price') === '' ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isFinite(costPrice) ||
          costPrice < 0 ||
          !Number.isFinite(stock) ||
          stock < 0 ||
          !Number.isInteger(stock) ||
          !Number.isFinite(minStockAlert) ||
          minStockAlert < 0 ||
          !Number.isInteger(minStockAlert)
        ) {
          errors.push(`Row ${rowNumber}: invalid price, cost, stock, or alert value.`);
          return;
        }

        const normalizedSku = normalize(sku);
        const normalizedBarcode = normalize(barcode);

        if (usedSkus.has(normalizedSku)) {
          errors.push(`Row ${rowNumber}: duplicate SKU "${sku}".`);
          return;
        }

        if (normalizedBarcode && usedBarcodes.has(normalizedBarcode)) {
          errors.push(`Row ${rowNumber}: duplicate barcode "${barcode}".`);
          return;
        }

        const allowedIcons = [
          'charger',
          'cable',
          'earbuds',
          'glass',
          'case',
          'powerbank',
          'keyboard',
          'printer',
          'other',
        ];

        const rawIcon = normalize(get('iconType'));
        const iconType = allowedIcons.includes(rawIcon)
          ? rawIcon
          : 'other';

        imported.push({
          name,
          sku,
          barcode,
          category,
          price,
          costPrice,
          stock,
          minStockAlert,
          iconType: iconType as Product['iconType'],
          badge: String(get('badge') ?? '').trim(),
          description: String(get('description') ?? '').trim(),
        });

        // Also catch duplicates within the spreadsheet itself.
        usedSkus.add(normalizedSku);
        if (normalizedBarcode) usedBarcodes.add(normalizedBarcode);
      });

      if (!imported.length) {
        setMessage(
          `No products imported. ${errors.slice(0, 4).join(' ')}`
        );
        return;
      }

      const proceed = window.confirm(
        `Ready to import ${imported.length} products.` +
          (errors.length
            ? ` ${errors.length} row(s) will be skipped because of errors.`
            : '') +
          '\n\nExisting products will not be overwritten. Continue?'
      );

      if (!proceed) {
        setMessage('Import cancelled.');
        return;
      }

      onImport(imported);

      setMessage(
        `Successfully imported ${imported.length} products.` +
          (errors.length
            ? ` Skipped ${errors.length} invalid or duplicate row(s). First issue: ${errors[0]}`
            : '')
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Import failed: ${error.message}`
          : 'Could not read this spreadsheet.'
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
        <div>
          <h3 className="font-bold text-white">Excel Product Manager</h3>
          <p className="text-xs text-slate-400">
            Import, export, or drag in a spreadsheet of products.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => importFile(e.target.files?.[0])}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          importFile(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? 'border-blue-400 bg-blue-500/10'
            : 'border-slate-700 bg-slate-950/50'
        }`}
      >
        <Upload className="mx-auto mb-2 h-7 w-7 text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">
          Drop your Excel file here
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Supports .xlsx, .xls, and .csv
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <FileUp className="mr-2 inline h-4 w-4" />
          {busy ? 'Importing...' : 'Choose File'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadTemplate}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          <Download className="mr-1 inline h-4 w-4" />
          Download Template
        </button>

        <button
          type="button"
          onClick={exportProducts}
          className="selwick-export-products rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-white bg-emerald-800 hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          <Download className="mr-1 inline h-4 w-4" />
          Export All Products ({products.length})
        </button>
      </div>

      {message && (
        <p
          role="status"
          className="whitespace-pre-wrap break-words text-xs text-slate-300"
        >
          {message}
        </p>
      )}

      <p className="text-xs text-slate-500">
        Required columns: name, sku, category, price. Use the template for
        the correct column names. Duplicate SKUs and barcodes are skipped.
      </p>
    </section>
  );
}
