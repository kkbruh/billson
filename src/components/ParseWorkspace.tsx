import { useEffect, useMemo, useRef, useState } from 'react';
import { QUEUE_META, type QueueState } from '../lib/lifecycle';
import {
  FIELD_GROUPS,
  FIELDS,
  displayValue,
  evidenceFor,
  hasValue,
  mappedFields,
} from '../lib/fields';
import type { ExtractedBill } from '../types';

/** One row in the left-hand queue. */
export interface WorkItem {
  key: string;
  name: string;
  queueState: QueueState;
  bill: ExtractedBill | null;
  /** Object URL for the source document, when one is available to preview. */
  previewUrl: string | null;
  previewType: string | null;
  error: string | null;
}

interface Props {
  items: WorkItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  title: string;
  /** Shown above the queue — e.g. "3 of 5 parsed". */
  subtitle: string;
  /** When true, fields reveal one by one as the mapping animates. */
  animateMapping: boolean;
  footer?: React.ReactNode;
}

/** How long each field's reveal takes during the mapping walkthrough. */
const STEP_MS = 220;

export function ParseWorkspace({
  items,
  selectedKey,
  onSelect,
  title,
  subtitle,
  animateMapping,
  footer,
}: Props) {
  const selected = useMemo(
    () => items.find((i) => i.key === selectedKey) ?? null,
    [items, selectedKey],
  );

  const bill = selected?.bill ?? null;
  const filled = useMemo(() => (bill ? mappedFields(bill) : []), [bill]);

  // How many of the filled fields have been revealed so far.
  const [revealed, setRevealed] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);

    if (!bill) {
      setRevealed(0);
      return;
    }
    if (!animateMapping) {
      setRevealed(filled.length);
      return;
    }

    setRevealed(0);
    timer.current = window.setInterval(() => {
      setRevealed((n) => {
        if (n >= filled.length) {
          if (timer.current) window.clearInterval(timer.current);
          return n;
        }
        return n + 1;
      });
    }, STEP_MS);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [bill, filled.length, animateMapping]);

  // The field currently being mapped drives the evidence callout in the centre.
  const activeField = animateMapping && revealed > 0 && revealed <= filled.length
    ? filled[revealed - 1]
    : null;
  const activeEvidence =
    bill && activeField ? evidenceFor(bill, String(activeField.key)) : null;

  /**
   * Browsers won't render text/plain inside <object>, so plain-text documents are
   * read and shown directly. PDFs and images render natively.
   */
  const [docText, setDocText] = useState<string | null>(null);
  useEffect(() => {
    setDocText(null);
    const url = selected?.previewUrl;
    const type = selected?.previewType ?? '';
    const looksText = type.startsWith('text/') || /\.txt$/i.test(selected?.name ?? '');
    if (!url || !looksText) return;

    let cancelled = false;
    void fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setDocText(t.slice(0, 20000));
      })
      .catch(() => {
        /* fall back to the object/embed path */
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.previewUrl, selected?.previewType, selected?.name]);

  const isVisible = (key: string) => {
    if (!animateMapping) return true;
    const idx = filled.findIndex((f) => f.key === key);
    return idx === -1 ? false : idx < revealed;
  };

  return (
    <div className="workspace">
      {/* ── left: the queue ─────────────────────────────────────────────── */}
      <aside className="fds-widget workspace__queue">
        <div className="fds-widget__header">
          <span className="fds-widget__title">{title}</span>
          <span className="fds-widget__range">{subtitle}</span>
        </div>
        <div className="fds-widget__body fds-widget__body--flush">
          <ul className="queue">
            {items.map((item) => {
              const meta = QUEUE_META[item.queueState];
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`queue__item${
                      item.key === selectedKey ? ' queue__item--active' : ''
                    }`}
                    onClick={() => onSelect(item.key)}
                  >
                    <span
                      className={`queue__glyph queue__glyph--${item.queueState}`}
                      aria-hidden="true"
                    >
                      {meta.glyph}
                    </span>
                    <span className="queue__body">
                      <span className="queue__name">{item.name}</span>
                      <span className="queue__meta">
                        {item.error ?? meta.label}
                        {item.bill?.vendor_name ? ` · ${item.bill.vendor_name}` : ''}
                      </span>
                    </span>
                    {item.bill?.total_amount != null && (
                      <span className="queue__amount mono">
                        {item.bill.currency ? `${item.bill.currency} ` : ''}
                        {item.bill.total_amount.toFixed(2)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {footer && <div className="fds-widget__footer">{footer}</div>}
      </aside>

      {/* ── centre: the document ────────────────────────────────────────── */}
      <section className="fds-widget workspace__doc">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Document</span>
          <span className="fds-widget__range">{selected?.name ?? '—'}</span>
        </div>
        <div className="fds-widget__body">
          {!selected ? (
            <div className="empty">
              <div className="empty__text">Pick a bill from the queue.</div>
            </div>
          ) : (
            <>
              <div className="docview">
                {docText !== null ? (
                  <pre className="docview__text">{docText}</pre>
                ) : selected.previewUrl ? (
                  selected.previewType?.startsWith('image/') ? (
                    <img className="docview__img" src={selected.previewUrl} alt={selected.name} />
                  ) : (
                    <object
                      className="docview__frame"
                      data={selected.previewUrl}
                      type={selected.previewType ?? 'application/pdf'}
                      aria-label={`Preview of ${selected.name}`}
                    >
                      <div className="empty">
                        <div className="empty__text">
                          This browser can&apos;t preview {selected.name} inline.
                        </div>
                      </div>
                    </object>
                  )
                ) : (
                  <div className="empty">
                    <div className="empty__text">
                      No inline preview for this file. The extracted values and the text
                      each came from are still shown.
                    </div>
                  </div>
                )}
              </div>

              {/* Evidence: the verbatim text the current value was read from. */}
              <div className={`evidence${activeEvidence ? ' evidence--on' : ''}`}>
                {activeField && activeEvidence ? (
                  <>
                    <span className="evidence__label">
                      Mapping <strong>{activeField.label}</strong> from
                    </span>
                    <span className="evidence__quote">“{activeEvidence}”</span>
                  </>
                ) : bill ? (
                  <span className="evidence__label">
                    {bill.provenance.length > 0
                      ? `${bill.provenance.length} field(s) have source evidence — select a field on the right to see it.`
                      : 'The extractor returned no source evidence for this document.'}
                  </span>
                ) : (
                  <span className="evidence__label">Waiting for the parse to finish…</span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── right: Facilio fields ───────────────────────────────────────── */}
      <section className="fds-widget workspace__fields">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Facilio fields</span>
          <span className="fds-widget__range">
            {bill ? `${filled.length} of ${FIELDS.length} mapped` : '—'}
          </span>
        </div>
        <div className="fds-widget__body">
          {!bill ? (
            <div className="empty">
              <div className="empty__text">
                {selected?.queueState === 'in_progress'
                  ? 'Reading the document…'
                  : selected?.error
                    ? selected.error
                    : 'Nothing parsed for this bill yet.'}
              </div>
            </div>
          ) : (
            FIELD_GROUPS.map((group) => {
              const rows = FIELDS.filter((f) => f.group === group);
              return (
                <div key={group}>
                  <div className="fds-section-head">
                    <span className="fds-section-head__label">{group}</span>
                    <span className="fds-section-head__rule" />
                  </div>
                  <dl className="fieldmap">
                    {rows.map((f) => {
                      const present = hasValue(bill, f.key);
                      const visible = present && isVisible(String(f.key));
                      const active = activeField?.key === f.key;
                      const evidence = evidenceFor(bill, String(f.key));
                      return (
                        <div
                          className={`fieldmap__row${active ? ' fieldmap__row--active' : ''}`}
                          key={String(f.key)}
                          title={evidence ? `Read from: “${evidence}”` : undefined}
                        >
                          <dt className="fieldmap__key">{f.label}</dt>
                          <dd className="fieldmap__val">
                            {visible ? (
                              displayValue(bill[f.key])
                            ) : present ? (
                              <span className="fieldmap__pending" aria-hidden="true" />
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
