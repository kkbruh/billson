import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { icons, type IconName } from '../lib/icons';
import { ExtractionUnavailableError, errorMessage, parseBillFile, saveBill } from '../lib/api';
import { fetchProductBills, humanSize } from '../lib/productBills';
import { validateBill } from '../lib/validate';
import type { ExtractedBill, Provenance } from '../types';
import type { FileStatus } from './StatusIcon';

/** A bill waiting in the Inbox — pulled from the product, or uploaded by hand. */
export interface InboxItem {
  key: string;
  file: File;
  name: string;
  sizeBytes: number;
  /** Human label for where it came from. */
  origin: string;
  addedAt: number;
  status: FileStatus | null;
  reason: string | null;
  bill: ExtractedBill | null;
  fileId: number | null;
  savedId: string | null;
}

interface Props {
  items: InboxItem[];
  setItems: Dispatch<SetStateAction<InboxItem[]>>;
  onParsed: (savedId: string, provenance: Provenance[]) => void;
  onReviewAll: () => void;
  reviewer: string | null;
  /** Search term, owned by the top bar. */
  search: string;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.txt';
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|heic|tiff?|txt)$/i;
const PAGE_SIZE = 8;

function validate(file: File, existing: InboxItem[]): string | null {
  if (!ALLOWED_EXT.test(file.name)) return 'Unsupported file type — PDF or image only.';
  if (file.size === 0) return 'File is empty.';
  if (file.size > MAX_BYTES) return `${humanSize(file.size)} exceeds the 20 MB limit.`;
  if (existing.some((i) => i.name === file.name && i.sizeBytes === file.size)) {
    return 'Already in the Inbox.';
  }
  return null;
}

function makeKey(name: string, size: number) {
  return `${name}-${size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function relative(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} mins ago`;
  if (secs < 86400) {
    const h = Math.round(secs / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.round(secs / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}

/** Map a free-form origin string to a source icon + short label. */
function sourceOf(origin: string): { label: string; icon: IconName } {
  const o = origin.toLowerCase();
  if (o.includes('drive')) return { label: 'Drive', icon: 'drive' };
  if (o.includes('sharepoint')) return { label: 'SharePoint', icon: 'sharepoint' };
  if (o.includes('manual')) return { label: 'Manual', icon: 'manual' };
  if (o.includes('email') || o.includes('mail')) return { label: 'Mail rule', icon: 'mail' };
  return { label: 'Product', icon: 'mail' };
}

/** STATUS column pill. */
function statusTag(status: FileStatus | null): {
  label: string;
  cls: string;
  spinner?: boolean;
} {
  switch (status) {
    case 'queued':
      return { label: 'Queued', cls: 'bi-tag--blue' };
    case 'parsing':
      return { label: 'Parsing', cls: 'bi-tag--orange', spinner: true };
    case 'done':
      return { label: 'Validated', cls: 'bi-tag--green' };
    case 'attention':
      return { label: 'Needs attention', cls: 'bi-tag--red' };
    case 'failed':
      return { label: 'Failed', cls: 'bi-tag--red' };
    default:
      return { label: 'Awaiting review', cls: 'bi-tag--amber' };
  }
}

/** Which items count as "still needs a human to kick off / recover". */
function isPending(i: InboxItem): boolean {
  return i.status === null || i.status === 'failed';
}

export function InboxScreen({ items, setItems, onParsed, onReviewAll, reviewer, search }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [justParsed, setJustParsed] = useState(0);

  // filters
  const [view, setView] = useState<'review' | 'all'>('all');
  const [source, setSource] = useState('all');
  const [provider, setProvider] = useState('all');
  const [state, setState] = useState<'all' | 'awaiting' | 'parsing' | 'validated' | 'attention'>(
    'all',
  );
  const [fetchedWindow, setFetchedWindow] = useState<'7' | '30' | '90' | 'all'>('30');

  const fileInput = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, update: Partial<InboxItem>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));

  const add = (files: FileList | File[], origin = 'Manual upload') => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    setError(null);
    setItems((rows) => {
      const next = [...rows];
      const rejected: string[] = [];
      for (const file of incoming) {
        const problem = validate(file, next);
        if (problem) {
          rejected.push(`${file.name}: ${problem}`);
          continue;
        }
        next.push({
          key: makeKey(file.name, file.size),
          file,
          name: file.name,
          sizeBytes: file.size,
          origin,
          addedAt: Date.now(),
          status: null,
          reason: null,
          bill: null,
          fileId: null,
          savedId: null,
        });
      }
      if (rejected.length > 0) setError(rejected.join(' · '));
      return next;
    });
  };

  /** Pull whatever the product has waiting. */
  const fetchFromProduct = async () => {
    setFetching(true);
    setError(null);
    try {
      const fetched = await fetchProductBills();
      if (fetched.length === 0) {
        setError('The product returned no new bills.');
        return;
      }
      setItems((rows) => {
        const next = [...rows];
        let added = 0;
        for (const b of fetched) {
          if (validate(b.file, next) !== null) continue;
          next.push({
            key: makeKey(b.file.name, b.file.size),
            file: b.file,
            name: b.fileName,
            sizeBytes: b.file.size,
            origin: b.origin,
            addedAt: Date.parse(b.receivedAt) || Date.now(),
            status: null,
            reason: null,
            bill: null,
            fileId: null,
            savedId: null,
          });
          added += 1;
        }
        if (added === 0) setError('Every bill the product has is already in the Inbox.');
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setFetching(false);
    }
  };

  /** Extract one bill and write it to the register. */
  const parseOne = useCallback(
    async (key: string, file: File, name: string) => {
      patch(key, { status: 'parsing', reason: null });
      try {
        const { bill, fileId } = await parseBillFile(file);
        // Route to Review on EITHER low model confidence OR a failed independent
        // sanity check — never auto-validate on the model's word alone.
        const lowConfidence = bill.confidence === 'low' || bill.confidence === 'medium';
        const check = validateBill(bill);
        const attention = lowConfidence || !check.ok;
        const reason = !check.ok
          ? check.reason
          : lowConfidence
            ? (bill.notes ?? 'Low confidence — check the values.')
            : null;
        const saved = await saveBill(
          {
            ...bill,
            status: attention ? 'flagged' : 'confirmed',
            file_id: String(fileId),
            file_name: name,
            reviewed_by: reviewer,
          },
          null,
        );
        patch(key, {
          status: attention ? 'attention' : 'done',
          bill,
          fileId,
          savedId: saved.id,
          reason,
        });
        onParsed(saved.id, bill.provenance);
        return true;
      } catch (err) {
        const unavailable = err instanceof ExtractionUnavailableError;
        patch(key, {
          status: 'failed',
          reason: unavailable
            ? 'Automatic extraction is unavailable in this org.'
            : errorMessage(err),
        });
        return false;
      }
    },
    [onParsed, reviewer],
  );

  // ── filtering ───────────────────────────────────────────────────────────────
  const sources = useMemo(
    () => [...new Set(items.map((i) => sourceOf(i.origin).label))].sort(),
    [items],
  );
  const providers = useMemo(
    () =>
      [...new Set(items.map((i) => i.bill?.vendor_name).filter((v): v is string => Boolean(v)))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const now = Date.now();
    const windowMs =
      fetchedWindow === 'all' ? Infinity : Number(fetchedWindow) * 24 * 60 * 60 * 1000;
    return items.filter((i) => {
      if (view === 'review' && !isPending(i) && i.status !== 'attention') return false;
      if (source !== 'all' && sourceOf(i.origin).label !== source) return false;
      if (provider !== 'all' && i.bill?.vendor_name !== provider) return false;
      if (state !== 'all') {
        const s = i.status;
        if (state === 'awaiting' && s !== null) return false;
        if (state === 'parsing' && s !== 'parsing' && s !== 'queued') return false;
        if (state === 'validated' && s !== 'done') return false;
        if (state === 'attention' && s !== 'attention' && s !== 'failed') return false;
      }
      if (now - i.addedAt > windowMs) return false;
      if (term) {
        const hay = `${i.name} ${i.origin} ${i.bill?.vendor_name ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [items, view, source, provider, state, fetchedWindow, search]);

  // Reset to the first page whenever the result set changes shape.
  useEffect(() => {
    setPage(0);
  }, [view, source, provider, state, fetchedWindow, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  // Header checkbox reflects selection state over the *filtered* set.
  const selectableKeys = useMemo(() => filtered.map((i) => i.key), [filtered]);
  const selectedInView = selectableKeys.filter((k) => selected.has(k)).length;
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedInView > 0 && selectedInView < selectableKeys.length;
    }
  }, [selectedInView, selectableKeys.length]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const allSelected = selectableKeys.every((k) => prev.has(k));
      return allSelected ? new Set() : new Set(selectableKeys);
    });

  // ── bulk parse ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const approveAndParse = async () => {
    // Selected & pending first; if nothing is selected, parse every pending row
    // in the current filter.
    const chosen = selected.size > 0 ? filtered.filter((i) => selected.has(i.key)) : filtered;
    const targets = chosen.filter(isPending);
    if (targets.length === 0) return;
    setBusy(true);
    setJustParsed(0);
    setItems((rows) =>
      rows.map((r) =>
        targets.some((t) => t.key === r.key) ? { ...r, status: 'queued', reason: null } : r,
      ),
    );
    let ok = 0;
    for (const t of targets) {
      const success = await parseOne(t.key, t.file, t.name);
      if (success) ok += 1;
    }
    setBusy(false);
    setJustParsed(ok);
    setSelected(new Set());
  };

  const pendingCount = filtered.filter(isPending).length;
  const parseLabel =
    selected.size > 0
      ? `Approve & parse (${filtered.filter((i) => selected.has(i.key) && isPending(i)).length})`
      : `Approve & parse${pendingCount > 0 ? ` (${pendingCount})` : ''}`;

  const hiddenInput = (
    <input
      ref={fileInput}
      type="file"
      multiple
      accept={ACCEPT}
      className="sr-only"
      onChange={(e) => {
        if (e.target.files?.length) add(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <>
      {hiddenInput}

      {/* ── filter / action bar ───────────────────────────────────────────── */}
      <div className="bi-toolbar">
        <label className="bi-select bi-select--primary">
          <select
            value={view}
            aria-label="View"
            onChange={(e) => setView(e.target.value as 'review' | 'all')}
          >
            <option value="review">Needs my review</option>
            <option value="all">All bills</option>
          </select>
        </label>

        <label className="bi-select">
          <select value={source} aria-label="Source" onChange={(e) => setSource(e.target.value)}>
            <option value="all">Source: All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="bi-select">
          <select value="all" aria-label="Client" disabled title="Clients aren't modelled yet">
            <option value="all">Client: All</option>
          </select>
        </label>

        <label className="bi-select">
          <select
            value={provider}
            aria-label="Provider"
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="all">Provider: All</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="bi-select">
          <select
            value={state}
            aria-label="State"
            onChange={(e) => setState(e.target.value as typeof state)}
          >
            <option value="all">State: All</option>
            <option value="awaiting">Awaiting review</option>
            <option value="parsing">Parsing</option>
            <option value="validated">Validated</option>
            <option value="attention">Needs attention</option>
          </select>
        </label>

        <label className="bi-select">
          <select
            value={fetchedWindow}
            aria-label="Date fetched"
            onChange={(e) => setFetchedWindow(e.target.value as typeof fetchedWindow)}
          >
            <option value="7">Date fetched: Last 7d</option>
            <option value="30">Date fetched: Last 30d</option>
            <option value="90">Date fetched: Last 90d</option>
            <option value="all">Date fetched: All time</option>
          </select>
        </label>

        <div className="bi-toolbar__end">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void fetchFromProduct()}
            disabled={fetching}
            title="Fetch bills the product already has"
          >
            {fetching ? <span className="btn__spinner" aria-hidden="true" /> : 'Fetch'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || pendingCount === 0}
            onClick={() => void approveAndParse()}
          >
            {busy ? (
              <span className="btn__spinner" aria-hidden="true" />
            ) : (
              <span className="btn__glyph" style={mask(icons.approve)} aria-hidden="true" />
            )}
            {parseLabel}
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={() => fileInput.current?.click()}
          >
            <span className="btn__glyph" style={mask(icons.upload)} aria-hidden="true" />
            Upload bills
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {justParsed > 0 && !busy && (
        <div className="notice" role="status">
          <span>
            Parsed {justParsed} bill{justParsed === 1 ? '' : 's'} into the register.
          </span>
          <button type="button" className="btn btn--ghost" onClick={onReviewAll}>
            Open Review Queue
          </button>
        </div>
      )}

      {/* ── table ─────────────────────────────────────────────────────────── */}
      <div
        className={`bi-tablecard${dragOver ? ' bi-tablecard--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) add(e.dataTransfer.files);
        }}
      >
        {items.length === 0 ? (
          <div className="bi-empty">
            <div style={{ marginBottom: 'var(--spacing-containerXLarge)' }}>
              No bills yet. Drop a PDF or photo here, upload, or fetch what the product has.
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn" onClick={() => void fetchFromProduct()} disabled={fetching}>
                {fetching ? <span className="btn__spinner" aria-hidden="true" /> : 'Fetch from product'}
              </button>
              <button type="button" className="btn btn--accent" onClick={() => fileInput.current?.click()}>
                <span className="btn__glyph" style={mask(icons.upload)} aria-hidden="true" />
                Upload bills
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bi-tablescroll">
              <table className="bi-table">
                <thead>
                  <tr>
                    <th className="bi-col-check">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        className="bi-check"
                        aria-label="Select all"
                        checked={
                          selectableKeys.length > 0 && selectedInView === selectableKeys.length
                        }
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="bi-col-preview">Preview</th>
                    <th>Filename</th>
                    <th>Source</th>
                    <th>Client / Provider</th>
                    <th>Fetched</th>
                    <th>Validation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const src = sourceOf(item.origin);
                    const tag = statusTag(item.status);
                    const isSel = selected.has(item.key);
                    const providerName = item.bill?.vendor_name ?? null;
                    return (
                      <tr key={item.key} className={isSel ? 'bi-row--selected' : undefined}>
                        <td className="bi-col-check">
                          <input
                            type="checkbox"
                            className="bi-check"
                            aria-label={`Select ${item.name}`}
                            checked={isSel}
                            onChange={() => toggle(item.key)}
                          />
                        </td>
                        <td className="bi-col-preview">
                          <span className="bi-preview-icon" title={item.name}>
                            <span
                              className="bi-nav__icon"
                              style={{ ...mask(icons.doc), width: 15, height: 15 }}
                              aria-hidden="true"
                            />
                          </span>
                        </td>
                        <td>
                          <div className="bi-file">
                            <span className="bi-file__name" title={item.name}>
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="bi-source">
                            <span
                              className="bi-source__icon"
                              style={mask(icons[src.icon])}
                              aria-hidden="true"
                            />
                            {src.label}
                          </span>
                        </td>
                        <td>
                          {providerName ? (
                            <span className="bi-cell-2">
                              <span>{providerName}</span>
                              <span className="bi-cell-2__sub">Provider</span>
                            </span>
                          ) : (
                            <span className="bi-muted">—</span>
                          )}
                        </td>
                        <td className="bi-muted">{relative(item.addedAt)}</td>
                        <td>
                          {item.status === 'failed' ? (
                            <span className="bi-vtext bi-vtext--red">Failed</span>
                          ) : (
                            <span className="bi-vtext bi-vtext--green">Validated</span>
                          )}
                        </td>
                        <td>
                          <span className={`bi-tag ${tag.cls}`} title={item.reason ?? undefined}>
                            {tag.spinner && <span className="bi-tag__spinner" aria-hidden="true" />}
                            {tag.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <div className="bi-empty">Nothing matches these filters.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bi-tablefoot">
              <span className="bi-tablefoot__count">
                {filtered.length === 0
                  ? 'Showing 0 of 0'
                  : `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`}
              </span>
              <div className="bi-pager">
                <button
                  type="button"
                  className="btn"
                  disabled={clampedPage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={clampedPage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
