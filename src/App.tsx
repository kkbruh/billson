import { useCallback, useEffect, useMemo, useState } from 'react';
import { vibe } from './vibe';
import {
  BILLS_TOPIC,
  deleteBill,
  errorMessage,
  fetchCurrentUser,
  getStats,
  listBills,
  saveBill,
  type BillStats,
  type CurrentUser,
} from './lib/api';
import { downloadCsv } from './lib/csv';
import type { ExtractedBill, Provenance, SavedBill } from './types';
import { AppHeader, type Screen, type SyncState } from './components/AppHeader';
import { InboxScreen, type InboxItem } from './components/InboxScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { StatsScreen } from './components/StatsScreen';
import { IntegrationsScreen } from './components/IntegrationsScreen';

type Theme = 'light' | 'dark';

/**
 * The 24×24 grid every screen sits on. The shimmer layers are the same strokes at
 * a higher opacity, revealed through a drifting mask, so the lines themselves
 * brighten rather than a coloured wash moving behind them. Decorative only.
 */
function PageGrid() {
  return (
    <div className="app-grid" aria-hidden="true">
      <div className="app-grid__lines" />
      <div className="app-grid__shimmer app-grid__shimmer--a" />
      <div className="app-grid__shimmer app-grid__shimmer--b" />
      <div className="app-grid__shimmer app-grid__shimmer--c" />
    </div>
  );
}

function initialTheme(): Theme {
  const stored = localStorage.getItem('billparser.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [screen, setScreen] = useState<Screen>('inbox');

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [bills, setBills] = useState<SavedBill[]>([]);
  const [stats, setStats] = useState<BillStats | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [syncState, setSyncState] = useState<SyncState>('checking');
  const [toast, setToast] = useState<string | null>(null);

  // Owned here so the Inbox survives navigating between screens mid-run.
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);

  // Session-scoped per-field evidence, keyed by saved bill id. Not persisted —
  // provenance has no database column, so Review shows it only for bills parsed
  // in this session and says so plainly for the rest.
  const [provenanceById, setProvenanceById] = useState<Record<string, Provenance[]>>({});

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('billparser.theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    // Local dev has no Facilio session (the SDK reads a same-origin cookie), so
    // the gate would block every UI change. Stub a user in dev only — this branch
    // is dead code in a production build.
    if (import.meta.env.DEV) {
      setUser({ uid: 0, email: 'dev@localhost', name: 'Dev User', orgId: null });
      setAuthChecked(true);
      return;
    }

    fetchCurrentUser()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (term: string) => {
    setLoading(true);
    setListError(null);
    try {
      const [list, s] = await Promise.all([listBills(term), getStats()]);
      setBills(list.bills);
      setStats(s);
      setSyncState('live');
    } catch (err) {
      // Local dev has no backend, so a failure there is expected, not an error
      // worth shouting about on screen.
      if (import.meta.env.DEV) {
        setSyncState('off');
      } else {
        setListError(errorMessage(err));
        setSyncState('error');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search. This also covers the initial load (search starts empty),
  // so there is no separate mount fetch — that would double every round trip.
  useEffect(() => {
    const t = setTimeout(() => void refresh(search), search === '' ? 0 : 250);
    return () => clearTimeout(t);
  }, [search, refresh]);

  // Realtime: save/delete publish to `bills`, so other open tabs stay in sync.
  useEffect(() => {
    const sub = vibe.subscribe(BILLS_TOPIC, () => void refresh(search));
    return () => sub.unsubscribe();
  }, [refresh, search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSave = async (bill: ExtractedBill, id: string) => {
    try {
      await saveBill({ ...bill, reviewed_by: user?.email ?? null }, id);
      await refresh(search);
      setToast('Changes saved.');
    } catch (err) {
      setListError(errorMessage(err));
    }
  };

  const handleDelete = async (bill: SavedBill) => {
    const label = bill.vendor_name ?? 'this bill';
    if (
      !window.confirm(
        `Remove ${label}? It stays in the audit trail but disappears from Review.`,
      )
    ) {
      return;
    }
    setBusyId(bill.id);
    try {
      await deleteBill(bill.id);
      await refresh(search);
      setToast('Bill removed.');
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const badges = useMemo(
    () => ({
      // Inbox badge = bills waiting to be parsed (or needing a retry).
      inbox: inboxItems.filter((i) => i.status === null || i.status === 'failed').length,
      // Review badge = the "what needs me" signal from saved bills.
      review: (stats?.awaiting_review ?? 0) + (stats?.flagged ?? 0),
    }),
    [stats, inboxItems],
  );

  const syncLabel =
    syncState === 'live'
      ? 'Sync: Live'
      : syncState === 'checking'
        ? 'Checking…'
        : syncState === 'error'
          ? 'Sync: Error'
          : 'Sync: Off';

  const notificationCount = stats?.flagged ?? 0;

  if (authChecked && !user) {
    return (
      <div className="app">
        <PageGrid />
        <main className="app__main">
          <div className="fds-widget">
            <div className="fds-widget__header">
              <span className="fds-widget__title">Billson</span>
            </div>
            <div className="fds-widget__body">
              <div className="empty">
                <div className="empty__text">Sign in to read and save bills.</div>
                <button type="button" className="btn btn--primary" onClick={() => vibe.login()}>
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // The 3-column workspaces need the full width; the list pages read better narrow.
  const wide = screen === 'review' || screen === 'inbox';

  return (
    <div className="app">
      <PageGrid />
      <AppHeader
        screen={screen}
        onScreen={setScreen}
        badges={badges}
        syncState={syncState}
        syncLabel={syncLabel}
        notificationCount={notificationCount}
        onNotifications={() =>
          setToast(
            notificationCount > 0
              ? `${notificationCount} bill(s) need attention — open Review to resolve them.`
              : 'No notifications. Low-confidence parses and source failures will appear here.',
          )
        }
        user={user}
        onProfile={() =>
          setToast(
            user?.email
              ? `Signed in as ${user.email}. Profile and role management aren't built yet.`
              : 'Not signed in.',
          )
        }
        theme={theme}
        onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />

      <main className={`app__main${wide ? ' app__main--wide' : ''}`}>
        {listError && (
          <div className="notice notice--error" role="alert">
            <span>{listError}</span>
          </div>
        )}

        {screen === 'inbox' && (
          <InboxScreen
            items={inboxItems}
            setItems={setInboxItems}
            onParsed={(savedId, provenance) => {
              if (provenance.length > 0) {
                setProvenanceById((m) => ({ ...m, [savedId]: provenance }));
              }
              void refresh(search);
            }}
            onReviewAll={() => setScreen('review')}
            reviewer={user?.email ?? null}
          />
        )}

        {screen === 'review' && (
          <ReviewScreen
            bills={bills}
            provenanceById={provenanceById}
            loading={loading}
            search={search}
            onSearch={setSearch}
            onSave={handleSave}
            onDelete={(b) => void handleDelete(b)}
            onExport={() =>
              downloadCsv(bills, `bills-${new Date().toISOString().slice(0, 10)}.csv`)
            }
            onRefresh={() => void refresh(search)}
            busyId={busyId}
          />
        )}

        {screen === 'stats' && (
          <StatsScreen
            stats={stats}
            bills={bills}
            onGoToParse={() => setScreen('inbox')}
            onGoToInbox={() => setScreen('review')}
          />
        )}

        {screen === 'integrations' && <IntegrationsScreen />}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button type="button" className="btn btn--ghost" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
