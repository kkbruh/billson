import type { ExtractedBill } from '../types';

/**
 * The Facilio fields a bill maps onto, in the order the mapping walkthrough
 * reveals them. Grouping matches the right-hand panel of the 3-column layout.
 */
export interface FieldDef {
  key: keyof ExtractedBill;
  label: string;
  group: string;
  kind: 'text' | 'date' | 'number';
}

export const FIELDS: FieldDef[] = [
  { key: 'vendor_name', label: 'Vendor / provider', group: 'Identity', kind: 'text' },
  { key: 'account_number', label: 'Account number', group: 'Identity', kind: 'text' },
  { key: 'invoice_number', label: 'Invoice number', group: 'Identity', kind: 'text' },
  { key: 'service_address', label: 'Service address', group: 'Identity', kind: 'text' },
  { key: 'utility_type', label: 'Service', group: 'Identity', kind: 'text' },

  { key: 'billing_period_start', label: 'Period start', group: 'Period', kind: 'date' },
  { key: 'billing_period_end', label: 'Period end', group: 'Period', kind: 'date' },
  { key: 'statement_date', label: 'Statement date', group: 'Period', kind: 'date' },
  { key: 'due_date', label: 'Due date', group: 'Period', kind: 'date' },

  { key: 'meter_number', label: 'Meter number', group: 'Meter & consumption', kind: 'text' },
  { key: 'previous_read', label: 'Previous read', group: 'Meter & consumption', kind: 'number' },
  { key: 'current_read', label: 'Current read', group: 'Meter & consumption', kind: 'number' },
  { key: 'consumption', label: 'Consumption', group: 'Meter & consumption', kind: 'number' },
  { key: 'consumption_unit', label: 'Unit', group: 'Meter & consumption', kind: 'text' },

  { key: 'subtotal', label: 'Subtotal', group: 'Amounts', kind: 'number' },
  { key: 'tax', label: 'Tax', group: 'Amounts', kind: 'number' },
  { key: 'total_amount', label: 'Total amount', group: 'Amounts', kind: 'number' },
  { key: 'currency', label: 'Currency', group: 'Amounts', kind: 'text' },
];

export const FIELD_GROUPS = ['Identity', 'Period', 'Meter & consumption', 'Amounts'];

export function fieldLabel(key: string): string {
  return FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Format a value for display in the field panel. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(value);
}

/** Does this bill actually carry a value for the field? */
export function hasValue(bill: ExtractedBill, key: keyof ExtractedBill): boolean {
  const v = bill[key];
  return v !== null && v !== undefined && v !== '';
}

/**
 * The fields that were actually filled, in schema order — this is the sequence
 * the mapping walkthrough steps through.
 */
export function mappedFields(bill: ExtractedBill): FieldDef[] {
  return FIELDS.filter((f) => hasValue(bill, f.key));
}

/** Evidence for one field, if the extractor supplied any. */
export function evidenceFor(bill: ExtractedBill, key: string): string | null {
  const hit = bill.provenance.find((p) => p.field === key);
  return hit ? hit.source_text : null;
}
