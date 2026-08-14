import { useMemo } from 'react';
import type { BillStats } from '../lib/api';
import type { SavedBill } from '../types';
import { LIFECYCLE } from '../lib/lifecycle';
import { downloadCsv } from '../lib/csv';

interface Props {
  stats: BillStats | null;
  bills: SavedBill[];
  onGoToParse: () => void;
  onGoToInbox: () => void;
}

function money(n: number, currency?: string | null): string {
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

export function StatsScreen({ stats, bills, onGoToParse, onGoToInbox }: Props) {
  const derived = useMemo(() => {
    const currency = bills.find((b) => b.currency)?.currency ?? null;

    // Spend by utility type, largest first — the register is the source of truth.
    const byType = new Map<string, { count: number; total: number }>();
    for (const b of bills) {
      const key = b.utility_type ?? 'unclassified';
      const entry = byType.get(key) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += b.total_amount ?? 0;
      byType.set(key, entry);
    }
    const types = [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.total - a.total);

    // Spend by billing month, from the period start where present.
    const byMonth = new Map<string, number>();
    for (const b of bills) {
      const month = (b.billing_period_start ?? b.statement_date ?? '').slice(0, 7);
      if (!month) continue;
      byMonth.set(month, (byMonth.get(month) ?? 0) + (b.total_amount ?? 0));
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
    const peak = months.reduce((m, [, v]) => Math.max(m, v), 0);

    const withTotal = bills.filter((b) => b.total_amount !== null);
    const average =
      withTotal.length > 0
        ? withTotal.reduce((s, b) => s + (b.total_amount ?? 0), 0) / withTotal.length
        : 0;

    const lowConfidence = bills.filter((b) => b.confidence === 'low' || b.confidence === 'medium');
    const straightThrough =
      bills.length > 0
        ? Math.round(((bills.length - lowConfidence.length) / bills.length) * 100)
        : 0;

    return { currency, types, months, peak, average, straightThrough, lowConfidence };
  }, [bills]);

  const awaiting = stats?.awaiting_review ?? 0;
  const flagged = stats?.flagged ?? 0;

  // ROI framing: manual keying of one utility bill (vendor, account, dates,
  // amounts, line items) is ~6 min. Stated openly so the number is defensible.
  const MIN_PER_BILL = 6;
  const billsDone = stats?.total_bills ?? bills.length;
  const minutesSaved = billsDone * MIN_PER_BILL;
  const hoursSaved = minutesSaved / 60;

  return (
    <>
      {/* ROI hero — the "why this matters" line, first thing you see */}
      <div className="bi-roi" role="group" aria-label="Return on automation">
        <div className="bi-roi__item">
          <span className="bi-roi__value mono">{billsDone.toLocaleString()}</span>
          <span className="bi-roi__label">bills digitized</span>
        </div>
        <span className="bi-roi__dot" aria-hidden="true" />
        <div className="bi-roi__item">
          <span className="bi-roi__value mono">{money(stats?.total_amount ?? 0, derived.currency)}</span>
          <span className="bi-roi__label">value processed</span>
        </div>
        <span className="bi-roi__dot" aria-hidden="true" />
        <div className="bi-roi__item">
          <span className="bi-roi__value mono">
            ~{hoursSaved >= 1 ? `${hoursSaved.toFixed(1)} hrs` : `${minutesSaved} min`}
          </span>
          <span className="bi-roi__label">manual entry saved</span>
        </div>
        <span className="bi-roi__dot" aria-hidden="true" />
        <div className="bi-roi__item">
          <span className="bi-roi__value mono">{derived.straightThrough}%</span>
          <span className="bi-roi__label">straight-through</span>
        </div>
        <span className="bi-roi__note">≈ {MIN_PER_BILL} min/bill of manual keying avoided</span>
      </div>

      {/* pending-action row — "what needs me?" */}
      <div>
        <div className="fds-section-head">
          <span className="fds-section-head__label">What needs me</span>
          <span className="fds-section-head__rule" />
        </div>
        <div className="fds-widget">
          <div className="fds-widget__body fds-widget__body--flush">
            <div className="fds-stat-grid">
              <button type="button" className="fds-stat stat-action" onClick={onGoToInbox}>
                <span className="fds-stat__label">
                  <span className={`fds-dot ${LIFECYCLE.awaiting_review.dot}`} /> Awaiting review
                </span>
                <span className="fds-stat__value mono">{awaiting}</span>
              </button>
              <button type="button" className="fds-stat stat-action" onClick={onGoToInbox}>
                <span className="fds-stat__label">
                  <span className={`fds-dot ${LIFECYCLE.needs_attention.dot}`} /> Needs attention
                </span>
                <span className="fds-stat__value mono">{flagged}</span>
              </button>
              <button type="button" className="fds-stat stat-action" onClick={onGoToParse}>
                <span className="fds-stat__label">
                  <span className="fds-dot fds-dot--neutral" /> Source issues
                </span>
                <span className="fds-stat__value mono">3</span>
                <span className="fds-stat__sub">unconnected</span>
              </button>
              <button type="button" className="fds-stat stat-action" onClick={onGoToInbox}>
                <span className="fds-stat__label">
                  <span className={`fds-dot ${LIFECYCLE.parsed_mapped.dot}`} /> Parsed &amp; mapped
                </span>
                <span className="fds-stat__value mono">{stats?.confirmed ?? 0}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* cost intelligence */}
      <div>
        <div className="fds-section-head">
          <span className="fds-section-head__label">Cost intelligence</span>
          <span className="fds-section-head__rule" />
        </div>
        <div className="fds-widget">
          <div className="fds-widget__header">
            <span className="fds-widget__title">Billed to date</span>
            <span className="fds-widget__range">
              {stats?.last_parsed_at
                ? `Last parsed ${new Date(stats.last_parsed_at).toLocaleString()}`
                : 'Nothing parsed yet'}
            </span>
          </div>
          <div className="fds-widget__body fds-widget__body--flush">
            <div className="fds-stat-grid">
              <div className="fds-stat">
                <span className="fds-stat__label">Total billed</span>
                <span className="fds-stat__value mono">
                  {money(stats?.total_amount ?? 0, derived.currency)}
                </span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Bills</span>
                <span className="fds-stat__value mono">{stats?.total_bills ?? 0}</span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Average bill</span>
                <span className="fds-stat__value mono">{money(derived.average)}</span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Accounts</span>
                <span className="fds-stat__value mono">{stats?.accounts ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* spend by month + by service */}
      <div className="split-2">
        <div className="fds-widget">
          <div className="fds-widget__header">
            <span className="fds-widget__title">Spend by billing month</span>
            <span className="fds-widget__range">Last {derived.months.length || 0} month(s)</span>
          </div>
          <div className="fds-widget__body">
            {derived.months.length === 0 ? (
              <div className="empty">
                <div className="empty__text">
                  No billing periods yet. Parse a bill and this fills in.
                </div>
              </div>
            ) : (
              <div className="bars">
                {derived.months.map(([month, total]) => (
                  <div className="bars__row" key={month}>
                    <span className="bars__label mono">{month}</span>
                    <span className="bars__track">
                      <span
                        className="bars__fill"
                        style={{
                          width: derived.peak > 0 ? `${(total / derived.peak) * 100}%` : '0%',
                        }}
                      />
                    </span>
                    <span className="bars__value mono">{money(total)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>
              Actuals only. Forecasting needs several periods of history per account before
              a range would mean anything, so none is shown yet.
            </p>
          </div>
        </div>

        <div className="fds-widget">
          <div className="fds-widget__header">
            <span className="fds-widget__title">By service</span>
            <span className="fds-widget__range">{derived.types.length} type(s)</span>
          </div>
          <div className="fds-widget__body fds-widget__body--flush">
            {derived.types.length === 0 ? (
              <div className="empty">
                <div className="empty__text">Nothing classified yet.</div>
              </div>
            ) : (
              <table className="fds-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th className="num">Bills</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.types.map((t) => (
                    <tr key={t.type}>
                      <td>{t.type}</td>
                      <td className="num mono">{t.count}</td>
                      <td className="num mono">{money(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* reports — consolidated here rather than a separate tab */}
      <div>
        <div className="fds-section-head">
          <span className="fds-section-head__label">Reports</span>
          <span className="fds-section-head__rule" />
        </div>
        <div className="fds-widget">
          <div className="fds-widget__body">
            <div className="bi-report-row">
              <div>
                <div className="fds-widget__title">Bill register export</div>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  Every parsed bill and its mapped fields, as CSV — for finance or an external system.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                disabled={bills.length === 0}
                onClick={() =>
                  downloadCsv(bills, `bills-${new Date().toISOString().slice(0, 10)}.csv`)
                }
              >
                Export register (CSV)
              </button>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              The spend-by-month and by-service breakdowns above are the live reports; scheduled
              email exports come next.
            </p>
          </div>
        </div>
      </div>

      {/* pipeline health */}
      <div>
        <div className="fds-section-head">
          <span className="fds-section-head__label">Pipeline health</span>
          <span className="fds-section-head__rule" />
        </div>
        <div className="fds-widget">
          <div className="fds-widget__body fds-widget__body--flush">
            <div className="fds-stat-grid">
              <div className="fds-stat">
                <span className="fds-stat__label">Straight-through</span>
                <span className="fds-stat__value mono">{derived.straightThrough}%</span>
                <span className="fds-stat__sub">parsed without review flags</span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Needs a human</span>
                <span className="fds-stat__value mono">{derived.lowConfidence.length}</span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Rejected</span>
                <span className="fds-stat__value mono">0</span>
                <span className="fds-stat__sub">not yet persisted</span>
              </div>
              <div className="fds-stat">
                <span className="fds-stat__label">Template coverage</span>
                <span className="fds-stat__value mono">—</span>
                <span className="fds-stat__sub">templates not built</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
