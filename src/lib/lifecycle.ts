/**
 * The bill lifecycle from the UI spec (section 02). One bill, one status chip,
 * rendered identically in the Parse queue, the Inbox and the Stats funnel.
 */
export type LifecycleState =
  | 'fetched'
  | 'validated'
  | 'invalid'
  | 'awaiting_review'
  | 'parsing'
  | 'needs_attention'
  | 'parsed_mapped'
  | 'rejected';

export interface LifecycleMeta {
  label: string;
  /** Status dot class — colour carries meaning, kept to a dot per FDS. */
  dot: string;
  meaning: string;
}

export const LIFECYCLE: Record<LifecycleState, LifecycleMeta> = {
  fetched: {
    label: 'Fetched',
    dot: 'fds-dot--neutral',
    meaning: 'Pulled from a source, or manually uploaded.',
  },
  validated: {
    label: 'Validated',
    dot: 'fds-dot--info',
    meaning: 'Passed file checks — format, readability, duplicate, is-a-bill.',
  },
  invalid: {
    label: 'Invalid',
    dot: 'fds-dot--error',
    meaning: 'Failed file checks. Cannot be approved until resolved or overridden.',
  },
  awaiting_review: {
    label: 'Awaiting review',
    dot: 'fds-dot--warning',
    meaning: 'Valid and staged, waiting on you — this is the review gate.',
  },
  parsing: {
    label: 'Parsing',
    dot: 'fds-dot--info',
    meaning: 'Approved; extraction running.',
  },
  needs_attention: {
    label: 'Needs attention',
    dot: 'fds-dot--warning',
    meaning: 'Parsed with low-confidence fields or an unknown template.',
  },
  parsed_mapped: {
    label: 'Parsed & mapped',
    dot: 'fds-dot--success',
    meaning: 'All fields confident; values mapped to Facilio fields.',
  },
  rejected: {
    label: 'Rejected',
    dot: 'fds-dot--error',
    meaning: 'Rejected at the gate or discarded after review.',
  },
};

/**
 * Position of one bill inside a parse run. The queue drains one at a time, so
 * exactly one item is `in_progress`.
 */
export type QueueState = 'queued' | 'in_progress' | 'done' | 'failed';

export const QUEUE_META: Record<QueueState, { label: string; dot: string; glyph: string }> = {
  queued: { label: 'In queue', dot: 'fds-dot--neutral', glyph: '○' },
  in_progress: { label: 'In progress', dot: 'fds-dot--info', glyph: '◐' },
  done: { label: 'Parsed', dot: 'fds-dot--success', glyph: '●' },
  failed: { label: 'Failed', dot: 'fds-dot--error', glyph: '✕' },
};

/** Where a staged file came from. Manual is the only one that needs no connection. */
export type SourceKind = 'manual' | 'drive' | 'sharepoint' | 'mail';

export const SOURCE_LABEL: Record<SourceKind, string> = {
  manual: 'Manual',
  drive: 'Google Drive',
  sharepoint: 'SharePoint',
  mail: 'Mail rule',
};

/** Extraction settings — the three-level cascade is global → client → per bill. */
export type TextLayerMode = 'ocr_fallback' | 'ocr_every_page' | 'text_only';
export type AccuracyMode = 'single_fast' | 'consensus';

export const TEXT_LAYER_LABEL: Record<TextLayerMode, string> = {
  ocr_fallback: 'OCR fallback (auto)',
  ocr_every_page: 'OCR every page',
  text_only: 'Text only',
};

export const ACCURACY_LABEL: Record<AccuracyMode, string> = {
  single_fast: 'Single model (fast)',
  consensus: 'Consensus (~4× cost)',
};

export interface ExtractionOptions {
  textLayer: TextLayerMode;
  accuracy: AccuracyMode;
}

export const DEFAULT_EXTRACTION: ExtractionOptions = {
  textLayer: 'ocr_fallback',
  accuracy: 'single_fast',
};

/**
 * Confidence drives routing: a low-confidence parse lands in "needs attention"
 * rather than going straight through.
 */
export function stateFromConfidence(
  confidence: string | null,
): Extract<LifecycleState, 'parsed_mapped' | 'needs_attention'> {
  return confidence === 'low' || confidence === 'medium'
    ? 'needs_attention'
    : 'parsed_mapped';
}
