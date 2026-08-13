import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedBill, Provenance, SavedBill } from '../types';
import { LIFECYCLE, type LifecycleState, type QueueState } from '../lib/lifecycle';
import { loadStoredPreview } from '../lib/api';
import { ParseWorkspace, type WorkItem } from './ParseWorkspace';
import { BillForm } from './BillForm';

interface Props {
  bills: SavedBill[];
  /** Session-scoped evidence keyed by bill id; empty for bills from earlier runs. */
  provenanceById: Record<string, Provenance[]>;
  loading: boolean;
  search: string;
  onSearch: (term: string) => void;
  onSave: (bill: ExtractedBill, id: string) => Promise<void>;
  onDelete: (bill: SavedBill) => void;
  onExport: () => void;
  onRefresh: () => void;
  busyId: string | null;
}

/** Register status → the spec's lifecycle vocabulary. */
function lifecycleOf(bill: SavedBill): LifecycleState {
  if (bill.status === 'flagged') return 'needs_attention';
  if (bill.status === 'confirmed') return 'parsed_mapped';
  return 'awaiting_review';
}

/** Queue glyph for the left column: a flagged bill still wants a human. */
function queueStateOf(bill: SavedBill): QueueState {
  return bill.status === 'flagged' ? 'failed' : 'done';
}

export function ReviewScreen({
  bills,
  provenanceById,
  loading,
  search,
  onSearch,
  onSave,
  onDelete,
  onExport,
  onRefresh,
  busyId,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ExtractedBill | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bills.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !bills.some((b) => b.id === selectedId)) {
      setSelectedId(bills[0].id);
      setEditing(false);
    }
  }, [bills, selectedId]);

  const selected = useMemo(
    () => bills.find((b) => b.id === selectedId) ?? null,
    [bills, selectedId],
  );

  /**
   * The source document lives in the app's file store, so it's fetched on demand
   * for whichever bill is selected — only one at a time, and revoked when it
   * changes so blobs don't accumulate.
   */
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

  const workItems: WorkItem[] = useMemo(
    () =>
      bills.map((b) => ({
        key: b.id,
        name: b.file_name ?? b.vendor_name ?? 'Bill',
        queueState: queueStateOf(b),
        bill: { ...b, provenance: provenanceById[b.id] ?? [] },
        // Only the selected bill's document is fetched, so only it can preview.
        previewUrl: b.id === selectedId ? (preview?.url ?? null) : null,
        previewType: b.id === selectedId ? (preview?.type ?? null) : null,
        error: b.status === 'flagged' ? (b.notes ?? 'Needs attention') : null,
      })),
    [bills, selectedId, preview, provenanceById],
  );

  const commit = async () => {
    if (!draft || !selected) return;
    setSaving(true);
    try {
      await onSave(draft, selected.id);
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fds-widget">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Review</span>
          <span className="fds-widget__range">
            {loading
              ? 'Loading…'
              : `${bills.length} parsed bill${bills.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="fds-widget__body">
          <div className="row">
            <input
              className="input input--search"
              type="search"
              placeholder="Search vendor, account, invoice, meter…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="Search bills"
            />
            <span className="app__spacer" />
            <button type="button" className="btn" disabled={bills.length === 0} onClick={onExport}>
              Export CSV
            </button>
            <button type="button" className="btn" onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="fds-widget">
          <div className="fds-widget__body">
            <div className="empty">
              <div className="empty__text">
                {search
                  ? `Nothing matches “${search}”.`
                  : 'Nothing to review yet. Parse a bill from the Inbox.'}
              </div>
            </div>
          </div>
        </div>
      ) : editing && draft && selected ? (
        <div className="fds-widget">
          <div className="fds-widget__header">
            <span className="fds-widget__title">
              Editing {selected.vendor_name ?? 'bill'}
            </span>
            <span className="fds-widget__range">{selected.file_name ?? '—'}</span>
          </div>
          <div className="fds-widget__body">
            <BillForm bill={draft} onChange={setDraft} disabled={saving} />
            <div className="band">
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving}
                onClick={() => void commit()}
              >
                {saving && <span className="btn__spinner" aria-hidden="true" />}
                Save changes
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <ParseWorkspace
          items={workItems}
          selectedKey={selectedId}
          onSelect={(key) => {
            setSelectedId(key);
            setEditing(false);
          }}
          title="Parsed bills"
          subtitle={`${bills.length} in register`}
          animateMapping={false}
          footer={
            selected ? (
              <>
                <span className="status">
                  <span className={`fds-dot ${LIFECYCLE[lifecycleOf(selected)].dot}`} />
                  {LIFECYCLE[lifecycleOf(selected)].label}
                </span>
                <span className="app__spacer" />
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setDraft({ ...selected });
                    setEditing(true);
                  }}
                >
                  Edit fields
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--danger"
                  disabled={busyId === selected.id}
                  onClick={() => onDelete(selected)}
                >
                  {busyId === selected.id ? 'Removing…' : 'Remove'}
                </button>
              </>
            ) : null
          }
        />
      )}
    </>
  );
}
