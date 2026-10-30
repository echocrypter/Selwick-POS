/**
 * GET /api/pos/reports/summary
 *
 * Comprehensive financial report summary endpoint.
 * Accurately distinguishes:
 * - Gross sales revenue, discounts, tax
 * - Completed vs refunded sales
 * - Cash actually received (cash sales + cash down payments + cash Khata settlements)
 * - Credit receivables (outstanding customer debt)
 * - Khata settlements (debt collected in period)
 * - Cash refund payouts (physical cash returned from drawer)
 * - Pending electronic refund reversals
 * - Operating expenses
 * - Net cash flow
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInitializedDatabase } from '@/lib/db';
import {
  requireRole,
  AuthError,
  authErrorStatus,
} from '@/lib/auth/authorization';
import { fromCents } from '@/lib/money';

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = requireRole(req, ['cashier', 'manager', 'owner']);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: authErrorStatus(e) });
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;

  const db = getInitializedDatabase();
  const businessId = session.businessId;

  // Build date filter snippets
  let salesDateFilter = '';
  const salesParams: string[] = [businessId];
  if (startDate) {
    salesDateFilter += ' AND s.date_str >= ?';
    salesParams.push(startDate);
  }
  if (endDate) {
    salesDateFilter += ' AND s.date_str <= ?';
    salesParams.push(endDate);
  }

  // 1. Sales Aggregates
  const salesAgg = db.prepare(`
    SELECT
      COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN s.status = 'refunded' THEN 1 END) as refunded_count,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.subtotal_cents ELSE 0 END), 0) as completed_subtotal_cents,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.discount_cents ELSE 0 END), 0) as completed_discount_cents,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.tax_cents ELSE 0 END), 0) as completed_tax_cents,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total_cents ELSE 0 END), 0) as completed_total_cents,
      COALESCE(SUM(CASE WHEN s.status = 'refunded' THEN s.total_cents ELSE 0 END), 0) as refunded_total_cents,
      -- Cash received from cash checkout sales (amount tendered minus change due)
      COALESCE(SUM(CASE WHEN s.status = 'completed' AND s.payment_method = 'cash' THEN (s.amount_tendered_cents - s.change_due_cents) ELSE 0 END), 0) as sales_cash_tendered_cents,
      -- Cash down payment from split credit sales
      COALESCE(SUM(CASE WHEN s.status = 'completed' AND s.payment_method = 'credit' AND s.amount_tendered_cents > 0 THEN s.amount_tendered_cents ELSE 0 END), 0) as credit_down_payment_cents
    FROM sales s
    WHERE s.business_id = ? ${salesDateFilter}
  `).get(...salesParams) as {
    completed_count: number;
    refunded_count: number;
    completed_subtotal_cents: number;
    completed_discount_cents: number;
    completed_tax_cents: number;
    completed_total_cents: number;
    refunded_total_cents: number;
    sales_cash_tendered_cents: number;
    credit_down_payment_cents: number;
  };

  // 2. Refund Ledger Aggregates
  let refundDateFilter = '';
  const refundParams: string[] = [businessId];
  if (startDate) {
    refundDateFilter += ' AND substr(rl.timestamp, 1, 10) >= ?';
    refundParams.push(startDate);
  }
  if (endDate) {
    refundDateFilter += ' AND substr(rl.timestamp, 1, 10) <= ?';
    refundParams.push(endDate);
  }

  const refundAgg = db.prepare(`
    SELECT
      COALESCE(SUM(rl.amount_cents), 0) as total_reversed_cents,
      COALESCE(SUM(rl.cash_payout_cents), 0) as cash_payout_cents,
      COALESCE(SUM(rl.debt_reversal_cents), 0) as debt_reversal_cents,
      COALESCE(SUM(CASE WHEN rl.payout_status = 'pending_manual_reversal' THEN rl.amount_cents ELSE 0 END), 0) as pending_electronic_reversals_cents
    FROM refund_ledger rl
    WHERE rl.business_id = ? ${refundDateFilter}
  `).get(...refundParams) as {
    total_reversed_cents: number;
    cash_payout_cents: number;
    debt_reversal_cents: number;
    pending_electronic_reversals_cents: number;
  };

  // 3. Khata Settlements Aggregates
  let khataDateFilter = '';
  const khataParams: string[] = [businessId];
  if (startDate) {
    khataDateFilter += ' AND substr(ks.created_at, 1, 10) >= ?';
    khataParams.push(startDate);
  }
  if (endDate) {
    khataDateFilter += ' AND substr(ks.created_at, 1, 10) <= ?';
    khataParams.push(endDate);
  }

  const khataAgg = db.prepare(`
    SELECT
      COALESCE(SUM(ks.amount_cents), 0) as total_settlements_cents,
      COALESCE(SUM(CASE WHEN lower(ks.payment_method) = 'cash' THEN ks.amount_cents ELSE 0 END), 0) as cash_settlements_cents
    FROM khata_settlements ks
    WHERE ks.business_id = ? ${khataDateFilter}
  `).get(...khataParams) as {
    total_settlements_cents: number;
    cash_settlements_cents: number;
  };

  // 4. Current Credit Receivables (Outstanding Customer Debt across all customers)
  const custAgg = db.prepare(`
    SELECT COALESCE(SUM(balance_cents), 0) as total_debt_cents
    FROM customers
    WHERE business_id = ?
  `).get(businessId) as { total_debt_cents: number };

  // 5. Operating Expenses
  let expDateFilter = '';
  const expParams: string[] = [businessId];
  if (startDate) {
    expDateFilter += ' AND e.date >= ?';
    expParams.push(startDate);
  }
  if (endDate) {
    expDateFilter += ' AND e.date <= ?';
    expParams.push(endDate);
  }

  const expAgg = db.prepare(`
    SELECT COALESCE(SUM(e.amount_cents), 0) as total_expenses_cents
    FROM expenses e
    WHERE e.business_id = ? ${expDateFilter}
  `).get(...expParams) as { total_expenses_cents: number };

  // Financial Calculations
  const grossSalesCents = salesAgg.completed_total_cents;
  const discountCents = salesAgg.completed_discount_cents;
  const taxCents = salesAgg.completed_tax_cents;
  const subtotalCents = salesAgg.completed_subtotal_cents;

  const cashActuallyReceivedCents =
    salesAgg.sales_cash_tendered_cents +
    salesAgg.credit_down_payment_cents +
    khataAgg.cash_settlements_cents;

  const cashRefundPayoutsCents = refundAgg.cash_payout_cents;
  const pendingElectronicReversalsCents = refundAgg.pending_electronic_reversals_cents;
  const expenseTotalCents = expAgg.total_expenses_cents;
  const creditReceivablesCents = custAgg.total_debt_cents;
  const khataSettlementsCents = khataAgg.total_settlements_cents;

  const netCashFlowCents = cashActuallyReceivedCents - cashRefundPayoutsCents - expenseTotalCents;

  return NextResponse.json({
    ok: true,
    data: {
      period: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      salesSummary: {
        completedCount: salesAgg.completed_count,
        refundedCount: salesAgg.refunded_count,
        subtotalCents,
        subtotalRupees: fromCents(subtotalCents),
        discountCents,
        discountRupees: fromCents(discountCents),
        taxCents,
        taxRupees: fromCents(taxCents),
        grossSalesCents,
        grossSalesRupees: fromCents(grossSalesCents),
        refundedSalesTotalCents: salesAgg.refunded_total_cents,
        refundedSalesTotalRupees: fromCents(salesAgg.refunded_total_cents),
      },
      cashFlow: {
        cashActuallyReceivedCents,
        cashActuallyReceivedRupees: fromCents(cashActuallyReceivedCents),
        breakdown: {
          salesCashCents: salesAgg.sales_cash_tendered_cents,
          creditDownPaymentCents: salesAgg.credit_down_payment_cents,
          khataCashSettlementsCents: khataAgg.cash_settlements_cents,
        },
        cashRefundPayoutsCents,
        cashRefundPayoutsRupees: fromCents(cashRefundPayoutsCents),
        expenseTotalCents,
        expenseTotalRupees: fromCents(expenseTotalCents),
        netCashFlowCents,
        netCashFlowRupees: fromCents(netCashFlowCents),
      },
      creditReceivables: {
        outstandingDebtCents: creditReceivablesCents,
        outstandingDebtRupees: fromCents(creditReceivablesCents),
        periodSettlementsCents: khataSettlementsCents,
        periodSettlementsRupees: fromCents(khataSettlementsCents),
      },
      refundAccounting: {
        totalReversedCents: refundAgg.total_reversed_cents,
        totalReversedRupees: fromCents(refundAgg.total_reversed_cents),
        physicalCashPaidOutCents: cashRefundPayoutsCents,
        physicalCashPaidOutRupees: fromCents(cashRefundPayoutsCents),
        debtReversedCents: refundAgg.debt_reversal_cents,
        debtReversedRupees: fromCents(refundAgg.debt_reversal_cents),
        pendingElectronicReversalsCents,
        pendingElectronicReversalsRupees: fromCents(pendingElectronicReversalsCents),
      },
    },
  });
}
