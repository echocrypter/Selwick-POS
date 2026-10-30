/**
 * Selwick POS – Atomic Refund Engine
 *
 * Implements single-transaction, validated refund processing:
 *   1. Manager/Owner-only role enforcement
 *   2. Strict business scope verification
 *   3. Sale lookup, idempotency replay, and duplicate refund prevention
 *   4. Inventory restoration (optional restock flag)
 *   5. Accurate credit (khata) reversal accounting for split tender & settlements
 *   6. Dedicated append-only refund ledger recording payout status
 *   7. Complete audit trail preservation in sale notes
 *   8. Full atomic rollback on any failure
 */

import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { type SessionPayload } from '../auth/sessions';
import { fromCents } from '../money';
import { type RefundRequest, type RefundResult } from './types';
import {
  PosError,
  PosValidationError,
  PosNotFoundError,
  DuplicateRefundError,
} from './errors';

interface SaleRecord {
  id: string;
  business_id: string;
  invoice_number: string;
  timestamp: string;
  date_str: string;
  total_cents: number;
  amount_tendered_cents: number;
  payment_method: string;
  customer_id: string | null;
  notes: string | null;
  terminal_id: string | null;
  status: string;
}

interface CustomerRow {
  id: string;
  total_orders: number;
  total_spent_cents: number;
  loyalty_points: number;
  balance_cents: number;
}

interface SaleItemRow {
  product_id: string | null;
  quantity: number;
}

interface RefundLedgerRow {
  id: string;
  sale_id: string;
  business_id: string;
  user_id: string;
  amount_cents: number;
  payout_method: string;
  cash_payout_cents: number;
  debt_reversal_cents: number;
  reason: string;
  idempotency_key: string | null;
  payout_status: string;
  timestamp: string;
}

/**
 * Executes an atomic refund on a completed sale.
 */
export function executeRefund(
  db: DatabaseSync,
  session: SessionPayload,
  request: RefundRequest,
): RefundResult {
  // 1. Role Authorization: Only Manager and Owner can process refunds
  if (session.role !== 'owner' && session.role !== 'manager') {
    throw new PosError(
      'INSUFFICIENT_ROLE',
      `Role "${session.role}" is not authorized to process refunds. Manager or Owner approval required.`,
      403,
    );
  }

  // 2. Business Scope Enforcement
  const targetBusinessId = request.businessId || session.businessId;
  if (session.businessId !== targetBusinessId) {
    throw new PosError(
      'FORBIDDEN',
      `Session business "${session.businessId}" does not match target business "${targetBusinessId}".`,
      403,
    );
  }

  // 3. Request Validation
  const saleIdentifier = request.saleId || request.invoiceNumber;
  if (!saleIdentifier || typeof saleIdentifier !== 'string' || !saleIdentifier.trim()) {
    throw new PosValidationError('Refund request requires a valid saleId or invoiceNumber.');
  }

  const idempotencyKey = request.idempotencyKey ? String(request.idempotencyKey).trim() : undefined;

  // 4. Idempotency Replay Check (from append-only refund ledger)
  if (idempotencyKey) {
    const existingRefund = db.prepare(`
      SELECT r.id, r.sale_id, r.business_id, r.amount_cents, r.payout_method,
             r.cash_payout_cents, r.debt_reversal_cents, r.payout_status, r.timestamp,
             s.invoice_number, s.notes
      FROM refund_ledger r
      JOIN sales s ON r.sale_id = s.id
      WHERE r.business_id = ? AND r.idempotency_key = ?
    `).get(targetBusinessId, idempotencyKey) as (RefundLedgerRow & { invoice_number: string; notes: string | null }) | undefined;

    if (existingRefund) {
      return {
        refundId: existingRefund.id,
        saleId: existingRefund.sale_id,
        invoiceNumber: existingRefund.invoice_number,
        status: 'refunded',
        refundedAt: existingRefund.timestamp,
        restockedItemCount: 0,
        reversedTotalCents: existingRefund.amount_cents,
        cashPayoutCents: existingRefund.cash_payout_cents,
        debtReversalCents: existingRefund.debt_reversal_cents,
        payoutMethod: existingRefund.payout_method,
        payoutStatus: existingRefund.payout_status,
        customerUpdated: existingRefund.debt_reversal_cents > 0,
        notes: existingRefund.notes || undefined,
        idempotentReplay: true,
      };
    }
  }

  // 5. Look up Sale
  const sale = db.prepare(`
    SELECT id, business_id, invoice_number, timestamp, date_str, total_cents,
           amount_tendered_cents, payment_method, customer_id, notes, terminal_id, status
    FROM sales
    WHERE (id = ? OR invoice_number = ?) AND business_id = ?
  `).get(saleIdentifier.trim(), saleIdentifier.trim(), targetBusinessId) as SaleRecord | undefined;

  if (!sale) {
    throw new PosNotFoundError('Sale', saleIdentifier);
  }

  // 6. Validate Refund Eligibility
  if (sale.status === 'refunded') {
    throw new DuplicateRefundError(sale.id, sale.invoice_number);
  }

  if (sale.status === 'cancelled') {
    throw new PosValidationError(`Cannot refund sale "${sale.invoice_number}" because it was cancelled.`);
  }

  if (sale.status !== 'completed') {
    throw new PosValidationError(`Cannot refund sale "${sale.invoice_number}" with status "${sale.status}".`);
  }

  // 7. Execute Atomic Refund Transaction
  db.exec('BEGIN IMMEDIATE');
  try {
    // 7a. Authoritative Idempotency Check Inside Write Lock
    if (idempotencyKey) {
      const existingInLock = db.prepare(`
        SELECT r.id, r.sale_id, r.business_id, r.amount_cents, r.payout_method,
               r.cash_payout_cents, r.debt_reversal_cents, r.payout_status, r.timestamp,
               s.invoice_number, s.notes
        FROM refund_ledger r
        JOIN sales s ON r.sale_id = s.id
        WHERE r.business_id = ? AND r.idempotency_key = ?
      `).get(targetBusinessId, idempotencyKey) as (RefundLedgerRow & { invoice_number: string; notes: string | null }) | undefined;

      if (existingInLock) {
        db.exec('ROLLBACK');
        return {
          refundId: existingInLock.id,
          saleId: existingInLock.sale_id,
          invoiceNumber: existingInLock.invoice_number,
          status: 'refunded',
          refundedAt: existingInLock.timestamp,
          restockedItemCount: 0,
          reversedTotalCents: existingInLock.amount_cents,
          cashPayoutCents: existingInLock.cash_payout_cents,
          debtReversalCents: existingInLock.debt_reversal_cents,
          payoutMethod: existingInLock.payout_method,
          payoutStatus: existingInLock.payout_status,
          customerUpdated: existingInLock.debt_reversal_cents > 0,
          notes: existingInLock.notes || undefined,
          idempotentReplay: true,
        };
      }
    }

    const shouldRestock = request.restockItems !== false;
    let restockedItemCount = 0;

    // 7b. Restore Inventory Stock
    if (shouldRestock) {
      const items = db.prepare(`
        SELECT product_id, quantity
        FROM sale_items
        WHERE sale_id = ?
      `).all(sale.id) as SaleItemRow[];

      const restockStmt = db.prepare(`
        UPDATE products
        SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ?
      `);

      for (const it of items) {
        if (it.product_id) {
          restockStmt.run(it.quantity, it.product_id, targetBusinessId);
          restockedItemCount += it.quantity;
        }
      }
    }

    // 7c. Reverse Customer Accounting and Khata Balance via credit_sales_ledger
    let customerUpdated = false;
    let cashPayoutCents = 0;
    let debtReversalCents = 0;
    let payoutMethod = 'cash_payout';
    let payoutStatus: 'completed' | 'pending_manual_reversal' = 'completed';

    if (sale.payment_method === 'credit') {
      if (!sale.customer_id) {
        throw new PosValidationError('Cannot refund credit sale: Missing customer reference on sale.');
      }

      const cust = db.prepare(`
        SELECT id, total_orders, total_spent_cents, loyalty_points, balance_cents
        FROM customers
        WHERE id = ? AND business_id = ?
      `).get(sale.customer_id, targetBusinessId) as CustomerRow | undefined;

      if (!cust) {
        throw new PosValidationError('Cannot refund credit sale: Customer record no longer exists.');
      }

      if (cust.balance_cents < 0) {
        throw new PosValidationError('Cannot refund credit sale: Customer has negative balance; cannot determine safe debt reversal.');
      }

      // Query credit_sales_ledger for exact sale-specific debt & settled allocation
      const creditRow = db.prepare(`
        SELECT original_credit_cents, settled_cents, status
        FROM credit_sales_ledger
        WHERE sale_id = ? AND business_id = ?
      `).get(sale.id, targetBusinessId) as { original_credit_cents: number; settled_cents: number; status: string } | undefined;

      if (!creditRow) {
        throw new PosValidationError('Cannot refund credit sale: No verifiable credit allocation record found for this sale. Rejecting unsafe refund.');
      }

      const originalCreditCents = creditRow.original_credit_cents;
      const settledCreditCents = creditRow.settled_cents;
      const remainingDebtOnSale = Math.max(0, originalCreditCents - settledCreditCents);
      const cashDownPaymentCents = sale.amount_tendered_cents || 0;

      // Reverse only the remaining debt on THIS specific sale
      debtReversalCents = remainingDebtOnSale;
      // Cash payout refunds both the down payment and whatever settled cash was paid towards THIS sale
      cashPayoutCents = cashDownPaymentCents + settledCreditCents;

      payoutMethod = (cashPayoutCents > 0 && debtReversalCents > 0) ? 'split_payout' : (cashPayoutCents > 0 ? 'cash_payout' : 'khata_credit');
      payoutStatus = 'completed';

      const reversedOrders = Math.max(0, cust.total_orders - 1);
      const reversedSpent = Math.max(0, cust.total_spent_cents - sale.total_cents);
      const loyaltyToReverse = Math.floor(fromCents(sale.total_cents) / 100);
      const reversedPoints = Math.max(0, cust.loyalty_points - loyaltyToReverse);
      const reversedBalance = Math.max(0, cust.balance_cents - debtReversalCents);

      db.prepare(`
        UPDATE customers
        SET total_orders = ?, total_spent_cents = ?, loyalty_points = ?, balance_cents = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ?
      `).run(reversedOrders, reversedSpent, reversedPoints, reversedBalance, cust.id, targetBusinessId);

      // Mark credit ledger record as refunded
      db.prepare(`
        UPDATE credit_sales_ledger
        SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
        WHERE sale_id = ? AND business_id = ?
      `).run(sale.id, targetBusinessId);

      customerUpdated = true;
    } else {
      if (sale.payment_method === 'cash') {
        payoutMethod = 'cash_payout';
        cashPayoutCents = sale.total_cents;
        payoutStatus = 'completed';
      } else {
        // Electronic payments: gateway or bank card
        payoutMethod = 'electronic_reversal';
        cashPayoutCents = sale.total_cents;
        payoutStatus = 'pending_manual_reversal';
      }

      if (sale.customer_id) {
        const cust = db.prepare(`
          SELECT id, total_orders, total_spent_cents, loyalty_points, balance_cents
          FROM customers
          WHERE id = ? AND business_id = ?
        `).get(sale.customer_id, targetBusinessId) as CustomerRow | undefined;

        if (cust) {
          const reversedOrders = Math.max(0, cust.total_orders - 1);
          const reversedSpent = Math.max(0, cust.total_spent_cents - sale.total_cents);
          const loyaltyToReverse = Math.floor(fromCents(sale.total_cents) / 100);
          const reversedPoints = Math.max(0, cust.loyalty_points - loyaltyToReverse);

          db.prepare(`
            UPDATE customers
            SET total_orders = ?, total_spent_cents = ?, loyalty_points = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND business_id = ?
          `).run(reversedOrders, reversedSpent, reversedPoints, cust.id, targetBusinessId);

          customerUpdated = true;
        }
      }
    }

    // 7c. Record in Dedicated Append-Only Refund Ledger
    const now = new Date();
    const nowIso = now.toISOString();
    const reason = request.reason?.trim() || 'Customer refund requested';
    const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(session.userId) as { name: string } | undefined;
    const actorName = userRow?.name || session.userId;
    const refundId = `ref-${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`;

    db.prepare(`
      INSERT INTO refund_ledger (
        id, sale_id, business_id, user_id, user_name, user_role,
        amount_cents, payout_method, cash_payout_cents, debt_reversal_cents,
        terminal_id, reason, idempotency_key, payout_status, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      refundId,
      sale.id,
      targetBusinessId,
      session.userId,
      actorName,
      session.role,
      sale.total_cents,
      payoutMethod,
      cashPayoutCents,
      debtReversalCents,
      sale.terminal_id || null,
      reason,
      idempotencyKey || null,
      payoutStatus,
      nowIso,
    );

    // 7d. Update Sale Status and Audit Trail
    const auditEntry = `[REFUNDED ${nowIso} ref:${refundId} by ${actorName} (${session.userId}) role:${session.role}. Reason: ${reason}. Payout: ${payoutMethod} (cash: ${cashPayoutCents}, debt: ${debtReversalCents}, status: ${payoutStatus})]`;
    const finalNotes = sale.notes ? `${sale.notes}\n${auditEntry}` : auditEntry;

    db.prepare(`
      UPDATE sales
      SET status = 'refunded', notes = ?
      WHERE id = ? AND business_id = ?
    `).run(finalNotes, sale.id, targetBusinessId);

    db.exec('COMMIT');

    return {
      refundId,
      saleId: sale.id,
      invoiceNumber: sale.invoice_number,
      status: 'refunded',
      refundedAt: nowIso,
      restockedItemCount,
      reversedTotalCents: sale.total_cents,
      cashPayoutCents,
      debtReversalCents,
      payoutMethod,
      payoutStatus,
      customerUpdated,
      notes: finalNotes,
      idempotentReplay: false,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
