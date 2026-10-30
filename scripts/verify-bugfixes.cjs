'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'src/components/pos/PaymentModal.tsx'), 'utf8');

let passed = 0;
let failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

console.log('=== Bugfix regression checks ===');

ok('page.tsx guards already-refunded sales', page.includes("if (!sale || sale.status === 'refunded') return;"));
ok('page.tsx handles credit payment method in local refund branch',
  page.includes("if (sale.paymentMethod === 'credit' && sale.customerId)"));
ok('page.tsx computes original debt as total - down payment',
  page.includes('const originalDebt = Math.max(0, sale.total - (sale.amountTendered ?? 0));'));
ok('page.tsx caps reversed debt at current balance',
  page.includes('const debtToReverse = Math.min(') && page.includes('Math.max(0, customer.balance)'));
ok('page.tsx reverses balance, orders, spent, and loyalty for credit refunds',
  page.includes('balance: Math.max(0, customer.balance - debtToReverse)') &&
  page.includes('totalOrders: Math.max(0, customer.totalOrders - 1)') &&
  page.includes('totalSpent: Math.max(0, customer.totalSpent - sale.total)') &&
  page.includes('customer.loyaltyPoints - Math.floor(sale.total / 100)'));

ok('PaymentModal tracks manual amount edits', modal.includes('const [amountDirty, setAmountDirty] = useState<boolean>(false);'));
ok('PaymentModal resets dirty flag on open', modal.includes('setAmountDirty(false);'));
ok('PaymentModal preserves manual amounts in method/total effect', modal.includes('if (amountDirty) return;'));
ok('PaymentModal marks typed input as dirty', modal.includes('setAmountDirty(true);'));
ok('PaymentModal keeps cash default total and credit default 0',
  modal.includes("setAmountTendered(total);") && modal.includes("setAmountTendered(0);"));

console.log(`\nPassed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);