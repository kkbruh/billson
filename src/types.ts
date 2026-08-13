/** One charge line off the bill. */
export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

/** Evidence for one extracted field: the verbatim text it was read from. */
export interface Provenance {
  field: string;
  source_text: string;
  page: number | null;
}

/** What the extraction agent returns for a single bill document. */
export interface ExtractedBill {
  vendor_name: string | null;
  account_number: string | null;
  invoice_number: string | null;
  service_address: string | null;
  utility_type: UtilityType | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  statement_date: string | null;
  due_date: string | null;
  meter_number: string | null;
  previous_read: number | null;
  current_read: number | null;
  consumption: number | null;
  consumption_unit: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total_amount: number | null;
  line_items: LineItem[];
  /** The agent's own confidence that it read the document correctly. */
  confidence: Confidence | null;
  /** Anything the agent couldn't read or wants to flag for the reviewer. */
  notes: string | null;
  /** Per-field evidence, used to show the reviewer where each value came from. */
  provenance: Provenance[];
}

export type UtilityType =
  | 'electricity'
  | 'water'
  | 'gas'
  | 'waste'
  | 'telecom'
  | 'other';

export type Confidence = 'high' | 'medium' | 'low';

export const UTILITY_TYPES: UtilityType[] = [
  'electricity',
  'water',
  'gas',
  'waste',
  'telecom',
  'other',
];

/** A bill as stored in the app database. */
export interface SavedBill extends ExtractedBill {
  /** Text id generated server-side — the table has no sequence. */
  id: string;
  /** fileId from vibe.uploadFile, stored as text — the source document. */
  file_id: string | null;
  file_name: string | null;
  status: BillStatus;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BillStatus = 'parsed' | 'confirmed' | 'flagged';

/** An empty bill — the starting point for a manual entry or a failed parse. */
export function emptyBill(): ExtractedBill {
  return {
    vendor_name: null,
    account_number: null,
    invoice_number: null,
    service_address: null,
    utility_type: null,
    billing_period_start: null,
    billing_period_end: null,
    statement_date: null,
    due_date: null,
    meter_number: null,
    previous_read: null,
    current_read: null,
    consumption: null,
    consumption_unit: null,
    currency: null,
    subtotal: null,
    tax: null,
    total_amount: null,
    line_items: [],
    confidence: null,
    notes: null,
    provenance: [],
  };
}
