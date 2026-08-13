import { icons } from '../lib/icons';
import type { CurrentUser } from '../lib/api';
import type { SyncState } from './AppHeader';

function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}

/** Initials from the signed-in user — no stock avatar image. */
function initials(user: CurrentUser | null): string {
  const source = user?.name || user?.email || '';
  const local = source.split('@')[0];
  const parts = local.split(/[.\-_+\s]+/).filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface Props {
  title: string;
  /** When provided, the search box renders and is wired to the active page. */
  search?: string;
  onSearch?: (term: string) => void;
  searchPlaceholder?: string;
  syncState: SyncState;
  syncLabel: string;
  notificationCount: number;
  onNotifications: () => void;
  user: CurrentUser | null;
  onProfile: () => void;
}

export function Topbar({
  title,
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  syncState,
  syncLabel,
  notificationCount,
  onNotifications,
  user,
  onProfile,
}: Props) {
  const displayName = user?.name || user?.email?.split('@')[0] || 'Account';

  return (
    <header className="bi-topbar">
      <span className="bi-topbar__title">{title}</span>

      {onSearch && (
        <div className="bi-search">
          <span className="bi-search__icon" style={mask(icons.search)} aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={search ?? ''}
            placeholder={searchPlaceholder}
            onChange={(e) => onSearch(e.target.value)}
            aria-label={searchPlaceholder}
          />
        </div>
      )}

      <div className="bi-topbar__end">
        <span
          className={`bi-sync${syncState === 'live' ? ' bi-sync--live' : ''}`}
          title={syncLabel}
        >
          <span
            className={`fds-dot ${
              syncState === 'live'
                ? 'fds-dot--success'
                : syncState === 'error'
                  ? 'fds-dot--error'
                  : syncState === 'checking'
                    ? 'fds-dot--info'
                    : 'fds-dot--neutral'
            }`}
          />
          {syncLabel}
        </span>

        <button
          type="button"
          className="icon-btn"
          onClick={onNotifications}
          aria-label={
            notificationCount > 0
              ? `Notifications, ${notificationCount} unread`
              : 'Notifications'
          }
        >
          <span className="icon-btn__glyph" style={mask(icons.bell)} aria-hidden="true" />
          {notificationCount > 0 && <span className="icon-btn__dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="bi-user"
          onClick={onProfile}
          title={user?.email ?? 'Account'}
        >
          <span className="bi-user__avatar">{initials(user)}</span>
          <span>{displayName}</span>
        </button>
      </div>
    </header>
  );
}
