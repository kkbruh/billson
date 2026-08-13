import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import pdfIcon from '../assets/icons/file-pdf.svg';
import refreshIcon from '../assets/icons/action-refresh.svg';
import uploadIcon from '../assets/icons/action-upload.svg';
import trashIcon from '../assets/icons/action-trash.svg';
import sparkIcon from '../assets/icons/action-spark.svg';

/** Quoted so the inlined data: URI stays valid inside CSS url(). */
function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}
import { ExtractionUnavailableError, errorMessage, parseBillFile, saveBill } from '../lib/api';
import { fetchProductBills, humanSize } from '../lib/productBills';
import { FIELDS, displayValue, hasValue } from '../lib/fields';
import type { ExtractedBill, Provenance } from '../types';
import { StatusIcon, STATUS_LABEL, type FileStatus } from './StatusIcon';
import { DocViewer } from './DocViewer';

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
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.txt';
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|heic|tiff?|txt)$/i;

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

export function InboxScreen({ items, setItems, onParsed, onReviewAll, reviewer }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Null = list mode; an array of keys = the 2-partition parsing view. */
  const [runKeys, setRunKeys] = useState<string[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [runDone, setRunDone] = useState(false);

  /** Set when a single bill is parsed in the overlay modal. */
  const [modalKey, setModalKey] = useState<string | null>(null);

  // Object URLs for previews, created on demand and revoked on unmount.
  const previews = useRef(new Map<string, { url: string; type: string }>());
  useEffect(
    () => () => {
      previews.current.forEach((p) => URL.revokeObjectURL(p.url));
      previews.current.clear();
    },
    [],
  );

  const previewFor = useCallback((item: InboxItem) => {
    const cached = previews.current.get(item.key);
    if (cached) return cached;
    const type =
      item.file.type ||
      (/\.pdf$/i.test(item.name)
        ? 'application/pdf'
        : /\.txt$/i.test(item.name)
          ? 'text/plain'
          : 'image/*');
    const entry = { url: URL.createObjectURL(item.file), type };
    previews.current.set(item.key, entry);
    return entry;
  }, []);

  const patch = (key: string, update: Partial<InboxItem>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));

  const add = (files: FileList | File[], origin = 'Manual upload') => {
    // Snapshot eagerly: a FileList is live and the updater runs after this returns.
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

  /** Extract one bill and write it to the register. Shared by every entry point. */
  const parseOne = useCallback(
    async (key: string, file: File, name: string) => {
      patch(key, { status: 'parsing', reason: null });
      try {
        const { bill, fileId } = await parseBillFile(file);
        const attention = bill.confidence === 'low' || bill.confidence === 'medium';
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
          reason: attention ? (bill.notes ?? 'Low confidence — check the values.') : null,
        });
        onParsed(saved.id, bill.provenance);
      } catch (err) {
        const unavailable = err instanceof ExtractionUnavailableError;
        patch(key, {
          status: 'failed',
          reason: unavailable
            ? 'Automatic extraction is unavailable in this org.'
            : errorMessage(err),
        });
      }
    },
    [onParsed, reviewer],
  );

  /** Parse a set of bills one at a time, in the 2-partition view. */
  const startRun = async (keys: string[]) => {
    if (keys.length === 0) return;
    setRunKeys(keys);
    setRunDone(false);
    setItems((rows) =>
      rows.map((r) => (keys.includes(r.key) ? { ...r, status: 'queued', reason: null } : r)),
    );

    const snapshot = items;
    for (const key of keys) {
      const row = snapshot.find((i) => i.key === key);
      if (!row) continue;
      setSelectedKey(key);
      await parseOne(key, row.file, row.name);
    }
    setRunDone(true);
  };

  const retry = async (key: string) => {
    const row = items.find((i) => i.key === key);
    if (!row) return;
    setSelectedKey(key);
    await parseOne(key, row.file, row.name);
  };

  /** Parse a single bill inside the overlay modal. */
  const parseInModal = async (key: string) => {
    const row = items.find((i) => i.key === key);
    if (!row) return;
    setModalKey(key);
    await parseOne(key, row.file, row.name);
  };

  const pending = useMemo(
    () => items.filter((i) => i.status === null || i.status === 'failed'),
    [items],
  );

  const modalItem = modalKey ? (items.find((i) => i.key === modalKey) ?? null) : null;

  // ── the header, shared by both modes ──────────────────────────────────────
  const head = (parsing: boolean) => (
    <div className="page-head">
      <div className="page-head__text">
        <h1 className="page-head__title">
          {parsing ? 'Parsing in progress…' : 'Bills to parse'}
        </h1>
        <p className="page-head__sub">
          {parsing
            ? 'Bills are being parsed. Add more files to the queue.'
            : 'Upload or fetch bills to extract and map their details to Facilio.'}
        </p>
      </div>
      <div className="page-head__actions">
        <button
          type="button"
          className="icon-btn icon-btn--subtle"
          onClick={() => void fetchFromProduct()}
          disabled={fetching}
          aria-label="Fetch bills from the product"
          title="Fetch bills from the product"
        >
          {fetching ? (
            <span className="btn__spinner" aria-hidden="true" />
          ) : (
            <span className="icon-btn__glyph" style={mask(refreshIcon)} aria-hidden="true" />
          )}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <span className="btn__icon" style={mask(uploadIcon)} aria-hidden="true" />
          Upload
        </button>
      </div>
    </div>
  );

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

  // ── 2-partition parsing view ──────────────────────────────────────────────
  if (runKeys) {
    const runItems = runKeys
      .map((k) => items.find((i) => i.key === k))
      .filter((i): i is InboxItem => Boolean(i));

    const completed = runItems.filter(
      (i) => i.status === 'done' || i.status === 'attention',
    ).length;
    const active = runItems.find((i) => i.status === 'parsing') ?? null;
    const selected = runItems.find((i) => i.key === selectedKey) ?? runItems[0] ?? null;
    const preview = selected ? previewFor(selected) : null;

    return (
      <>
        {hiddenInput}
        <div className="app__main-inner">
          {head(true)}

          <div className="parsing">
            <aside className="parsing__panel">
              <div className="parsing__panel-head">
                <span className="parsing__count">
                  {completed} of {runItems.length} completed
                </span>
                {runDone && (
                  <button type="button" className="btn btn--primary" onClick={onReviewAll}>
                    Review all
                  </button>
                )}
              </div>

              <ul className="parsing__list">
                {runItems.map((item) => {
                  const status = item.status ?? 'queued';
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={[
                          'statusrow',
                          item.key === selectedKey ? 'statusrow--active' : '',
                          status === 'parsing' ? 'statusrow--parsing' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelectedKey(item.key)}
                        title={item.reason ?? STATUS_LABEL[status]}
                      >
                        <img className="filerow__icon" src={pdfIcon} alt="" />
                        <span className="statusrow__name">{item.name}</span>
                        <span className="statusrow__slot">
                          {status === 'failed' && (
                            <button
                              type="button"
                              className="retry-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void retry(item.key);
                              }}
                            >
                              Retry
                            </button>
                          )}
                          <StatusIcon status={status} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="parsing__panel-head" style={{ borderTop: '1px solid var(--colors-borderNeutralBaseSubtler)', borderBottom: 'none' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setRunKeys(null);
                    setRunDone(false);
                    setSelectedKey(null);
                  }}
                >
                  Back to Inbox
                </button>
              </div>
            </aside>

            <DocViewer
              url={preview?.url ?? null}
              type={preview?.type ?? null}
              name={selected?.name ?? '—'}
              scanning={Boolean(active) && selected?.key === active?.key}
            />
          </div>
        </div>
      </>
    );
  }

  // ── list mode ─────────────────────────────────────────────────────────────
  return (
    <>
      {hiddenInput}
      <div className="inbox">
        {head(false)}

        {error && (
          <div className="notice notice--error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {items.length === 0 ? (
          <div
            className={`dropzone-xl${dragOver ? ' dropzone-xl--over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
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
            <span className="dropzone-xl__lead">Drop your bills here</span>
            <span className="dropzone-xl__or">or</span>
            <span className="btn">
              <span className="btn__icon" style={mask(uploadIcon)} aria-hidden="true" />
              Upload
            </span>
            <span className="dropzone-xl__hint">
              or pull what the product already has, with the refresh button above
            </span>
          </div>
        ) : (
          <>
            <ul
              className="filelist"
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
              {items.map((item) => (
                <li key={item.key}>
                  <div className="filerow">
                    <span className="filerow__badge">
                      <img className="filerow__icon" src={pdfIcon} alt="PDF" />
                    </span>
                    <div className="filerow__body">
                      <span className="filerow__name">{item.name}</span>
                      <span className="filerow__meta">
                        {humanSize(item.sizeBytes)} · {item.origin}
                      </span>
                    </div>
                    <div
                      className={`filerow__actions${
                        item.status ? ' filerow__actions--always' : ''
                      }`}
                    >
                      {item.status && <StatusIcon status={item.status} />}
                      <button
                        type="button"
                        className="iconbtn-sm iconbtn-sm--primary"
                        title="Parse Individual"
                        aria-label={`Parse ${item.name} individually`}
                        onClick={() => void parseInModal(item.key)}
                      >
                        <span className="btn__icon" style={mask(sparkIcon)} aria-hidden="true" />
                      </button>
                      <span className="filerow__divider" />
                      <button
                        type="button"
                        className="iconbtn-sm iconbtn-sm--danger"
                        title="Remove"
                        aria-label={`Remove ${item.name}`}
                        onClick={() =>
                          setItems((rows) => rows.filter((r) => r.key !== item.key))
                        }
                      >
                        <span className="btn__icon" style={mask(trashIcon)} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="cta-bar">
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={pending.length === 0}
                onClick={() => void startRun(pending.map((i) => i.key))}
              >
                Parse All ({pending.length}) Bills
              </button>
            </div>
          </>
        )}
      </div>

      {/* individual parse happens in an overlay */}
      {modalItem && (
        <ParseOverlay
          item={modalItem}
          preview={previewFor(modalItem)}
          onClose={() => setModalKey(null)}
          onReview={onReviewAll}
          onRetry={() => void retry(modalItem.key)}
        />
      )}
    </>
  );
}

// ── overlay modal for a single bill ─────────────────────────────────────────

function ParseOverlay({
  item,
  preview,
  onClose,
  onReview,
  onRetry,
}: {
  item: InboxItem;
  preview: { url: string; type: string };
  onClose: () => void;
  onReview: () => void;
  onRetry: () => void;
}) {
  // Escape closes, and focus starts inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = item.status ?? 'queued';
  const bill = item.bill;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Parsing ${item.name}`}>
      <div className="modal__panel">
        <div className="modal__head">
          <img className="filerow__icon" src={pdfIcon} alt="" />
          <span className="modal__title">{item.name}</span>
          <span className="status">
            <StatusIcon status={status} />
            {STATUS_LABEL[status]}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <DocViewer
            url={preview.url}
            type={preview.type}
            name={item.name}
            scanning={status === 'parsing'}
          />

          <div className="modal__fields">
            <div className="fds-section-head">
              <span className="fds-section-head__label">Facilio fields</span>
              <span className="fds-section-head__rule" />
            </div>

            {status === 'parsing' && (
              <p className="muted">Reading the document…</p>
            )}

            {status === 'failed' && (
              <div className="notice notice--error" role="alert">
                <span>{item.reason ?? 'Extraction failed.'}</span>
              </div>
            )}

            {bill && (
              <>
                {item.reason && status === 'attention' && (
                  <div className="notice notice--warning">
                    <span>{item.reason}</span>
                  </div>
                )}
                <dl className="fieldmap">
                  {FIELDS.filter((f) => hasValue(bill, f.key)).map((f) => (
                    <div className="fieldmap__row" key={String(f.key)}>
                      <dt className="fieldmap__key">{f.label}</dt>
                      <dd className="fieldmap__val">{displayValue(bill[f.key])}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>

        <div className="modal__foot">
          {status === 'failed' && (
            <button type="button" className="btn" onClick={onRetry}>
              Retry
            </button>
          )}
          <span className="app__spacer" />
          {(status === 'done' || status === 'attention') && (
            <button type="button" className="btn btn--primary" onClick={onReview}>
              Open in Review
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
