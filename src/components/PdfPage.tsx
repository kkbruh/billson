import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite serves the worker as a real asset; point pdf.js at it once.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  scale: number;
  /** 1-based page to render. */
  page?: number;
  onPageCount?: (count: number) => void;
}

/**
 * Renders one PDF page onto a canvas.
 *
 * The browser's own `<embed>`/`<object>` PDF viewer brings its own toolbar and a
 * dark backdrop, which fights the DSM chrome this screen specifies. Rendering the
 * page ourselves gives a clean white page inside our own frame, and lets the zoom
 * controls in the action bar drive the actual render scale.
 */
export function PdfPage({ url, scale, page = 1, onPageCount }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjs.PDFDocumentProxy | null = null;
    let task: ReturnType<pdfjs.PDFPageProxy['render']> | null = null;

    setError(null);

    (async () => {
      try {
        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        onPageCount?.(doc.numPages);

        const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Render at device resolution so text stays crisp when zoomed.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
        await task.promise;
      } catch (err) {
        // A cancelled render rejects too; only surface a real failure.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render this PDF.');
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      void doc?.destroy();
    };
  }, [url, scale, page, onPageCount]);

  if (error) {
    return <div className="viewer__text">Could not render this document. {error}</div>;
  }

  return <canvas ref={canvasRef} className="viewer__canvas" />;
}
