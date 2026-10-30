/**
 * Selwick POS – Exact-Money Utility (Paisa / Integer Minor Units)
 *
 * Implements strict, lossless financial calculations for currency amounts.
 * All monetary amounts are represented as safe integer minor units (paisa/cents).
 *
 * Guarantees:
 *   1. Zero binary floating-point representation errors (1.14 * 100 !== 113.99).
 *   2. Rejection of NaN, Infinity, unsafe integers, and excessive decimal precision.
 *   3. Explicit commercial rounding rules (half-up) for tax and percentage discounts.
 *   4. Mathematical consistency invariants for subtotal, discount, tax, total, and change.
 */

export const PAISA_PER_RUPEE = 100;
export const MAX_SAFE_MONEY_CENTS = Number.MAX_SAFE_INTEGER;

export type MoneyErrorCode =
  | 'INVALID_TYPE'
  | 'NOT_A_NUMBER'
  | 'NOT_FINITE'
  | 'UNSAFE_INTEGER'
  | 'NOT_AN_INTEGER'
  | 'NEGATIVE_AMOUNT'
  | 'EXCESSIVE_PRECISION'
  | 'INVALID_FORMAT'
  | 'INVALID_PERCENTAGE'
  | 'INCONSISTENT_TOTALS'
  | 'INSUFFICIENT_TENDER';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(
    code: MoneyErrorCode,
    message: string,
  ) {
    super(`[MoneyError:${code}] ${message}`);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/**
 * Asserts that the given value is a safe, finite integer representing minor units (paisa).
 * Throws a typed MoneyError if the assertion fails.
 */
export function assertValidCents(
  cents: unknown,
  allowNegative = false,
  label = 'Amount',
): asserts cents is number {
  if (typeof cents !== 'number') {
    throw new MoneyError('INVALID_TYPE', `${label} must be a number, received ${typeof cents}.`);
  }
  if (Number.isNaN(cents)) {
    throw new MoneyError('NOT_A_NUMBER', `${label} cannot be NaN.`);
  }
  if (!Number.isFinite(cents)) {
    throw new MoneyError('NOT_FINITE', `${label} must be finite, received ${cents}.`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError('UNSAFE_INTEGER', `${label} exceeds maximum safe integer limits: ${cents}.`);
  }
  if (!Number.isInteger(cents)) {
    throw new MoneyError('NOT_AN_INTEGER', `${label} must be an integer in minor units (paisa), received ${cents}.`);
  }
  if (!allowNegative && cents < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `${label} cannot be negative: ${cents}.`);
  }
}

/**
 * Checks if a value is a valid minor unit integer without throwing.
 */
export function isValidCents(cents: unknown, allowNegative = false): boolean {
  try {
    assertValidCents(cents, allowNegative);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a major unit currency amount (number or string, e.g. 150.50 or "150.50")
 * into exact integer minor units (paisa).
 *
 * Rules:
 *   - Rejects NaN, Infinity, -Infinity.
 *   - Rejects strings with more than 2 decimal digits (no silent truncation of fractions of a paisa).
 *   - Uses string-split arithmetic to avoid binary IEEE 754 precision artifacts.
 */
export function toCents(
  amount: number | string,
  allowNegative = false,
  label = 'Amount',
): number {
  if (amount === null || amount === undefined) {
    throw new MoneyError('INVALID_TYPE', `${label} cannot be null or undefined.`);
  }

  let str: string;
  let isNegative = false;

  if (typeof amount === 'number') {
    if (Number.isNaN(amount)) {
      throw new MoneyError('NOT_A_NUMBER', `${label} cannot be NaN.`);
    }
    if (!Number.isFinite(amount)) {
      throw new MoneyError('NOT_FINITE', `${label} must be finite, received ${amount}.`);
    }
    if (!allowNegative && amount < 0) {
      throw new MoneyError('NEGATIVE_AMOUNT', `${label} cannot be negative: ${amount}.`);
    }
    if (amount < 0) {
      isNegative = true;
      amount = Math.abs(amount);
    }
    // Convert to fixed 2 decimal places to capture full user representation
    // but check for excessive decimal precision first
    const rawStr = amount.toString();
    const dotIdx = rawStr.indexOf('.');
    if (dotIdx !== -1 && rawStr.length - dotIdx - 1 > 2) {
      // Check if it's a binary float quirk (e.g. 1.0000000000000002) vs real fractional cents
      const rounded = Math.round(amount * 100) / 100;
      if (Math.abs(amount - rounded) > 1e-6) {
        throw new MoneyError(
          'EXCESSIVE_PRECISION',
          `${label} has more than 2 decimal places: ${rawStr}.`,
        );
      }
      str = rounded.toFixed(2);
    } else {
      str = rawStr;
    }
  } else if (typeof amount === 'string') {
    str = amount.trim();
    if (!str) {
      throw new MoneyError('INVALID_FORMAT', `${label} string cannot be empty.`);
    }
    if (str.startsWith('-')) {
      if (!allowNegative) {
        throw new MoneyError('NEGATIVE_AMOUNT', `${label} cannot be negative: ${str}.`);
      }
      isNegative = true;
      str = str.slice(1);
    } else if (str.startsWith('+')) {
      str = str.slice(1);
    }

    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new MoneyError('INVALID_FORMAT', `${label} is not a valid numeric string: "${amount}".`);
    }

    const dotIdx = str.indexOf('.');
    if (dotIdx !== -1 && str.length - dotIdx - 1 > 2) {
      throw new MoneyError(
        'EXCESSIVE_PRECISION',
        `${label} exceeds 2 decimal places of precision: "${amount}".`,
      );
    }
  } else {
    throw new MoneyError('INVALID_TYPE', `${label} must be number or string, received ${typeof amount}.`);
  }

  // Exact split into major and minor units
  const parts = str.split('.');
  const wholePart = parts[0] || '0';
  const fracPart = (parts[1] || '').padEnd(2, '0').slice(0, 2);

  const major = parseInt(wholePart, 10);
  const minor = parseInt(fracPart, 10);

  if (!Number.isSafeInteger(major)) {
    throw new MoneyError('UNSAFE_INTEGER', `${label} major amount exceeds safe integer range.`);
  }

  const cents = major * PAISA_PER_RUPEE + minor;
  const result = isNegative ? -cents : cents;

  assertValidCents(result, allowNegative, label);
  return result;
}

/**
 * Converts integer minor units (paisa) to a standard floating-point major unit
 * for display or legacy JSON export.
 */
export function fromCents(cents: number, allowNegative = false): number {
  assertValidCents(cents, allowNegative);
  return cents / PAISA_PER_RUPEE;
}

/**
 * Formats minor units (paisa) into a clean, human-readable currency string.
 * Example: formatMoney(145050, 'Rs') → "Rs 1,450.50"
 */
export function formatMoney(
  cents: number,
  currency = 'Rs',
  options?: { hideZeroDecimals?: boolean },
): string {
  assertValidCents(cents, true);
  const isNeg = cents < 0;
  const absCents = Math.abs(cents);
  const major = Math.floor(absCents / PAISA_PER_RUPEE);
  const minor = absCents % PAISA_PER_RUPEE;

  const formattedMajor = major.toLocaleString('en-PK');
  const formattedMinor = String(minor).padStart(2, '0');

  let body: string;
  if (options?.hideZeroDecimals && minor === 0) {
    body = formattedMajor;
  } else {
    body = `${formattedMajor}.${formattedMinor}`;
  }

  const sign = isNeg ? '-' : '';
  return currency ? `${currency} ${sign}${body}` : `${sign}${body}`;
}

// ─── Math Operations with Strict Overflow & Invariant Checks ─────────────────

/**
 * Safely adds two minor-unit integer amounts.
 */
export function add(aCents: number, bCents: number): number {
  assertValidCents(aCents, true, 'Addend A');
  assertValidCents(bCents, true, 'Addend B');
  const sum = aCents + bCents;
  assertValidCents(sum, true, 'Sum');
  return sum;
}

/**
 * Safely subtracts two minor-unit integer amounts.
 */
export function subtract(aCents: number, bCents: number, allowNegative = false): number {
  assertValidCents(aCents, allowNegative, 'Minuend');
  assertValidCents(bCents, allowNegative, 'Subtrahend');
  const diff = aCents - bCents;
  assertValidCents(diff, allowNegative, 'Difference');
  return diff;
}

/**
 * Multiplies minor units by an integer or floating-point multiplier (e.g. quantity or tax).
 * Applies half-up commercial rounding to maintain exact integer minor units.
 */
export function multiply(
  cents: number,
  multiplier: number,
  allowNegative = false,
): number {
  assertValidCents(cents, allowNegative, 'Base amount');
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    throw new MoneyError('NOT_FINITE', `Multiplier must be a finite number: ${multiplier}`);
  }
  if (!allowNegative && multiplier < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `Multiplier cannot be negative: ${multiplier}`);
  }

  // Exact commercial half-up rounding
  const raw = cents * multiplier;
  const rounded = Math.round(raw);
  assertValidCents(rounded, allowNegative, 'Multiplication result');
  return rounded;
}

/**
 * Calculates a percentage discount on a subtotal.
 * Strict half-up rounding to nearest paisa. Capped at subtotal.
 */
export function calculatePercentageDiscount(
  subtotalCents: number,
  percentRate: number,
): number {
  assertValidCents(subtotalCents, false, 'Subtotal');
  if (typeof percentRate !== 'number' || Number.isNaN(percentRate) || !Number.isFinite(percentRate)) {
    throw new MoneyError('INVALID_PERCENTAGE', `Discount rate must be a valid finite number: ${percentRate}`);
  }
  if (percentRate < 0 || percentRate > 100) {
    throw new MoneyError('INVALID_PERCENTAGE', `Discount percentage must be between 0 and 100: ${percentRate}`);
  }

  if (percentRate === 0 || subtotalCents === 0) return 0;
  const rawDiscount = (subtotalCents * percentRate) / 100;
  const discountCents = Math.round(rawDiscount);

  // Guarantee discount never exceeds subtotal
  return Math.min(subtotalCents, discountCents);
}

/**
 * Calculates sales tax on a taxable minor-unit amount.
 * Applies standard commercial half-up rounding.
 */
export function calculateTax(
  taxableCents: number,
  taxRatePercent: number,
): number {
  assertValidCents(taxableCents, false, 'Taxable amount');
  if (typeof taxRatePercent !== 'number' || Number.isNaN(taxRatePercent) || !Number.isFinite(taxRatePercent)) {
    throw new MoneyError('INVALID_PERCENTAGE', `Tax rate must be a valid finite number: ${taxRatePercent}`);
  }
  if (taxRatePercent < 0) {
    throw new MoneyError('INVALID_PERCENTAGE', `Tax rate cannot be negative: ${taxRatePercent}`);
  }

  if (taxRatePercent === 0 || taxableCents === 0) return 0;
  const rawTax = (taxableCents * taxRatePercent) / 100;
  return Math.round(rawTax);
}

/**
 * Input line item for sale totals calculation.
 */
export interface SaleLineItemInput {
  priceCents: number;
  quantity: number;
  discountCents?: number;
  customPriceCents?: number;
}

/**
 * Parameters for computing consistent checkout totals.
 */
export interface CalculateSaleTotalsParams {
  items: SaleLineItemInput[];
  discountType?: 'fixed' | 'percent';
  discountValue?: number; // Cents if 'fixed', percentage (0-100) if 'percent'
  taxRatePercent?: number;
  enableTax?: boolean;
  amountTenderedCents?: number;
}

/**
 * Verified, internally-consistent sale totals.
 */
export interface SaleTotals {
  subtotalCents: number;
  lineDiscountTotalCents: number;
  orderDiscountCents: number;
  totalDiscountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  amountTenderedCents?: number;
  changeDueCents?: number;
}

/**
 * Computes exact, internally-consistent sale totals.
 *
 * Enforces the core monetary invariant:
 *   subtotalCents - totalDiscountCents + taxCents === totalCents
 *
 * If amountTenderedCents is supplied, also computes changeDueCents.
 */
export function calculateSaleTotals(params: CalculateSaleTotalsParams): SaleTotals {
  const {
    items,
    discountType = 'fixed',
    discountValue = 0,
    taxRatePercent = 0,
    enableTax = false,
    amountTenderedCents,
  } = params;

  if (!Array.isArray(items) || items.length === 0) {
    throw new MoneyError('INVALID_FORMAT', 'Sale must have at least one line item.');
  }

  let subtotalCents = 0;
  let lineDiscountTotalCents = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new MoneyError('INVALID_FORMAT', `Item at index ${i} has invalid quantity: ${item.quantity}`);
    }

    const unitPrice = item.customPriceCents !== undefined && item.customPriceCents !== null
      ? item.customPriceCents
      : item.priceCents;

    assertValidCents(unitPrice, false, `Item ${i} unit price`);

    const itemLineGross = unitPrice * item.quantity;
    assertValidCents(itemLineGross, false, `Item ${i} gross line`);
    subtotalCents = add(subtotalCents, itemLineGross);

    const itemDiscount = item.discountCents || 0;
    assertValidCents(itemDiscount, false, `Item ${i} discount`);
    lineDiscountTotalCents = add(lineDiscountTotalCents, itemDiscount);
  }

  // Compute order-level discount
  let orderDiscountCents = 0;
  const remainingAfterLineDiscounts = Math.max(0, subtotalCents - lineDiscountTotalCents);

  if (discountType === 'percent') {
    orderDiscountCents = calculatePercentageDiscount(remainingAfterLineDiscounts, discountValue);
  } else {
    assertValidCents(discountValue, false, 'Order fixed discount');
    orderDiscountCents = Math.min(remainingAfterLineDiscounts, discountValue);
  }

  const totalDiscountCents = Math.min(subtotalCents, lineDiscountTotalCents + orderDiscountCents);
  const taxableCents = Math.max(0, subtotalCents - totalDiscountCents);

  const taxCents = enableTax ? calculateTax(taxableCents, taxRatePercent) : 0;
  const totalCents = taxableCents + taxCents;

  // Verify internal consistency invariant
  if (subtotalCents - totalDiscountCents + taxCents !== totalCents) {
    throw new MoneyError(
      'INCONSISTENT_TOTALS',
      `Monetary invariant violated: subtotal (${subtotalCents}) - discount (${totalDiscountCents}) + tax (${taxCents}) !== total (${totalCents})`,
    );
  }

  let changeDueCents: number | undefined;
  if (amountTenderedCents !== undefined) {
    assertValidCents(amountTenderedCents, false, 'Amount tendered');
    if (amountTenderedCents < totalCents) {
      throw new MoneyError(
        'INSUFFICIENT_TENDER',
        `Amount tendered (${amountTenderedCents} paisa) is less than total amount (${totalCents} paisa).`,
      );
    }
    changeDueCents = amountTenderedCents - totalCents;
  }

  return {
    subtotalCents,
    lineDiscountTotalCents,
    orderDiscountCents,
    totalDiscountCents,
    taxableCents,
    taxCents,
    totalCents,
    amountTenderedCents,
    changeDueCents,
  };
}
