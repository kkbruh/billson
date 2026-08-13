import { Fragment, useCallback, useEffect, useState } from 'react';
import { listCmmsBills, recordUrl, type CmmsBill, type CmmsBillsPage } from '../lib/cmmsBills';
import { errorMessage } from '../lib/api';

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

export function CmmsBillsScreen() {
  const [data, setData] = useState<CmmsBillsPage>({ bills: [], count: null, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const total = data.count ?? data.bills.length;

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
          <button type="button" className="btn" disabled={loading} onClick={() => void load(search)}>
            {loading ? <span className="btn__spinner" aria-hidden="true" /> : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="bi-conn-card__hint" style={{ margin: 0 }}>
        Live records from the Facilio <code>custom_bills</code> module. The attachment opens in
        Facilio — inline rendering and re-parsing come next.
      </p>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
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
                  <th>Due</th>
                  <th>Received</th>
                  <th>Attachment</th>
                  <th aria-label="Open in Facilio" />
                </tr>
              </thead>
              <tbody>
                {data.bills.map((b: CmmsBill) => {
                  const open = expandedId === b.id;
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
                        <td className="bi-muted">{fmtDate(b.dueDate)}</td>
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
                        <td className="bi-num">
                          <a
                            className="btn btn--ghost"
                            href={recordUrl(b.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open ↗
                          </a>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bi-cmms-detail">
                          <td colSpan={9}>
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
