import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ACCURACY_LABEL,
  LIFECYCLE,
  SOURCE_LABEL,
  TEXT_LAYER_LABEL,
  stateFromConfidence,
  type AccuracyMode,
  type ExtractionOptions,
  type LifecycleState,
  type SourceKind,
  type TextLayerMode,
} from '../lib/lifecycle';
import type { AppSettings } from '../lib/settings';
import { ExtractionUnavailableError, errorMessage, parseBillFile, saveBill } from '../lib/api';
import type { ExtractedBill } from '../types';

/** One file staged at the review gate. */
export interface StagedFile {
  key: string;
  file: File;
  name: string;
  sizeBytes: number;
  source: SourceKind;
  fetchedAt: number;
  state: LifecycleState;
  /** Why validation failed, or why the bill was rejected. */
  reason: string | null;
  options: ExtractionOptions;
  /** Populated once parsing completes. */
  parsed: ExtractedBill | null;
  fileId: number | null;
  savedId: string | null;
  progress: number;
}

interface Props {
  settings: AppSettings;
  onSettings: (settings: AppSettings) => void;
  onParsed: () => void;
  onGoToInbox: () => void;
  reviewer: string | null;
  /**
   * The queue is owned by the app shell, not this screen — a half-reviewed batch
   * must survive switching to Stats or Inbox and back.
   */
  staged: StagedFile[];
  setStaged: Dispatch<SetStateAction<StagedFile[]>>;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.txt';
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|heic|tiff?|txt)$/i;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relative(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

/**
 * File checks that can honestly be done in the browser: extension, size, and
 * exact-duplicate detection against what's already staged. "Is a bill" and
 * password-protection are only knowable once the extractor reads it, so those
 * surface after parsing rather than being faked here.
 */
function validate(
  file: File,
  staged: StagedFile[],
): { state: LifecycleState; reason: string | null } {
  if (!ALLOWED_EXT.test(file.name)) {
    return { state: 'invalid', reason: 'Unsupported file type — PDF or image only.' };
  }
  if (file.size === 0) {
    return { state: 'invalid', reason: 'File is empty.' };
  }
  if (file.size > MAX_BYTES) {
    return {
      state: 'invalid',
      reason: `${humanSize(file.size)} exceeds the 20 MB limit.`,
    };
  }
  const dupe = staged.find(
    (s) => s.name === file.name && s.sizeBytes === file.size && s.state !== 'rejected',
  );
  if (dupe) {
    return { state: 'invalid', reason: 'Duplicate — same name and size already staged.' };
  }
  return { state: 'awaiting_review', reason: null };
}

export function ParseScreen({
  settings,
  onSettings,
  onParsed,
  onGoToInbox,
  reviewer,
  staged,
  setStaged,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractionOffline, setExtractionOffline] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = (key: string, update: Partial<StagedFile>) =>
    setStaged((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));

  const add = (files: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(files);
    setStaged((rows) => {
      const next = [...rows];
      for (const file of incoming) {
        const { state, reason } = validate(file, next);
        next.push({
          key: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          name: file.name,
          sizeBytes: file.size,
          source: 'manual',
          fetchedAt: Date.now(),
          state,
          reason,
          options: { ...settings.extraction },
          parsed: null,
          fileId: null,
          savedId: null,
          progress: 0,
        });
      }
      return next;
    });
  };

  /** Approve one staged file: extract, then write it into the register. */
  const runParse = async (row: StagedFile) => {
    patch(row.key, { state: 'parsing', progress: 15, reason: null });

    try {
      const { bill, fileId } = await parseBillFile(row.file);
      patch(row.key, { progress: 70, parsed: bill, fileId });

      const nextState = stateFromConfidence(bill.confidence);
      const saved = await saveBill(
        {
          ...bill,
          status: nextState === 'parsed_mapped' ? 'confirmed' : 'flagged',
          file_id: String(fileId),
          file_name: row.name,
          reviewed_by: reviewer,
        },
        null,
      );

      patch(row.key, {
        state: nextState,
        progress: 100,
        savedId: saved.id,
        reason:
          nextState === 'needs_attention'
            ? bill.notes ?? 'Low confidence on one or more fields — review in Inbox.'
            : null,
      });
      onParsed();
    } catch (err) {
      if (err instanceof ExtractionUnavailableError) {
        setExtractionOffline(true);
        patch(row.key, {
          state: 'invalid',
          progress: 0,
          reason: 'Automatic extraction is unavailable — enter this bill by hand in Inbox.',
        });
      } else {
        patch(row.key, { state: 'invalid', progress: 0, reason: errorMessage(err) });
      }
    }
  };

  const approveAll = async () => {
    const ready = staged.filter((r) => r.state === 'awaiting_review');
    // Serial, not parallel: each parse is a model call, and the platform
    // serializes them anyway — firing them together just risks rate limits.
    for (const row of ready) {
      await runParse(row);
    }
  };

  const reject = (row: StagedFile) => {
    const reason = window.prompt(`Why are you rejecting ${row.name}?`, 'Not a bill');
    if (reason === null) return;
    patch(row.key, {
      state: 'rejected',
      reason: reason.trim() === '' ? 'No reason given' : reason.trim(),
    });
  };

  const revalidate = (row: StagedFile) => {
    const others = staged.filter((r) => r.key !== row.key);
    const { state, reason } = validate(row.file, others);
    patch(row.key, { state, reason, progress: 0 });
  };

  const remove = (key: string) => setStaged((rows) => rows.filter((r) => r.key !== key));
  const clearDone = () =>
    setStaged((rows) =>
      rows.filter(
        (r) => r.state !== 'parsed_mapped' && r.state !== 'needs_attention' && r.state !== 'rejected',
      ),
    );

  const counts = useMemo(() => {
    const c = { awaiting: 0, invalid: 0, parsing: 0, done: 0, rejected: 0 };
    for (const r of staged) {
      if (r.state === 'awaiting_review') c.awaiting += 1;
      else if (r.state === 'invalid') c.invalid += 1;
      else if (r.state === 'parsing') c.parsing += 1;
      else if (r.state === 'rejected') c.rejected += 1;
      else if (r.state === 'parsed_mapped' || r.state === 'needs_attention') c.done += 1;
    }
    return c;
  }, [staged]);

  const busy = counts.parsing > 0;

  return (
    <>
      {/* ── sources & auto-parse ─────────────────────────────────────────── */}
      <div className="fds-widget">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Sources</span>
          <span className="fds-widget__range">Where bills arrive from</span>
        </div>
        <div className="fds-widget__body">
          <div className="sources">
            <span className="source-card">
              <span className="fds-dot fds-dot--success" />
              Manual upload · ready
            </span>
            <span className="source-card">
              <span className="fds-dot fds-dot--neutral" />
              Google Drive · not connected
            </span>
            <span className="source-card">
              <span className="fds-dot fds-dot--neutral" />
              SharePoint · not connected
            </span>
            <span className="source-card">
              <span className="fds-dot fds-dot--neutral" />
              Mail rule · not configured
            </span>
          </div>

          <div className="notice" style={{ marginTop: 'var(--spacing-sectionXSmall)' }}>
            <span>
              Only manual upload is live. Fetch-on-open from Drive, SharePoint and mail
              rules needs those connections authorised in Facilio first — until then
              nothing is fetched automatically, so this screen never shows bills you
              didn&apos;t upload.
            </span>
          </div>

          <div className="band">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.autoParse}
                onChange={(e) =>
                  onSettings({ ...settings, autoParse: e.target.checked })
                }
              />
              <span className="toggle__track">
                <span className="toggle__thumb" />
              </span>
              Auto-parse bills fetched from a source
            </label>
            <span className="muted">
              {settings.autoParse
                ? 'Fetched bills will skip the review gate and parse on arrival. Manual uploads still wait for your approval.'
                : 'Every bill waits for your approval before it is parsed.'}
            </span>
          </div>

          <div className="divider" />

          <div className="fds-section-head">
            <span className="fds-section-head__label">Extraction defaults</span>
            <span className="fds-section-head__rule" />
          </div>

          <div className="queue-opts">
            <label className="field">
              <span className="field__label">If no text layer</span>
              <select
                className="select-sm"
                value={settings.extraction.textLayer}
                onChange={(e) =>
                  onSettings({
                    ...settings,
                    extraction: {
                      ...settings.extraction,
                      textLayer: e.target.value as TextLayerMode,
                    },
                  })
                }
              >
                {Object.entries(TEXT_LAYER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Accuracy</span>
              <select
                className="select-sm"
                value={settings.extraction.accuracy}
                onChange={(e) =>
                  onSettings({
                    ...settings,
                    extraction: {
                      ...settings.extraction,
                      accuracy: e.target.value as AccuracyMode,
                    },
                  })
                }
              >
                {Object.entries(ACCURACY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="muted" style={{ marginBottom: 0 }}>
            These are the defaults every new upload inherits; override them per bill in
            the queue below. Consensus mode is recorded against the bill but currently
            runs a single model — a second model isn&apos;t configured in this org yet.
          </p>
        </div>
      </div>

      {/* ── uploader ─────────────────────────────────────────────────────── */}
      <div className="fds-widget">
        <div className="fds-widget__header">
          <span className="fds-widget__title">Upload bills</span>
          <span className="fds-widget__range">PDF or photo · up to 20 MB each</span>
        </div>
        <div className="fds-widget__body">
          <div
            className={`uploader${dragOver ? ' uploader--over' : ''}`}
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
            <span className="uploader__lead">Drag and Drop here</span>
            <span className="uploader__or">or</span>
            <span className="btn">Upload</span>
            <span className="uploader__hint">
              Files are stored in this app and sent to an AI model to be read. Nothing is
              parsed until you approve it.
            </span>
          </div>

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

          {error && (
            <div className="notice notice--error" style={{ marginTop: 'var(--spacing-sectionXSmall)' }} role="alert">
              <span>{error}</span>
            </div>
          )}

          {extractionOffline && (
            <div className="notice notice--warning" style={{ marginTop: 'var(--spacing-sectionXSmall)' }}>
              <span>
                Automatic extraction is unavailable in this org. Uploads still save, but
                the fields must be filled in by hand from the Inbox.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── review gate queue ────────────────────────────────────────────── */}
      <div className="fds-widget">
        <div className="fds-widget__header">
          <span className="fds-widget__title">
            Review gate{counts.awaiting > 0 ? ` · ${counts.awaiting} awaiting` : ''}
          </span>
          <span className="fds-widget__range">
            {staged.length === 0
              ? 'Nothing staged'
              : `${staged.length} file${staged.length === 1 ? '' : 's'} staged`}
          </span>
        </div>

        <div className="fds-widget__body">
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={counts.awaiting === 0 || busy}
              onClick={() => void approveAll()}
            >
              {busy && <span className="btn__spinner" aria-hidden="true" />}
              Approve &amp; parse {counts.awaiting > 0 ? `(${counts.awaiting})` : ''}
            </button>
            <button
              type="button"
              className="btn"
              disabled={counts.done === 0}
              onClick={onGoToInbox}
            >
              View {counts.done > 0 ? counts.done : ''} in Inbox
            </button>
            <span className="app__spacer" />
            <button
              type="button"
              className="btn btn--ghost"
              disabled={counts.done + counts.rejected === 0}
              onClick={clearDone}
            >
              Clear finished
            </button>
          </div>

          {counts.invalid > 0 && (
            <div className="notice notice--warning" style={{ marginTop: 'var(--spacing-sectionXSmall)' }}>
              <span>
                {counts.invalid} file{counts.invalid === 1 ? '' : 's'} failed validation —
                the reason is shown inline. Fix and re-validate, or reject.
              </span>
            </div>
          )}
        </div>

        {staged.length === 0 ? (
          <div className="fds-widget__footer" style={{ display: 'block' }}>
            <div className="empty">
              <div className="empty__text">
                Drop a bill above to stage it. Nothing parses without your approval.
              </div>
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="fds-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>File</th>
                  <th>Source</th>
                  <th>Staged</th>
                  <th>Parse options</th>
                  <th>Result</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {staged.map((row) => {
                  const meta = LIFECYCLE[row.state];
                  const editable = row.state === 'awaiting_review';
                  return (
                    <tr key={row.key}>
                      <td>
                        <span className="status" title={meta.meaning}>
                          <span className={`fds-dot ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {row.state === 'parsing' && (
                          <div className="progress" style={{ marginTop: 6 }}>
                            <div className="progress__bar" style={{ width: `${row.progress}%` }} />
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="queue-name">
                          <span>{row.name}</span>
                          <span className="meta">{humanSize(row.sizeBytes)}</span>
                        </div>
                      </td>

                      <td className="meta">{SOURCE_LABEL[row.source]}</td>
                      <td className="meta">{relative(row.fetchedAt)}</td>

                      <td>
                        {editable ? (
                          <div className="queue-opts">
                            <select
                              className="select-sm"
                              aria-label={`Text layer handling for ${row.name}`}
                              value={row.options.textLayer}
                              onChange={(e) =>
                                patch(row.key, {
                                  options: {
                                    ...row.options,
                                    textLayer: e.target.value as TextLayerMode,
                                  },
                                })
                              }
                            >
                              {Object.entries(TEXT_LAYER_LABEL).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <select
                              className="select-sm"
                              aria-label={`Accuracy for ${row.name}`}
                              value={row.options.accuracy}
                              onChange={(e) =>
                                patch(row.key, {
                                  options: {
                                    ...row.options,
                                    accuracy: e.target.value as AccuracyMode,
                                  },
                                })
                              }
                            >
                              {Object.entries(ACCURACY_LABEL).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span className="meta">
                            {TEXT_LAYER_LABEL[row.options.textLayer]} ·{' '}
                            {ACCURACY_LABEL[row.options.accuracy]}
                          </span>
                        )}
                      </td>

                      <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                        {row.parsed ? (
                          <>
                            <div>
                              {row.parsed.vendor_name ?? 'Unnamed vendor'}
                              {row.parsed.total_amount !== null && (
                                <>
                                  {' · '}
                                  <span className="mono">
                                    {row.parsed.currency ? `${row.parsed.currency} ` : ''}
                                    {row.parsed.total_amount.toFixed(2)}
                                  </span>
                                </>
                              )}
                            </div>
                            {row.reason && <div className="meta">{row.reason}</div>}
                          </>
                        ) : row.reason ? (
                          <span className="meta">{row.reason}</span>
                        ) : (
                          <span className="meta">—</span>
                        )}
                      </td>

                      <td>
                        <div className="row" style={{ gap: 'var(--spacing-containerMedium)' }}>
                          {row.state === 'awaiting_review' && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              disabled={busy}
                              onClick={() => void runParse(row)}
                            >
                              Approve
                            </button>
                          )}
                          {row.state === 'invalid' && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => revalidate(row)}
                            >
                              Re-validate
                            </button>
                          )}
                          {(row.state === 'awaiting_review' || row.state === 'invalid') && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--danger"
                              onClick={() => reject(row)}
                            >
                              Reject
                            </button>
                          )}
                          {(row.state === 'parsed_mapped' ||
                            row.state === 'needs_attention' ||
                            row.state === 'rejected') && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => remove(row.key)}
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
