import type { SavedBill } from '../types';

const COLUMNS: { key: keyof SavedBill; label: string }[] = [
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'account_number', label: 'Account number' },
  { key: 'invoice_number', label: 'Invoice number' },
  { key: 'service_address', label: 'Service address' },
  { key: 'utility_type', label: 'Type' },
  { key: 'billing_period_start', label: 'Period start' },
  { key: 'billing_period_end', label: 'Period end' },
  { key: 'statement_date', label: 'Statement date' },
  { key: 'due_date', label: 'Due date' },
  { key: 'meter_number', label: 'Meter' },
  { key: 'previous_read', label: 'Previous read' },
  { key: 'current_read', label: 'Current read' },
  { key: 'consumption', label: 'Consumption' },
  { key: 'consumption_unit', label: 'Unit' },
  { key: 'currency', label: 'Currency' },
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'tax', label: 'Tax' },
  { key: 'total_amount', label: 'Total' },
  { key: 'status', label: 'Status' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'notes', label: 'Notes' },
  { key: 'file_name', label: 'Source file' },
  { key: 'created_at', label: 'Saved at' },
];

/**
 * Quote a CSV cell. A leading =, +, - or @ is prefixed with a single quote so a
 * spreadsheet treats a value like "-CMD()" as text rather than a formula.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function billsToCsv(bills: SavedBill[]): string {
  const header = COLUMNS.map((c) => cell(c.label)).join(',');
  const rows = bills.map((bill) =>
    COLUMNS.map((c) => cell(bill[c.key])).join(','),
  );
  // CRLF + BOM so Excel opens it cleanly with UTF-8 intact.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

export function downloadCsv(bills: SavedBill[], filename: string): void {
  const blob = new Blob([billsToCsv(bills)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
