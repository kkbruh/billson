import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  BILL_STATUS,
  fetchBillFile,
  getLastPull,
  isActionableStatus,
  listCmmsBills,
  pullEmails,
  recordUrl,
  setBillStatus,
  type CmmsBill,
  type CmmsBillsPage,
} from '../lib/cmmsBills';
import { errorMessage } from '../lib/api';
import { DocViewer } from './DocViewer';

interface Props {
  /** Hand a fetched bill PDF to the Bills Inbox (App owns the inbox state). */
  onSendToInbox: (file: File, origin: string, recordId: number) => void;
  onGoToInbox: () => void;
  /** Record ids already queued into the Inbox (owned by App; survives nav). */
  addedIds: Set<number>;
}

/** How many attachment downloads to run at once in "Add all" (rate-limit safe). */
const BULK_CONCURRENCY = 5;

function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}

function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

interface Preview {
  recordId: number;
  url: string;
  type: string;
  name: string;
}

export function CmmsBillsScreen({ onSendToInbox, onGoToInbox, addedIds }: Props) {
  const [data, setData] = useState<CmmsBillsPage>({ bills: [], count: null, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [busyAddId, setBusyAddId] = useState<number | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [lastPull, setLastPull] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  // Default view hides bills that have moved on in their lifecycle (durable, from
  // the Facilio status), not just this session.
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await listCmmsBills({ search: term }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search; also covers the initial load (empty term).
  useEffect(() => {
    const t = setTimeout(() => void load(search), search === '' ? 0 : 300);
    return () => clearTimeout(t);
  }, [search, load]);

  // Fetch the PDF for whichever row is expanded (one at a time, on demand).
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setPreview(null);
    setPreviewError(null);

    const b = data.bills.find((x) => x.id === expandedId);
    if (!b || !b.attachment) return;

    setPreviewLoading(true);
    fetchBillFile(b.id, b.attachment.fileName)
      .then((p) => {
        if (cancelled) {
          URL.revokeObjectURL(p.url);
          return;
        }
        createdUrl = p.url;
        setPreview({ recordId: b.id, url: p.url, type: p.type, name: p.name });
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [expandedId, data.bills]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Show when the mailbox was last swept.
  useEffect(() => {
    void getLastPull().then(setLastPull).catch(() => {});
  }, []);

  // Manual on-demand mailbox scour → new CMMS bill records → refresh the list.
  const pullNow = async () => {
    setPulling(true);
    setError(null);
    try {
      const res = await pullEmails();
      setLastPull(res.finishedAt);
      await load(search);
      setNotice(
        `Scoured ${res.scanned} email${res.scanned === 1 ? '' : 's'} — ` +
          `${res.recordsCreated} new bill${res.recordsCreated === 1 ? '' : 's'} created.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPulling(false);
    }
  };

  const total = data.count ?? data.bills.length;
  // Visibility is driven purely by the durable Facilio status — NOT local session
  // state — so every browser/user sees the same buckets. Actionable = the status
  // is still untouched (empty / "Yet To Triage"). "Show all" reveals the rest.
  const visible = showAll ? data.bills : data.bills.filter((b) => isActionableStatus(b.billStatus));
  const pending = visible.filter((b) => b.attachment);

  /** Optimistically reflect a status write locally so the row leaves the actionable
   *  bucket immediately (the durable source is still Facilio on the next load). */
  const markStatusLocal = (id: number, label: string) =>
    setData((d) => ({
      ...d,
      bills: d.bills.map((x) => (x.id === id ? { ...x, billStatus: label } : x)),
    }));

  const addOne = async (b: CmmsBill) => {
    if (!b.attachment || addedIds.has(b.id)) return;
    setBusyAddId(b.id);
    setError(null);
    try {
      const { file } = await fetchBillFile(b.id, b.attachment.fileName);
      onSendToInbox(file, `CMMS · ${b.name ?? 'bill'}`, b.id);
      // Durably mark it "Under Review" in Facilio so it drops off the list for
      // everyone — not just this browser. Non-fatal if the write fails.
      try {
        await setBillStatus(b.id, BILL_STATUS.underReview);
        markStatusLocal(b.id, 'Under Review');
      } catch {
        /* status write failed — the item is still queued locally */
      }
      setNotice(`Added “${b.attachment.fileName}” to the Bills Inbox.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyAddId(null);
    }
  };

  /**
   * Bulk add: fetch attachments through a bounded worker pool (BULK_CONCURRENCY
   * at a time) rather than one-at-a-time — parallel where it helps, but capped so
   * we never burst past the connection rate limit. App dedupes by record id, so a
   * re-run only picks up what's genuinely new.
   */
  const addAll = async () => {
    const targets = data.bills.filter((b) => b.attachment && isActionableStatus(b.billStatus));
    if (targets.length === 0) {
      setNotice('Nothing new to add — every attachment is already queued in the Inbox.');
      return;
    }
    setBulkRunning(true);
    setError(null);

    let cursor = 0;
    let done = 0;
    let failed = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= targets.length) return;
        const b = targets[i];
        try {
          const { file } = await fetchBillFile(b.id, b.attachment!.fileName);
          onSendToInbox(file, `CMMS · ${b.name ?? 'bill'}`, b.id);
          try {
            await setBillStatus(b.id, BILL_STATUS.underReview);
            markStatusLocal(b.id, 'Under Review');
          } catch {
            /* status write failed — item still queued locally */
          }
          done += 1;
        } catch {
          failed += 1;
        }
        setNotice(`Adding to Inbox… ${done + failed}/${targets.length}`);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, () => worker()),
    );

    setBulkRunning(false);
    setNotice(`Added ${done} bill${done === 1 ? '' : 's'} to the Inbox${failed ? `, ${failed} failed` : ''}.`);
  };

  return (
    <>
      <div className="bi-toolbar">
        <div className="bi-search" style={{ maxWidth: 360 }}>
          <input
            className="input"
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search Facilio bills by name"
          />
        </div>
        <div className="bi-toolbar__end">
          <span className="bi-tablefoot__count" title="When the Outlook mailbox was last scoured">
            Last pulled: {lastPull ? fmtDate(lastPull, true) : 'never'}
          </span>
          <button
            type="button"
            className="btn"
            disabled={pulling}
            onClick={() => void pullNow()}
            title="Scour the Outlook mailbox now for new bills"
          >
            {pulling ? <span className="btn__spinner" aria-hidden="true" /> : null}
            {pulling ? ' Pulling…' : 'Pull emails'}
          </button>
          <span className="bi-tablefoot__count">
            {loading
              ? 'Loading…'
              : showAll
                ? `${total} record${total === 1 ? '' : 's'}`
                : `${visible.length} to action · ${total} total`}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? 'Show only bills that still need action' : 'Show every record, actioned or not'}
          >
            {showAll ? 'Actionable only' : 'Show all'}
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={bulkRunning || loading || pending.length === 0}
            onClick={() => void addAll()}
            title="Fetch every attachment not yet queued and add it to the Bills Inbox"
          >
            {bulkRunning ? <span className="btn__spinner" aria-hidden="true" /> : null}
            {bulkRunning ? ' Adding…' : `Add all to Inbox (${pending.length})`}
          </button>
          <button type="button" className="btn" disabled={loading} onClick={() => void load(search)}>
            {loading ? <span className="btn__spinner" aria-hidden="true" /> : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="bi-conn-card__hint" style={{ margin: 0 }}>
        Live records from the Facilio <code>custom_bills</code> module. Expand a row to preview the
        bill PDF; “Add to Inbox” sends it to the Bills Inbox for parsing → Review.
      </p>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice--success" role="status">
          <span>{notice}</span>
          {addedIds.size > 0 && (
            <button type="button" className="btn btn--ghost" onClick={onGoToInbox}>
              Open Inbox
            </button>
          )}
        </div>
      )}

      <div className="bi-tablecard">
        {!error && !loading && visible.length === 0 ? (
          <div className="bi-empty">
            {search
              ? `No records match “${search}”.`
              : data.bills.length > 0
                ? 'All caught up — every bill has been actioned. Use “Show all” to see them.'
                : 'No bill records in the module yet.'}
          </div>
        ) : (
          <div className="bi-tablescroll">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Vendor</th>
                  <th className="bi-num">Amount</th>
                  <th>Invoice #</th>
                  <th>Received</th>
                  <th>Attachment</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((b: CmmsBill) => {
                  const open = expandedId === b.id;
                  // "Handled" is derived from the durable Facilio status, not local state.
                  const handled = !isActionableStatus(b.billStatus);
                  const adding = busyAddId === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr
                        className={`bi-cmms-row${open ? ' bi-row--selected' : ''}`}
                        onClick={() => setExpandedId(open ? null : b.id)}
                      >
                        <td>
                          <span className="bi-file__name" title={b.name ?? undefined}>
                            {b.name ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span className="bi-source">
                            <span
                              className={`fds-dot ${handled ? 'fds-dot--info' : 'fds-dot--neutral'}`}
                            />
                            {b.billStatus ?? 'Yet To Triage'}
                          </span>
                        </td>
                        <td>{b.vendor ?? <span className="bi-muted">—</span>}</td>
                        <td className="bi-num bi-mono">{fmtMoney(b.amount, b.currency)}</td>
                        <td>{b.invoiceNumber ?? <span className="bi-muted">—</span>}</td>
                        <td className="bi-muted">{fmtDate(b.receivedAt)}</td>
                        <td>
                          {b.attachment ? (
                            <span className="bi-tag bi-tag--neutral" title={b.attachment.fileName}>
                              📎 {b.attachment.fileName}
                            </span>
                          ) : (
                            <span className="bi-muted">—</span>
                          )}
                        </td>
                        <td className="bi-num" onClick={(e) => e.stopPropagation()}>
                          <div className="bi-cmms-actions">
                            {b.attachment &&
                              (handled ? (
                                <span className="bi-tag bi-tag--neutral">{b.billStatus}</span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  disabled={adding || bulkRunning}
                                  onClick={() => void addOne(b)}
                                >
                                  {adding ? <span className="btn__spinner" aria-hidden="true" /> : null}
                                  {adding ? ' Adding…' : 'Add to Inbox'}
                                </button>
                              ))}
                            <a
                              className="btn btn--ghost"
                              href={recordUrl(b.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bi-cmms-detail">
                          <td colSpan={8}>
                            <div className="bi-cmms-expand">
                              <div className="bi-cmms-preview">
                                {!b.attachment ? (
                                  <div className="bi-empty">No attachment on this record.</div>
                                ) : previewError ? (
                                  <div className="notice notice--error" role="alert">
                                    <span>{previewError}</span>
                                  </div>
                                ) : (
                                  <DocViewer
                                    url={preview?.recordId === b.id ? preview.url : null}
                                    type={preview?.recordId === b.id ? preview.type : null}
                                    name={b.attachment.fileName}
                                    scanning={previewLoading && preview?.recordId !== b.id}
                                  />
                                )}
                              </div>
                              <div className="bi-cmms-side">
                                <dl className="bi-detail__grid">
                                  <div>
                                    <dt>From</dt>
                                    <dd>{b.fromEmail ?? '—'}</dd>
                                  </div>
                                  <div>
                                    <dt>Received</dt>
                                    <dd>{fmtDate(b.receivedAt, true)}</dd>
                                  </div>
                                  <div>
                                    <dt>Record id</dt>
                                    <dd>{b.id}</dd>
                                  </div>
                                  <div className="bi-detail__wide">
                                    <dt>Description</dt>
                                    <dd>{b.description ?? '—'}</dd>
                                  </div>
                                </dl>
                                {b.attachment && (
                                  <div className="bi-cmms-actions">
                                    {handled ? (
                                      <button type="button" className="btn" onClick={onGoToInbox}>
                                        Open in Inbox →
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn--accent"
                                        disabled={adding || bulkRunning}
                                        onClick={() => void addOne(b)}
                                      >
                                        {adding ? <span className="btn__spinner" aria-hidden="true" /> : null}
                                        {adding ? ' Adding…' : 'Add to Inbox'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
