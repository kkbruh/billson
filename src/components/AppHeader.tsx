import appIcon from '../assets/icons/app-icon.svg';
import navStats from '../assets/icons/nav-stats.svg';
import navInbox from '../assets/icons/nav-inbox-list.svg';
import navReview from '../assets/icons/nav-review.svg';
import bellIcon from '../assets/icons/notification.svg';
import type { CurrentUser } from '../lib/api';

export type Screen = 'stats' | 'inbox' | 'review';

export type SyncState = 'live' | 'checking' | 'error' | 'off';

/**
 * Vite inlines small SVGs as `data:` URIs whose raw form is invalid inside a CSS
 * `url()`. Quoting it is what makes the mask apply at all — without the quotes
 * the declaration is dropped and the element renders as a solid block.
 */
function maskStyle(icon: string) {
  return {
    maskImage: `url("${icon}")`,
    WebkitMaskImage: `url("${icon}")`,
  };
}

interface Props {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  /** Unread counts rendered as a badge on the tab, per the design's badge slot. */
  badges?: Partial<Record<Screen, number>>;
  syncState: SyncState;
  syncLabel: string;
  notificationCount: number;
  onNotifications: () => void;
  user: CurrentUser | null;
  onProfile: () => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
}

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: 'stats', label: 'Stats', icon: navStats },
  { key: 'inbox', label: 'Inbox', icon: navInbox },
  { key: 'review', label: 'Review', icon: navReview },
];

const SYNC_DOT: Record<SyncState, string> = {
  live: 'fds-dot--success',
  checking: 'fds-dot--info',
  error: 'fds-dot--error',
  off: 'fds-dot--neutral',
};

const SYNC_CHIP: Record<SyncState, string> = {
  live: 'chip--green',
  checking: 'chip--neutral',
  error: 'chip--red',
  off: 'chip--neutral',
};

/**
 * Initials from the signed-in user. The Figma avatar is a stock placeholder
 * image; real initials beat shipping someone else's photo.
 */
function initials(user: Props['user']): string {
  const source = user?.name || user?.email || '';
  const local = source.split('@')[0];
  const parts = local.split(/[.\-_+\s]+/).filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AppHeader({
  screen,
  onScreen,
  badges,
  syncState,
  syncLabel,
  notificationCount,
  onNotifications,
  user,
  onProfile,
  theme,
  onTheme,
}: Props) {
  return (
    <header className="navbar fds-frost-low">
      {/* left zone — app icon + wordmark */}
      <div className="navbar__zone navbar__zone--start">
        <img className="navbar__app-icon" src={appIcon} alt="" width={20} height={20} />
        <span className="navbar__wordmark">Billson</span>
      </div>

      {/* centre zone — segmented navigation */}
      <div className="navbar__zone navbar__zone--center">
        <nav className="segmented" role="tablist" aria-label="Main navigation">
          {NAV.map((item) => {
            const active = screen === item.key;
            const badge = badges?.[item.key] ?? 0;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`segmented__item${active ? ' segmented__item--active' : ''}`}
                onClick={() => onScreen(item.key)}
              >
                <span
                  className="segmented__icon"
                  style={maskStyle(item.icon)}
                  aria-hidden="true"
                />
                {item.label}
                {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* right zone — sync chip · divider · notifications · avatar */}
      <div className="navbar__zone navbar__zone--end">
        <span className={`chip ${SYNC_CHIP[syncState]}`} title={syncLabel}>
          <span className={`fds-dot ${SYNC_DOT[syncState]}`} />
          {syncLabel}
        </span>

        <span className="navbar__divider" role="separator" />

        <button
          type="button"
          className="icon-btn"
          onClick={onTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

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
          <span className="icon-btn__glyph" style={maskStyle(bellIcon)} aria-hidden="true" />
          {notificationCount > 0 && <span className="icon-btn__dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="avatar"
          onClick={onProfile}
          aria-label={user?.email ? `Account: ${user.email}` : 'Account'}
          title={user?.email ?? 'Account'}
        >
          {initials(user)}
        </button>
      </div>
    </header>
  );
}
