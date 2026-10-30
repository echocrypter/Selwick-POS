
import { Product, Customer, StoreSettings, Sale } from '@/types/pos';

export const INITIAL_CATEGORIES = [
  'All Items',
  'Chargers',
  'Cables',
  'Earphones',
  'Cases and Glass',
  'Power Banks',
  'Printer and Ink',
  'Accessories',
];

export const INITIAL_SETTINGS: StoreSettings = {
  storeName: 'Selwick POS',
  tagline: 'Smart Business Management',
  phone: '',
  address: '',
  terminalId: 'SEL-0001',
  version: 'v1.0',
  currencySymbol: 'Rs',
  taxRate: 0,
  enableTax: false,
  defaultDiscount: 0,
  receiptHeader: 'Thank you for choosing Selwick!',
  receiptFooter: 'Thank you for your business. Visit again!',
  soundEnabled: true,
  printerPaperWidth: '80mm',
};

export const INITIAL_PRODUCTS: Product[] = [];

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_PAST_SALES: Sale[] = [];
