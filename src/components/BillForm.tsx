import type { ExtractedBill, LineItem, UtilityType } from '../types';
import { UTILITY_TYPES } from '../types';

interface Props {
  bill: ExtractedBill;
  onChange: (bill: ExtractedBill) => void;
  disabled?: boolean;
}

type TextKey =
  | 'vendor_name'
  | 'account_number'
  | 'invoice_number'
  | 'service_address'
  | 'meter_number'
  | 'consumption_unit'
  | 'currency';

type DateKey =
  | 'billing_period_start'
  | 'billing_period_end'
  | 'statement_date'
  | 'due_date';

type NumKey =
  | 'previous_read'
  | 'current_read'
  | 'consumption'
  | 'subtotal'
  | 'tax'
  | 'total_amount';

const TEXT_FIELDS: { key: TextKey; label: string; placeholder?: string }[] = [
  { key: 'vendor_name', label: 'Vendor', placeholder: 'e.g. Acme Power Co' },
  { key: 'account_number', label: 'Account number' },
  { key: 'invoice_number', label: 'Invoice number' },
  { key: 'meter_number', label: 'Meter number' },
  { key: 'consumption_unit', label: 'Consumption unit', placeholder: 'kWh, m³, kL' },
  { key: 'currency', label: 'Currency', placeholder: 'USD' },
];

const DATE_FIELDS: { key: DateKey; label: string }[] = [
  { key: 'billing_period_start', label: 'Period start' },
  { key: 'billing_period_end', label: 'Period end' },
  { key: 'statement_date', label: 'Statement date' },
  { key: 'due_date', label: 'Due date' },
];

const READ_FIELDS: { key: NumKey; label: string }[] = [
  { key: 'previous_read', label: 'Previous read' },
  { key: 'current_read', label: 'Current read' },
  { key: 'consumption', label: 'Consumption' },
];

const MONEY_FIELDS: { key: NumKey; label: string }[] = [
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'tax', label: 'Tax' },
  { key: 'total_amount', label: 'Total amount' },
];

function numToInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

function inputToNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function BillForm({ bill, onChange, disabled }: Props) {
  const set = <K extends keyof ExtractedBill>(key: K, value: ExtractedBill[K]) =>
    onChange({ ...bill, [key]: value });

  const setLineItem = (index: number, patch: Partial<LineItem>) => {
    const items = bill.line_items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    onChange({ ...bill, line_items: items });
  };

  const addLineItem = () =>
    onChange({
      ...bill,
      line_items: [
        ...bill.line_items,
        { description: '', quantity: null, unit_price: null, amount: null },
      ],
    });

  const removeLineItem = (index: number) =>
    onChange({
      ...bill,
      line_items: bill.line_items.filter((_, i) => i !== index),
    });

  const lineItemsTotal = bill.line_items.reduce(
    (sum, item) => sum + (item.amount ?? 0),
    0,
  );
  const total = bill.total_amount;
  // Only worth flagging when there are itemised lines to compare against.
  const mismatch =
    bill.line_items.length > 0 &&
    total !== null &&
    Math.abs(lineItemsTotal - total) > 0.02;

  return (
    <div>
      <div className="fds-section-head">
        <span className="fds-section-head__label">Bill details</span>
        <span className="fds-section-head__rule" />
      </div>

      <div className="form-grid">
        {TEXT_FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field__label">{f.label}</span>
            <input
              className="input"
              type="text"
              value={bill[f.key] ?? ''}
              placeholder={f.placeholder}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value.trim() === '' ? null : e.target.value)}
            />
          </label>
        ))}

        <label className="field">
          <span className="field__label">Type</span>
          <select
            className="input"
            value={bill.utility_type ?? ''}
            disabled={disabled}
            onChange={(e) =>
              set(
                'utility_type',
                e.target.value === '' ? null : (e.target.value as UtilityType),
              )
            }
          >
            <option value="">—</option>
            {UTILITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="field__label">Service address</span>
          <input
            className="input"
            type="text"
            value={bill.service_address ?? ''}
            disabled={disabled}
            onChange={(e) =>
              set('service_address', e.target.value.trim() === '' ? null : e.target.value)
            }
          />
        </label>
      </div>

      <div className="divider" />

      <div className="fds-section-head">
        <span className="fds-section-head__label">Dates</span>
        <span className="fds-section-head__rule" />
      </div>

      <div className="form-grid">
        {DATE_FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field__label">{f.label}</span>
            <input
              className="input"
              type="date"
              value={bill[f.key] ?? ''}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value === '' ? null : e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="divider" />

      <div className="fds-section-head">
        <span className="fds-section-head__label">Meter &amp; consumption</span>
        <span className="fds-section-head__rule" />
      </div>

      <div className="form-grid">
        {READ_FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field__label">{f.label}</span>
            <input
              className="input mono"
              type="text"
              inputMode="decimal"
              value={numToInput(bill[f.key])}
              disabled={disabled}
              onChange={(e) => set(f.key, inputToNum(e.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="divider" />

      <div className="fds-section-head">
        <span className="fds-section-head__label">Amounts</span>
        <span className="fds-section-head__rule" />
      </div>

      <div className="form-grid">
        {MONEY_FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field__label">{f.label}</span>
            <input
              className="input mono"
              type="text"
              inputMode="decimal"
              value={numToInput(bill[f.key])}
              disabled={disabled}
              onChange={(e) => set(f.key, inputToNum(e.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="divider" />

      <div className="fds-section-head">
        <span className="fds-section-head__label">
          Line items {bill.line_items.length > 0 ? `(${bill.line_items.length})` : ''}
        </span>
        <span className="fds-section-head__rule" />
      </div>

      {bill.line_items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No itemised charges. Add one if the bill breaks the total down.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="fds-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Amount</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.line_items.map((item, i) => (
                <tr key={i}>
                  <td style={{ minWidth: 220, whiteSpace: 'normal' }}>
                    <input
                      className="input"
                      type="text"
                      value={item.description ?? ''}
                      disabled={disabled}
                      onChange={(e) => setLineItem(i, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      type="text"
                      inputMode="decimal"
                      style={{ width: 90 }}
                      value={numToInput(item.quantity)}
                      disabled={disabled}
                      onChange={(e) =>
                        setLineItem(i, { quantity: inputToNum(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      type="text"
                      inputMode="decimal"
                      style={{ width: 110 }}
                      value={numToInput(item.unit_price)}
                      disabled={disabled}
                      onChange={(e) =>
                        setLineItem(i, { unit_price: inputToNum(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      type="text"
                      inputMode="decimal"
                      style={{ width: 110 }}
                      value={numToInput(item.amount)}
                      disabled={disabled}
                      onChange={(e) =>
                        setLineItem(i, { amount: inputToNum(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--danger btn--icon"
                      disabled={disabled}
                      onClick={() => removeLineItem(i)}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ marginTop: 'var(--spacing-containerXxLarge)' }}>
        <button type="button" className="btn" disabled={disabled} onClick={addLineItem}>
          + Add line item
        </button>
        {bill.line_items.length > 0 && (
          <span className="muted mono">
            Lines sum to {lineItemsTotal.toFixed(2)}
          </span>
        )}
      </div>

      {mismatch && (
        <div className="notice notice--warning" style={{ marginTop: 'var(--spacing-sectionXSmall)' }}>
          <span>
            The line items add up to {lineItemsTotal.toFixed(2)} but the total says{' '}
            {total?.toFixed(2)}. Worth checking before you save — some bills legitimately
            differ because of rounding or credits.
          </span>
        </div>
      )}

      <div className="divider" />

      <label className="field">
        <span className="field__label">Reviewer notes</span>
        <textarea
          className="input"
          rows={3}
          value={bill.notes ?? ''}
          placeholder="Anything worth flagging about this bill"
          disabled={disabled}
          onChange={(e) => set('notes', e.target.value.trim() === '' ? null : e.target.value)}
        />
      </label>
    </div>
  );
}
