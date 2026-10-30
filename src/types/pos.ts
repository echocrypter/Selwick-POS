
export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  costPrice: number;
  stock: number;
  minStockAlert: number;
  description?: string;
  badge?: string;
  iconType:
    | 'charger'
    | 'cable'
    | 'earbuds'
    | 'glass'
    | 'case'
    | 'powerbank'
    | 'keyboard'
    | 'printer'
    | 'other';
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  customPrice?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  balance: number;
  loyaltyPoints: number;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'bank_transfer' | 'sadapay' | 'easypaisa' | 'nayapay' | 'jazzcash' | 'raast' | 'credit';

export interface Sale {
  id: string;
  invoiceNumber: string;
  timestamp: string;
  dateStr: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  discountType: 'fixed' | 'percent';
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountTendered: number;
  changeDue: number;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  notes?: string;
  terminalId: string;
  status: 'completed' | 'refunded' | 'cancelled';
}

export interface HeldSale {
  id: string;
  invoiceNumber: string;
  dateStr: string;
  timestamp: number;
  items: CartItem[];
  customer?: Customer;
  note?: string;
}

export interface StoreSettings {
  storeName: string;
  tagline: string;
  phone: string;
  address: string;
  terminalId: string;
  version: string;
  currencySymbol: string;
  taxRate: number;
  enableTax: boolean;
  defaultDiscount: number;
  receiptHeader: string;
  receiptFooter: string;
  soundEnabled: boolean;
  printerPaperWidth: '58mm' | '80mm';

  // Optional so existing saved settings and older backup files remain compatible.
  theme?: 'light' | 'dark';
  businessType?: string;
}
