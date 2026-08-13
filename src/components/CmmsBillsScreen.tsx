import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  fetchBillFile,
  listCmmsBills,
  recordUrl,
  type CmmsBill,
  type CmmsBillsPage,
} from '../lib/cmmsBills';
import { errorMessage } from '../lib/api';
import { DocViewer } from './DocViewer';

interface Props {
  /** Hand a fetched bill PDF to the Bills Inbox (App owns the inbox state). */
  onSendToInbox: (file: File, origin: string) => void;
  onGoToInbox: () => void;
}

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

export function CmmsBillsScreen({ onSendToInbox, onGoToInbox }: Props) {
  const [data, setData] = useState<CmmsBillsPage>({ bills: [], count: null, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [busyAddId, setBusyAddId] = useState<number | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

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

  const total = data.count ?? data.bills.length;
  const pending = data.bills.filter((b) => b.attachment && !addedIds.has(b.id));

  const addOne = async (b: CmmsBill) => {
    if (!b.attachment) return;
    setBusyAddId(b.id);
    setError(null);
    try {
      const { file } = await fetchBillFile(b.id, b.attachment.fileName);
      onSendToInbox(file, `CMMS · ${b.name ?? 'bill'}`);
      setAddedIds((s) => new Set(s).add(b.id));
      setNotice(`Added “${b.attachment.fileName}” to the Bills Inbox.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyAddId(null);
    }
  };

  const addAll = async () => {
    const targets = data.bills.filter((b) => b.attachment && !addedIds.has(b.id));
    if (targets.length === 0) {
      setNotice('Nothing new to add — every attachment is already queued in the Inbox.');
      return;
    }
    setBulkRunning(true);
    setError(null);
    let added = 0;
    let failed = 0;
    for (const b of targets) {
      try {
        const { file } = await fetchBillFile(b.id, b.attachment!.fileName);
        onSendToInbox(file, `CMMS · ${b.name ?? 'bill'}`);
        setAddedIds((s) => new Set(s).add(b.id));
        added += 1;
        setNotice(`Adding to Inbox… ${added}/${targets.length}`);
      } catch {
        failed += 1;
      }
    }
    setBulkRunning(false);
    setNotice(`Added ${added} bill${added === 1 ? '' : 's'} to the Inbox${failed ? `, ${failed} failed` : ''}.`);
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
          <span className="bi-tablefoot__count">
            {loading ? 'Loading…' : `${total} record${total === 1 ? '' : 's'}`}
          </span>
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
        {!error && !loading && data.bills.length === 0 ? (
          <div className="bi-empty">
            {search ? `No records match “${search}”.` : 'No bill records in the module yet.'}
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
                {data.bills.map((b: CmmsBill) => {
                  const open = expandedId === b.id;
                  const added = addedIds.has(b.id);
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
                            <span className="fds-dot fds-dot--neutral" />
                            {b.status ?? '—'}
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
                              (added ? (
                                <span className="bi-tag bi-tag--green">✓ In Inbox</span>
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
                                    {added ? (
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
