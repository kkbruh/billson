import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedBill, Provenance, SavedBill, UtilityType } from '../types';
import { FIELDS, evidenceFor, type FieldDef } from '../lib/fields';
import { PdfPage } from './PdfPage';

interface Props {
  bill: SavedBill;
  /** Session-scoped per-field evidence for this bill (empty for older bills). */
  provenance: Provenance[];
  preview: { url: string; type: string } | null;
  onBack: () => void;
  onSave: (bill: ExtractedBill, id: string) => Promise<void>;
  onConfirm: (bill: SavedBill) => void;
  onSendToQueue: (bill: SavedBill) => void;
  onReject: (bill: SavedBill) => void;
  busy: boolean;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/** The service tabs from the design. A bill carries exactly one service, so the
 *  others render disabled — present for orientation, not switchable. */
const UTABS: { type: UtilityType; label: string }[] = [
  { type: 'electricity', label: 'Electricity' },
  { type: 'gas', label: 'Gas' },
  { type: 'water', label: 'Water' },
  { type: 'waste', label: 'Waste' },
];

/** Fields shown in "Mapped Facilio Fields" — the amounts live in Allocation. */
const MAIN_FIELDS = FIELDS.filter((f) => f.key !== 'subtotal' && f.key !== 'tax');

function monthLabel(bill: SavedBill): string {
  const iso = bill.billing_period_start ?? bill.statement_date ?? '';
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function money(n: number | null, currency: string | null): string {
  if (n === null) return '—';
  const s = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : `$${s}`;
}

/** status → the pill in the header. */
function statusTag(status: SavedBill['status']): { label: string; cls: string } {
  if (status === 'confirmed') return { label: 'Parsed & mapped', cls: 'bi-tag--green' };
  if (status === 'flagged') return { label: 'Needs attention', cls: 'bi-tag--amber' };
  return { label: 'Awaiting review', cls: 'bi-tag--blue' };
}

function confidenceTag(c: SavedBill['confidence']): { label: string; cls: string } {
  if (c === 'high') return { label: 'High confidence', cls: 'bi-tag--green' };
  if (c === 'medium') return { label: 'Medium confidence', cls: 'bi-tag--amber' };
  if (c === 'low') return { label: 'Low confidence', cls: 'bi-tag--red' };
  return { label: 'Confidence unknown', cls: 'bi-tag--neutral' };
}

export function ReviewDetail({
  bill,
  provenance,
  preview,
  onBack,
  onSave,
  onConfirm,
  onSendToQueue,
  onReject,
  busy,
}: Props) {
  // ── editable draft (pencil per field, one Save for the batch) ──────────────
  const [draft, setDraft] = useState<ExtractedBill>(() => ({ ...bill }));
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({ ...bill });
    setEditing(new Set());
  }, [bill]);

  const dirty = useMemo(
    () => FIELDS.some((f) => (draft[f.key] ?? null) !== (bill[f.key] ?? null)),
    [draft, bill],
  );

  const toggleEdit = (key: string) =>
    setEditing((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setField = (f: FieldDef, raw: string) => {
    setDraft((d) => {
      if (f.kind === 'number') {
        const n = raw.trim() === '' ? null : Number(raw);
        return { ...d, [f.key]: Number.isFinite(n as number) ? n : null };
      }
      return { ...d, [f.key]: raw.trim() === '' ? null : raw };
    });
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      await onSave(draft, bill.id);
      setEditing(new Set());
    } finally {
      setSaving(false);
    }
  };

  // provenance lookup carries the session evidence onto the working copy
  const withEvidence = useMemo<ExtractedBill>(() => ({ ...draft, provenance }), [draft, provenance]);

  // ── document viewer state ──────────────────────────────────────────────────
  const [zoomIdx, setZoomIdx] = useState(3);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [docText, setDocText] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const scale = ZOOM_STEPS[zoomIdx];

  const type = preview?.type ?? '';
  const isPdf = type.includes('pdf') || /\.pdf$/i.test(bill.file_name ?? '');
  const isImage = type.startsWith('image/');
  const isText = type.startsWith('text/') || /\.txt$/i.test(bill.file_name ?? '');

  useEffect(() => {
    setPage(1);
    setPages(1);
    setZoomIdx(3);
  }, [bill.id]);

  useEffect(() => {
    setDocText(null);
    if (!preview?.url || !isText) return;
    let cancelled = false;
    void fetch(preview.url)
      .then((r) => r.text())
      .then((t) => !cancelled && setDocText(t.slice(0, 40000)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [preview?.url, isText]);

  const goFullscreen = () => {
    const el = docRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const stag = statusTag(bill.status);
  const ctag = confidenceTag(bill.confidence);
  const filledMain = MAIN_FIELDS.filter((f) => valueOf(draft, f) !== null);
  const hasLineItems = draft.line_items.length > 0;

  return (
    <div className="bi-detail">
      {/* breadcrumb / back */}
      <div className="bi-detail__crumb">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Review queue
        </button>
        <span className="bi-muted">
          {bill.vendor_name ?? 'Bill'} · {bill.file_name ?? '—'}
        </span>
      </div>

      <div className="bi-detail__cols">
        {/* ── left: document ──────────────────────────────────────────────── */}
        <section className="bi-doc" ref={docRef}>
          <div className="bi-doc__bar">
            <div className="bi-doc__zoom">
              <button
                type="button"
                className="bi-doc__btn"
                aria-label="Zoom out"
                disabled={zoomIdx === 0}
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              >
                −
              </button>
              <button
                type="button"
                className="bi-doc__btn"
                aria-label="Zoom in"
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              >
                +
              </button>
            </div>
            <div className="bi-doc__pager">
              <button
                type="button"
                className="bi-doc__btn"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span className="bi-doc__pageno">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="bi-doc__btn"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                ›
              </button>
            </div>
            <button
              type="button"
              className="bi-doc__btn"
              aria-label="Fullscreen"
              onClick={goFullscreen}
            >
              ⛶
            </button>
          </div>

          <div className="bi-doc__body">
            {!preview?.url ? (
              <div className="bi-doc__empty">
                No inline preview for this document. The extracted values are on the right.
              </div>
            ) : docText !== null ? (
              <pre className="bi-doc__text" style={{ zoom: scale }}>
                {docText}
              </pre>
            ) : isPdf ? (
              <PdfPage url={preview.url} scale={scale} page={page} onPageCount={setPages} />
            ) : isImage ? (
              <img className="bi-doc__img" src={preview.url} alt={bill.file_name ?? 'Document'} />
            ) : (
              <div className="bi-doc__empty">This file type can’t be previewed inline.</div>
            )}
          </div>
        </section>

        {/* ── right: parsed + mapped ──────────────────────────────────────── */}
        <div className="bi-side">
          {/* header card */}
          <div className="bi-side__head">
            <div className="bi-side__headtop">
              <div>
                <div className="bi-side__title">
                  {bill.vendor_name ?? 'Unknown vendor'} · Acct #{bill.account_number ?? '—'} ·{' '}
                  {monthLabel(bill)}
                </div>
                <div className="bi-side__sub">
                  Invoice {bill.invoice_number ?? '—'} · {bill.file_name ?? 'source document'}
                </div>
              </div>
              <span className={`bi-tag ${stag.cls}`}>{stag.label}</span>
            </div>
            <div className="bi-side__route">
              <span className="bi-side__gear" aria-hidden="true">
                ⚙
              </span>
              Read by the AI extractor
              <span className={`bi-tag ${ctag.cls}`}>{ctag.label}</span>
            </div>
          </div>

          {/* service tabs */}
          <div className="bi-utabs" role="tablist" aria-label="Service">
            {UTABS.map((t) => {
              const active = bill.utility_type === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={!active}
                  className={`bi-utab${active ? ' bi-utab--active' : ''}`}
                >
                  {t.label}
                </button>
              );
            })}
            {bill.utility_type && !UTABS.some((t) => t.type === bill.utility_type) && (
              <button type="button" className="bi-utab bi-utab--active" aria-selected>
                {bill.utility_type}
              </button>
            )}
          </div>

          {/* mapped fields */}
          <div className="bi-fields">
            <div className="bi-fields__head">
              <span className="bi-fields__title">Mapped Facilio Fields</span>
              {dirty && (
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => void saveEdits()}
                >
                  {saving && <span className="btn__spinner" aria-hidden="true" />}
                  Save changes
                </button>
              )}
            </div>

            {filledMain.length === 0 ? (
              <div className="bi-empty">No fields were extracted for this bill.</div>
            ) : (
              filledMain.map((f) => {
                const isEditing = editing.has(String(f.key));
                const ev = evidenceFor(withEvidence, String(f.key));
                return (
                  <div className={`bi-field${ev ? '' : ''}`} key={String(f.key)}>
                    <div className="bi-field__main">
                      <span className="bi-field__label">{f.label}</span>
                      {isEditing ? (
                        <input
                          className="input bi-field__input"
                          type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                          value={inputValue(draft, f)}
                          autoFocus
                          onChange={(e) => setField(f, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') toggleEdit(String(f.key));
                          }}
                          onBlur={() => toggleEdit(String(f.key))}
                        />
                      ) : (
                        <span className="bi-field__value bi-mono">{displayField(draft, f)}</span>
                      )}
                    </div>
                    <div className="bi-field__side">
                      {ev ? (
                        <span className="bi-tag bi-tag--green" title={`Read from: “${ev}”`}>
                          Evidence
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="bi-field__edit"
                        aria-label={`Edit ${f.label}`}
                        title={`Edit ${f.label}`}
                        onClick={() => toggleEdit(String(f.key))}
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {/* shared charges allocation */}
            <div className="bi-fields__subhead">Shared Charges Allocation</div>
            <div className="bi-alloc">
              {draft.subtotal !== null && (
                <div className="bi-alloc__row">
                  <span>Subtotal</span>
                  <span className="bi-mono">{money(draft.subtotal, draft.currency)}</span>
                </div>
              )}
              {draft.tax !== null && (
                <div className="bi-alloc__row">
                  <span>Tax (100% allocation)</span>
                  <span className="bi-mono">{money(draft.tax, draft.currency)}</span>
                </div>
              )}
              {hasLineItems &&
                draft.line_items.map((li, i) => (
                  <div className="bi-alloc__row" key={i}>
                    <span>{li.description || `Line ${i + 1}`}</span>
                    <span className="bi-mono">{money(li.amount, draft.currency)}</span>
                  </div>
                ))}
              <div className="bi-alloc__row bi-alloc__row--total">
                <span>Total amount</span>
                <span className="bi-mono">{money(draft.total_amount, draft.currency)}</span>
              </div>
            </div>
          </div>

          {/* action bar */}
          <div className="bi-detail__actions">
            <button
              type="button"
              className="btn btn--accent"
              disabled={busy}
              onClick={() => onConfirm({ ...bill, ...draft })}
            >
              Confirm &amp; write to Facilio
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onSendToQueue({ ...bill, ...draft })}
            >
              Send to Review Queue
            </button>
            <span className="app__spacer" />
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              disabled={busy}
              onClick={() => onReject(bill)}
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── value helpers (draft is ExtractedBill; keys are typed) ────────────────────

function valueOf(bill: ExtractedBill, f: FieldDef): unknown {
  const v = bill[f.key];
  return v === undefined || v === '' ? null : v;
}

function inputValue(bill: ExtractedBill, f: FieldDef): string {
  const v = bill[f.key];
  if (v === null || v === undefined) return '';
  return String(v);
}

function displayField(bill: ExtractedBill, f: FieldDef): string {
  const v = bill[f.key];
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}
