import { icons, type IconName } from '../lib/icons';

/** Every destination in the rail. Only some are backed by a built screen yet. */
export type NavKey =
  | 'dashboard'
  | 'inbox'
  | 'review'
  | 'cmms'
  | 'templates'
  | 'clients'
  | 'sources'
  | 'reports'
  | 'settings';

interface NavDef {
  key: NavKey;
  label: string;
  icon: IconName;
}

/** Primary nav, top group. `settings` lives in the footer, so it's not here. */
export const NAV: NavDef[] = [
  { key: 'dashboard', label: 'Home/Dashboard', icon: 'dashboard' },
  // Pipeline order: bills land in the CMMS module → pulled into the Inbox to
  // parse → routed to the Review Queue. (Reports live inside the Dashboard;
  // Templates + Sources & Integrations live under Settings.)
  { key: 'cmms', label: 'CMMS Bills', icon: 'cmms' },
  { key: 'inbox', label: 'Bills Inbox', icon: 'inbox' },
  { key: 'review', label: 'Review Queue', icon: 'review' },
  { key: 'clients', label: 'Clients & Providers', icon: 'clients' },
];

/** Labels used elsewhere (topbar title) so the two never drift. */
export const NAV_TITLE: Record<NavKey, string> = {
  dashboard: 'Home',
  inbox: 'Bills Inbox',
  review: 'Review Queue',
  cmms: 'Facilio Bills (CMMS)',
  templates: 'Templates',
  clients: 'Clients & Providers',
  sources: 'Sources & Integrations',
  reports: 'Reports',
  settings: 'Settings',
};

function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}

interface Props {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  /** Per-item counts rendered as a pill on the right of the row. */
  badges?: Partial<Record<NavKey, number>>;
  theme: 'light' | 'dark';
  onTheme: () => void;
}

export function Sidebar({ active, onNavigate, badges, theme, onTheme }: Props) {
  return (
    <aside className="bi-sidebar">
      <div className="bi-brand">
        <span className="bi-brand__mark">F</span>
        <span className="bi-brand__name">
          <span className="bi-brand__title">Facilio</span>
          <span className="bi-brand__sub">Bill Intelligence</span>
        </span>
      </div>

      <nav className="bi-nav" aria-label="Primary">
        {NAV.map((item) => {
          const count = badges?.[item.key] ?? 0;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`bi-nav__item${isActive ? ' bi-nav__item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <span className="bi-nav__icon" style={mask(icons[item.icon])} aria-hidden="true" />
              <span className="bi-nav__label">{item.label}</span>
              {count > 0 && (
                <span className="bi-nav__badge">{count > 99 ? '99+' : count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <span className="bi-sidebar__spacer" />

      <div className="bi-sidebar__foot">
        <button
          type="button"
          className={`bi-nav__item${active === 'settings' ? ' bi-nav__item--active' : ''}`}
          aria-current={active === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <span className="bi-nav__icon" style={mask(icons.settings)} aria-hidden="true" />
          <span className="bi-nav__label">Settings</span>
        </button>
        <button
          type="button"
          className="bi-rail-btn"
          onClick={onTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </aside>
  );
}
