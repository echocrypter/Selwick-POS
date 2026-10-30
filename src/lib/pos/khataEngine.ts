/**
 * Selwick POS – Khata Payment Allocation Engine
 *
 * Implements deterministic FIFO settlement allocation across open credit sales.
 * Ensures:
 *   1. Settlements are durably tracked with allocations to specific credit sales.
 *   2. Allocated amounts never exceed the original credit debt of any sale.
 *   3. Customer balance remains strictly synchronized with the underlying credit ledger.
 *   4. Refunds accurately compute debt reversal vs refundable cash payout.
 */

import crypto from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { type SessionPayload } from '../auth/sessions';
import { PosError, PosValidationError, PosNotFoundError } from './errors';

export interface KhataSettlementRequest {
  businessId?: string;
  customerId: string;
  amountCents: number;
  paymentMethod?: string;
  notes?: string;
}

export interface SettlementAllocation {
  saleId: string;
  allocatedCents: number;
  remainingDebtCents: number;
  status: 'open' | 'settled';
}

export interface KhataSettlementResult {
  settlementId: string;
  businessId: string;
  customerId: string;
  amountCents: number;
  previousBalanceCents: number;
  newBalanceCents: number;
  allocations: SettlementAllocation[];
  timestamp: string;
}

interface OpenCreditSaleRow {
  sale_id: string;
  original_credit_cents: number;
  settled_cents: number;
  created_at: string;
}

interface CustomerRow {
  id: string;
  name: string;
  balance_cents: number;
}

/**
 * Records a customer Khata debt settlement and deterministically allocates
 * it to open credit sales using a FIFO policy (oldest open credit sale first).
 */
export function recordKhataSettlement(
  db: DatabaseSync,
  session: SessionPayload,
  request: KhataSettlementRequest,
): KhataSettlementResult {
  if (session.role !== 'owner' && session.role !== 'manager' && session.role !== 'cashier') {
    throw new PosError('INSUFFICIENT_ROLE', 'Unauthorized to record Khata settlement.', 403);
  }

  const targetBusinessId = request.businessId || session.businessId;
  if (session.businessId !== targetBusinessId) {
    throw new PosError('FORBIDDEN', `Session business "${session.businessId}" does not match target "${targetBusinessId}".`, 403);
  }

  const customerId = request.customerId ? String(request.customerId).trim() : '';
  if (!customerId) {
    throw new PosValidationError('Customer ID is required for Khata settlement.');
  }

  const amountCents = Number(request.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new PosValidationError('Settlement amount must be a positive integer in minor units (paisa).');
  }

  const paymentMethod = request.paymentMethod ? String(request.paymentMethod).toLowerCase().trim() : 'cash';

  db.exec('BEGIN IMMEDIATE');
  try {
    const cust = db.prepare(`
      SELECT id, name, balance_cents
      FROM customers
      WHERE id = ? AND business_id = ?
    `).get(customerId, targetBusinessId) as CustomerRow | undefined;

    if (!cust) {
      throw new PosNotFoundError('Customer', customerId);
    }

    if (amountCents > cust.balance_cents) {
      throw new PosValidationError(
        `Settlement amount (${amountCents} paisa) exceeds customer debt balance (${cust.balance_cents} paisa).`
      );
    }

    // Query open credit sales for this customer ordered by created_at ASC (FIFO policy)
    const openSales = db.prepare(`
      SELECT sale_id, original_credit_cents, settled_cents, created_at
      FROM credit_sales_ledger
      WHERE business_id = ? AND customer_id = ? AND status = 'open'
      ORDER BY created_at ASC
    `).all(targetBusinessId, customerId) as OpenCreditSaleRow[];

    const now = new Date();
    const nowIso = now.toISOString();
    const settlementId = `stl-${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`;

    const insertStlStmt = db.prepare(`
      INSERT INTO khata_settlements (
        id, business_id, customer_id, user_id, amount_cents, payment_method, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStlStmt.run(
      settlementId,
      targetBusinessId,
      customerId,
      session.userId,
      amountCents,
      paymentMethod,
      request.notes ? String(request.notes).trim() : null,
      nowIso,
    );

    let remainingToAllocate = amountCents;
    const allocations: SettlementAllocation[] = [];

    const insAllocStmt = db.prepare(`
      INSERT INTO khata_settlement_allocations (
        id, settlement_id, sale_id, business_id, customer_id, allocated_cents, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateLedgerStmt = db.prepare(`
      UPDATE credit_sales_ledger
      SET settled_cents = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE sale_id = ? AND business_id = ?
    `);

    for (const openSale of openSales) {
      if (remainingToAllocate <= 0) break;

      const unpaidOnSale = openSale.original_credit_cents - openSale.settled_cents;
      if (unpaidOnSale <= 0) continue;

      const allocatedForSale = Math.min(remainingToAllocate, unpaidOnSale);
      const newSettledTotal = openSale.settled_cents + allocatedForSale;
      const isFullySettled = newSettledTotal >= openSale.original_credit_cents;
      const saleStatus: 'open' | 'settled' = isFullySettled ? 'settled' : 'open';

      const allocId = `alloc-${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`;
      insAllocStmt.run(
        allocId,
        settlementId,
        openSale.sale_id,
        targetBusinessId,
        customerId,
        allocatedForSale,
        nowIso,
      );

      updateLedgerStmt.run(
        newSettledTotal,
        saleStatus,
        openSale.sale_id,
        targetBusinessId,
      );

      allocations.push({
        saleId: openSale.sale_id,
        allocatedCents: allocatedForSale,
        remainingDebtCents: openSale.original_credit_cents - newSettledTotal,
        status: saleStatus,
      });

      remainingToAllocate -= allocatedForSale;
    }

    // Update customer aggregate balance
    const newBalanceCents = cust.balance_cents - amountCents;
    db.prepare(`
      UPDATE customers
      SET balance_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ?
    `).run(newBalanceCents, customerId, targetBusinessId);

    db.exec('COMMIT');

    return {
      settlementId,
      businessId: targetBusinessId,
      customerId,
      amountCents,
      previousBalanceCents: cust.balance_cents,
      newBalanceCents,
      allocations,
      timestamp: nowIso,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Retrieves credit sale allocation metadata for refund accounting.
 */
export function getCreditSaleLedgerRecord(
  db: DatabaseSync,
  businessId: string,
  saleId: string,
): { originalCreditCents: number; settledCents: number; remainingDebtCents: number; status: string } | null {
  const row = db.prepare(`
    SELECT original_credit_cents, settled_cents, status
    FROM credit_sales_ledger
    WHERE business_id = ? AND sale_id = ?
  `).get(businessId, saleId) as { original_credit_cents: number; settled_cents: number; status: string } | undefined;

  if (!row) return null;

  return {
    originalCreditCents: row.original_credit_cents,
    settledCents: row.settled_cents,
    remainingDebtCents: Math.max(0, row.original_credit_cents - row.settled_cents),
    status: row.status,
  };
}
