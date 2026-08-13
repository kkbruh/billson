import { useCallback, useEffect, useState } from 'react';
import { PdfPage } from './PdfPage';

interface Props {
  /** Object URL for the document, or null when there's nothing to show. */
  url: string | null;
  type: string | null;
  name: string;
  /** Runs the AI scan pass over the page while the bill is being read. */
  scanning?: boolean;
}

const STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/**
 * Document preview with DSM chrome — the header, zoom controls and page frame are
 * ours; PDFs are rendered to a canvas by pdf.js.
 *
 * Two viewers were ruled out on the way here:
 *  - Google's `docs.google.com/gview` only renders a document Google's servers
 *    can fetch. These files live in the app's private file store (and locally as
 *    `blob:` URLs), so Google can't reach them and the frame comes back empty.
 *  - The browser's built-in `<object>` viewer works, but ships its own toolbar and
 *    a dark backdrop that fights this design.
 * Rendering the page ourselves is what makes the zoom buttons real and keeps the
 * page clean inside our frame.
 */
export function DocViewer({ url, type, name, scanning }: Props) {
  const [scaleIndex, setScaleIndex] = useState(3); // 1.0
  const scale = STEPS[scaleIndex];

  const [text, setText] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const isText = (type ?? '').startsWith('text/') || /\.txt$/i.test(name);
  const isImage = (type ?? '').startsWith('image/');
  const isPdf = (type ?? '').includes('pdf') || /\.pdf$/i.test(name);

  const onPageCount = useCallback((n: number) => setPages(n), []);

  useEffect(() => {
    setText(null);
    if (!url || !isText) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t.slice(0, 40000));
      })
      .catch(() => {
        /* fall through to the embed path */
      });
    return () => {
      cancelled = true;
    };
  }, [url, isText]);

  return (
    <section className="viewer">
      <div className="viewer__bar">
        <span className="viewer__title">
          {name}
          {isPdf && pages > 1 ? ` · ${pages} pages` : ''}
        </span>
        <div className="viewer__zoom">
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom out"
            disabled={scaleIndex === 0}
            onClick={() => setScaleIndex((i) => Math.max(0, i - 1))}
          >
            −
          </button>
          <span className="viewer__scale">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom in"
            disabled={scaleIndex === STEPS.length - 1}
            onClick={() => setScaleIndex((i) => Math.min(STEPS.length - 1, i + 1))}
          >
            +
          </button>
        </div>
      </div>

      <div className="viewer__body">
        {!url ? (
          <div className="empty">
            <div className="empty__text">No document to preview.</div>
          </div>
        ) : (
          <div className="viewer__page">
            {text !== null ? (
              <pre className="viewer__text" style={{ zoom: scale }}>
                {text}
              </pre>
            ) : isPdf ? (
              <PdfPage url={url} scale={scale} onPageCount={onPageCount} />
            ) : isImage ? (
              <img
                className="viewer__img"
                src={url}
                alt={name}
                style={{ width: 612 * scale }}
              />
            ) : (
              <div className="viewer__text">No inline preview for this file type.</div>
            )}
          </div>
        )}

        {scanning && <div className="viewer__scan" aria-hidden="true" />}
      </div>
    </section>
  );
}
