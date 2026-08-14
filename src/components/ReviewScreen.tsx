import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedBill, Provenance, SavedBill } from '../types';
import { loadStoredPreview } from '../lib/api';
import { ReviewDetail } from './ReviewDetail';
import samplePdf from '../assets/samples/burnsville-july.pdf?url';

interface Props {
  bills: SavedBill[];
  /** Session-scoped evidence keyed by bill id; empty for bills from earlier runs. */
  provenanceById: Record<string, Provenance[]>;
  loading: boolean;
  search: string;
  onSearch: (term: string) => void;
  onSave: (bill: ExtractedBill, id: string) => Promise<void>;
  onConfirm: (bill: SavedBill) => void;
  onSendToQueue: (bill: SavedBill) => void;
  onReject: (bill: SavedBill) => void;
  onExport: () => void;
  onRefresh: () => void;
  busyId: string | null;
}

function money(n: number | null, currency: string | null): string {
  if (n === null) return '—';
  const s = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : `$${s}`;
}

function statusTag(status: SavedBill['status']): { label: string; cls: string } {
  if (status === 'confirmed') return { label: 'Parsed & mapped', cls: 'bi-tag--green' };
  if (status === 'flagged') return { label: 'Needs attention', cls: 'bi-tag--amber' };
  return { label: 'Awaiting review', cls: 'bi-tag--blue' };
}

function confTag(c: SavedBill['confidence']): { label: string; cls: string } {
  if (c === 'high') return { label: 'High', cls: 'bi-tag--green' };
  if (c === 'medium') return { label: 'Medium', cls: 'bi-tag--amber' };
  if (c === 'low') return { label: 'Low', cls: 'bi-tag--red' };
  return { label: '—', cls: 'bi-tag--neutral' };
}

export function ReviewScreen({
  bills,
  provenanceById,
  loading,
  search,
  onSearch,
  onSave,
  onConfirm,
  onSendToQueue,
  onReject,
  onExport,
  onRefresh,
  busyId,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  // The opened bill must still exist after a refresh; otherwise fall back to list.
  useEffect(() => {
    if (openId && !bills.some((b) => b.id === openId)) setOpenId(null);
  }, [bills, openId]);

  const selected = useMemo(
    () => bills.find((b) => b.id === openId) ?? null,
    [bills, openId],
  );

  // ── source document, fetched only for the opened bill ──────────────────────
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const revoke = () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
        previewRef.current = null;
      }
    };
    revoke();
    setPreview(null);

    // Local dev can't download from the app file store; show a bundled sample so
    // the doc pane is explorable. Dead code in production.
    if (import.meta.env.DEV) {
      if (selected) setPreview({ url: samplePdf, type: 'application/pdf' });
      return;
    }

    const fileId = selected?.file_id ? Number(selected.file_id) : NaN;
    if (!Number.isFinite(fileId)) return;

    void loadStoredPreview(fileId).then((p) => {
      if (cancelled) {
        if (p) URL.revokeObjectURL(p.url);
        return;
      }
      if (p) {
        previewRef.current = p.url;
        setPreview(p);
      }
    });
    return () => {
      cancelled = true;
      revoke();
    };
  }, [selected?.file_id]);

  // ── detail view ────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <ReviewDetail
        bill={selected}
        provenance={provenanceById[selected.id] ?? selected.provenance ?? []}
        preview={preview}
        onBack={() => setOpenId(null)}
        onSave={onSave}
        onConfirm={(b) => {
          onConfirm(b);
          setOpenId(null);
        }}
        onSendToQueue={(b) => {
          onSendToQueue(b);
          setOpenId(null);
        }}
        onReject={(b) => {
          onReject(b);
          setOpenId(null);
        }}
        busy={busyId === selected.id}
      />
    );
  }

  // ── queue list ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="bi-toolbar">
        <div className="bi-search" style={{ maxWidth: 320 }}>
          <span
            className="bi-search__icon"
            style={{
              maskImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'2\'><circle cx=\'11\' cy=\'11\' r=\'7\'/><path d=\'M21 21l-4-4\'/></svg>")',
              WebkitMaskImage:
                'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'2\'><circle cx=\'11\' cy=\'11\' r=\'7\'/><path d=\'M21 21l-4-4\'/></svg>")',
            }}
          />
          <input
            className="input"
            type="search"
            placeholder="Search vendor, account, invoice, meter…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search bills"
          />
        </div>
        <div className="bi-toolbar__end">
          <button type="button" className="btn" disabled={bills.length === 0} onClick={onExport}>
            Export CSV
          </button>
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      <div className="bi-tablecard">
        <div className="bi-tablescroll">
          <table className="bi-table">
            <thead>
              <tr>
                <th>Vendor / file</th>
                <th>Service</th>
                <th>Account</th>
                <th>Period</th>
                <th className="bi-num">Amount</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="bi-empty">
                      {loading
                        ? 'Loading…'
                        : search
                          ? `Nothing matches “${search}”.`
                          : 'Nothing to review yet. Parse a bill from the Inbox.'}
                    </div>
                  </td>
                </tr>
              ) : (
                bills.map((b) => {
                  const st = statusTag(b.status);
                  const ct = confTag(b.confidence);
                  return (
                    <tr
                      key={b.id}
                      className="bi-cmms-row"
                      onClick={() => setOpenId(b.id)}
                    >
                      <td>
                        <div className="bi-cell-2">
                          <span className="bi-file__name">{b.vendor_name ?? 'Unknown vendor'}</span>
                          <span className="bi-cell-2__sub">{b.file_name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="bi-muted">{b.utility_type ?? '—'}</td>
                      <td className="bi-muted">{b.account_number ?? '—'}</td>
                      <td className="bi-muted">
                        {b.billing_period_start
                          ? `${b.billing_period_start}${b.billing_period_end ? ` → ${b.billing_period_end}` : ''}`
                          : '—'}
                      </td>
                      <td className="bi-num bi-mono">{money(b.total_amount, b.currency)}</td>
                      <td>
                        <span className={`bi-tag ${ct.cls}`}>{ct.label}</span>
                      </td>
                      <td>
                        <span className={`bi-tag ${st.cls}`}>{st.label}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(b.id);
                          }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {bills.length > 0 && (
          <div className="bi-tablefoot">
            <span className="bi-tablefoot__count">
              {bills.length} bill{bills.length === 1 ? '' : 's'} in the register
            </span>
          </div>
        )}
      </div>
    </>
  );
}
