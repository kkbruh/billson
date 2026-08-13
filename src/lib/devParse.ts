import type { ExtractedBill, Provenance, SavedBill } from '../types';

/**
 * Local-dev stand-in for the extraction pipeline.
 *
 * `vibe.uploadFile` / `executeAgent` / `executeFunction` are all authenticated by a
 * same-origin Facilio cookie, so none of them work from `localhost`. Without this,
 * every bill fails instantly in dev and the parsing states can never be seen.
 *
 * The values below are the real figures from the bundled Burnsville invoices, so
 * the UI shows believable data. This module is only ever reached under
 * `import.meta.env.DEV` and is dropped from a production build.
 */

interface Fixture {
  match: RegExp;
  bill: Partial<ExtractedBill>;
}

const BASE: Omit<ExtractedBill, 'provenance'> = {
  vendor_name: 'NRG Reliability Solutions LLC',
  account_number: '9000803354',
  invoice_number: '3354-2508',
  service_address: "Byerly's Burnsville, 401 County Road 42, Burnsville, MN 55337",
  utility_type: 'electricity',
  billing_period_start: '2025-07-01',
  billing_period_end: '2025-08-01',
  statement_date: '2025-08-07',
  due_date: '2025-08-31',
  meter_number: '61831',
  previous_read: null,
  current_read: null,
  consumption: 169344,
  consumption_unit: 'kWh',
  currency: 'USD',
  subtotal: 16335.22,
  tax: 1135.29,
  total_amount: 17650.51,
  line_items: [
    { description: 'Fixed Monthly Service Charge', quantity: null, unit_price: null, amount: 54 },
    { description: 'DEA Interim rate charge', quantity: null, unit_price: null, amount: 1158.4 },
    { description: 'Energy Tier #1', quantity: 67334, unit_price: 0.078, amount: 5252.05 },
    { description: 'Energy Tier #2', quantity: 67334, unit_price: 0.068, amount: 4578.71 },
    { description: 'Energy Tier #3', quantity: 34676, unit_price: 0.058, amount: 2011.21 },
    { description: 'Demand', quantity: 336.67, unit_price: 5.25, amount: 1767.52 },
  ],
  confidence: 'high',
  notes: null,
};

const PROVENANCE: Provenance[] = [
  { field: 'vendor_name', source_text: 'NRG Reliability Solutions LLC', page: 1 },
  { field: 'account_number', source_text: 'Account Number: 9000803354', page: 1 },
  { field: 'invoice_number', source_text: 'Invoice Number 3354-2508', page: 1 },
  { field: 'total_amount', source_text: 'Invoice Total: $ 17,650.51', page: 1 },
  { field: 'subtotal', source_text: 'Subtotal $ 16,335.22', page: 1 },
  { field: 'due_date', source_text: 'Payment Due Date: 08/31/25', page: 1 },
  { field: 'statement_date', source_text: 'Billing Date: 08/07/25', page: 1 },
  { field: 'consumption', source_text: 'Resource & Tax Adjustment 169,344 kWh @', page: 1 },
  { field: 'service_address', source_text: "Service Address: Byerly's Burnsville", page: 1 },
];

/** Per-month figures, plus deliberately varied outcomes so every state is reachable. */
const FIXTURES: Fixture[] = [
  {
    match: /jun/i,
    bill: {
      invoice_number: '3354-2506',
      billing_period_start: '2025-05-01',
      billing_period_end: '2025-06-01',
      statement_date: '2025-06-07',
      due_date: '2025-07-01',
      total_amount: 15261.23,
      subtotal: 14120.4,
      tax: 1140.83,
    },
  },
  {
    match: /jul/i,
    bill: {
      invoice_number: '3354-2507',
      billing_period_start: '2025-06-01',
      billing_period_end: '2025-07-01',
      statement_date: '2025-07-07',
      due_date: '2025-08-01',
      total_amount: 16402.88,
      subtotal: 15180.6,
      tax: 1222.28,
      // low confidence so the "needs attention" state is visible in dev
      confidence: 'low',
      notes: 'Meter reads were faint on this scan — confirm the consumption figure.',
    },
  },
  { match: /aug/i, bill: {} },
  {
    match: /sep/i,
    bill: {
      invoice_number: '3354-2509',
      billing_period_start: '2025-08-01',
      billing_period_end: '2025-09-01',
      statement_date: '2025-09-07',
      due_date: '2025-10-01',
      total_amount: 18044.17,
      subtotal: 16702.9,
      tax: 1341.27,
    },
  },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;

export interface DevParseResult {
  bill: ExtractedBill;
  fileId: number;
  fileName: string;
}

/**
 * Simulate one extraction. Takes a couple of seconds on purpose, so the parsing
 * animation and the queue's in-progress state are actually observable.
 */
export async function devParseBillFile(file: File): Promise<DevParseResult> {
  counter += 1;
  await wait(1800 + (counter % 3) * 700);

  // Every fourth bill fails, so the failed state and its Retry button are reachable.
  if (counter % 4 === 0) {
    throw new Error('Simulated extraction failure (dev only). Press Retry.');
  }

  const fixture = FIXTURES.find((f) => f.match.test(file.name));
  const bill: ExtractedBill = {
    ...BASE,
    ...fixture?.bill,
    provenance: PROVENANCE,
  };

  return { bill, fileId: 9000 + counter, fileName: file.name };
}

/** Pretend the register accepted the row, so the UI can continue in dev. */
export async function devSaveBill(bill: Partial<SavedBill>): Promise<SavedBill> {
  await wait(120);
  const now = new Date().toISOString();
  return {
    ...(bill as SavedBill),
    id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    created_at: now,
    updated_at: now,
  };
}
