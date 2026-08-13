import iconDone from '../assets/icons/status-done.svg';
import iconWarning from '../assets/icons/status-warning.svg';
import iconFailed from '../assets/icons/status-failed.svg';
import iconQueued from '../assets/icons/status-queued.svg';
import iconProgress from '../assets/icons/status-progress.svg';

/** The states a file can be in during a parse run. */
export type FileStatus =
  | 'queued'
  | 'parsing'
  | 'done'
  | 'attention'
  | 'failed';

const ICONS: Record<FileStatus, string> = {
  queued: iconQueued,
  parsing: iconProgress,
  done: iconDone,
  attention: iconWarning,
  failed: iconFailed,
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  queued: 'In queue',
  parsing: 'In progress',
  done: 'Completed',
  attention: 'Needs attention',
  failed: 'Failed',
};

const MODIFIER: Record<FileStatus, string> = {
  queued: 'queued',
  parsing: 'progress',
  done: 'done',
  attention: 'warning',
  failed: 'failed',
};

/**
 * The exported FDS status glyph, masked so it inherits a themed token colour
 * instead of the hex baked into the Figma export.
 */
export function StatusIcon({ status }: { status: FileStatus }) {
  const icon = ICONS[status];
  return (
    <span
      className={`sicon sicon--${MODIFIER[status]}`}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }}
    />
  );
}
