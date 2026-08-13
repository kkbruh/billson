import type { ExtractedBill } from '../types';

/**
 * Independent, deterministic sanity checks on an extracted bill — used to gate
 * auto-validation so we don't trust the model's own confidence alone. A bill
 * that fails any check is routed to Review even if the extractor said "high".
 */
export interface BillCheck {
  ok: boolean;
  reason: string | null;
}

/** Absolute tolerance for money reconciliation: the larger of 1% or 1 unit. */
function moneyTolerance(total: number): number {
  return Math.max(Math.abs(total) * 0.01, 1);
}

export function validateBill(bill: ExtractedBill): BillCheck {
  const fail = (reason: string): BillCheck => ({ ok: false, reason });

  // Required identity/amount — a bill with no total or vendor isn't postable.
  if (bill.total_amount === null) return fail('No total amount was read — confirm the invoice total.');
  if (!bill.vendor_name) return fail('No vendor/provider was read — confirm who issued the bill.');

  // At least one anchoring date, or downstream posting has nothing to file under.
  if (!bill.statement_date && !bill.billing_period_end && !bill.due_date) {
    return fail('No statement, period or due date was read — confirm the billing dates.');
  }

  // Amounts must reconcile when the parts are present: subtotal + tax ≈ total.
  if (bill.subtotal !== null && bill.tax !== null) {
    const diff = Math.abs(bill.subtotal + bill.tax - bill.total_amount);
    if (diff > moneyTolerance(bill.total_amount)) {
      return fail('Amounts don’t reconcile — subtotal + tax ≠ total.');
    }
  }

  // Line items, when priced, should sum to the total within tolerance.
  const lineSum = bill.line_items.reduce((s, li) => s + (li.amount ?? 0), 0);
  const anyPriced = bill.line_items.some((li) => li.amount !== null);
  if (anyPriced && Math.abs(lineSum - bill.total_amount) > moneyTolerance(bill.total_amount)) {
    return fail('Line items don’t add up to the total — check the charges.');
  }

  // Meter reads, when both present, must move forward.
  if (bill.previous_read !== null && bill.current_read !== null && bill.current_read < bill.previous_read) {
    return fail('Current meter read is lower than the previous read — verify the readings.');
  }

  return { ok: true, reason: null };
}
