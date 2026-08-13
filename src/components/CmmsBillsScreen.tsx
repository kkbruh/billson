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

  const rangeLabel = loading
    ? 'Loading…'
    : `${data.count ?? data.bills.length} record${(data.count ?? data.bills.length) === 1 ? '' : 's'}`;

  return (
    <>
      <div className="fds-widget">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Facilio Bills (CMMS)</span>
          <span className="fds-widget__range">{rangeLabel}</span>
        </div>
        <div className="fds-widget__body">
          <p className="muted cmms-lead">
            Live records from the Facilio <code>custom_bills</code> module. The attachment opens in
            Facilio — inline rendering and re-parsing come next.
          </p>
          <div className="row">
            <input
              className="input input--search"
              type="search"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Facilio bills by name"
            />
            <span className="app__spacer" />
            <button type="button" className="btn" disabled={loading} onClick={() => void load(search)}>
              {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
              {loading ? ' Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {!error && !loading && data.bills.length === 0 ? (
        <div className="fds-widget">
          <div className="fds-widget__body">
            <div className="empty">
              <div className="empty__text">
                {search ? `No records match “${search}”.` : 'No bill records in the module yet.'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="fds-widget">
          <div className="fds-widget__body fds-widget__body--flush">
            <div className="table-scroll">
              <table className="cmms-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Vendor</th>
                    <th className="cmms-table__num">Amount</th>
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
                          className={`cmms-row${open ? ' cmms-row--open' : ''}`}
                          onClick={() => setExpandedId(open ? null : b.id)}
                        >
                          <td className="cmms-table__name">{b.name ?? '—'}</td>
                          <td>
                            <span className="status">
                              <span className="fds-dot fds-dot--neutral" />
                              {b.status ?? '—'}
                            </span>
                          </td>
                          <td>{b.vendor ?? '—'}</td>
                          <td className="cmms-table__num">{fmtMoney(b.amount, b.currency)}</td>
                          <td>{b.invoiceNumber ?? '—'}</td>
                          <td>{fmtDate(b.dueDate)}</td>
                          <td>{fmtDate(b.receivedAt)}</td>
                          <td>
                            {b.attachment ? (
                              <span className="chip chip--neutral cmms-file" title={b.attachment.fileName}>
                                📎 {b.attachment.fileName}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="cmms-table__num">
                            <a
                              className="btn btn--ghost cmms-open"
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
                          <tr className="cmms-detail">
                            <td colSpan={9}>
                              <dl className="cmms-detail__grid">
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
                                <div className="cmms-detail__wide">
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
          </div>
        </div>
      )}
    </>
  );
}
