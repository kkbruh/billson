import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { SyncState } from './components/AppHeader';
import { Sidebar, NAV_TITLE, type NavKey } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Placeholder } from './components/Placeholder';
import { InboxScreen, type InboxItem } from './components/InboxScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { StatsScreen } from './components/StatsScreen';
import { IntegrationsScreen } from './components/IntegrationsScreen';
import { CmmsBillsScreen } from './components/CmmsBillsScreen';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const stored = localStorage.getItem('billparser.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [nav, setNav] = useState<NavKey>('inbox');

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [bills, setBills] = useState<SavedBill[]>([]);
  const [stats, setStats] = useState<BillStats | null>(null);
  const [search, setSearch] = useState('');
  const [inboxSearch, setInboxSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [syncState, setSyncState] = useState<SyncState>('checking');
  const [toast, setToast] = useState<string | null>(null);

  // Owned here so the Inbox survives navigating between screens mid-run.
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  // CMMS record ids already pushed into the Inbox — kept at App level so the
  // "In Inbox" state (and dedupe) survive navigating away from the CMMS tab.
  // The ref is the synchronous source of truth (reliable under concurrent adds);
  // the state mirror drives rendering.
  const cmmsAddedRef = useRef<Set<number>>(new Set());
  const [cmmsAdded, setCmmsAdded] = useState<Set<number>>(new Set());

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

  // Drop a fetched CMMS bill PDF into the Bills Inbox as a normal item, so it
  // flows through the existing Parse → Review pipeline.
  const addToInbox = useCallback((file: File, origin: string, recordId?: number) => {
    // Idempotent by record id: re-adding the same CMMS record is a no-op, so a
    // repeated click or a re-run of "Add all" never creates duplicate items.
    // The ref check is synchronous, so it holds even under many concurrent adds.
    if (recordId != null) {
      if (cmmsAddedRef.current.has(recordId)) return;
      cmmsAddedRef.current.add(recordId);
      setCmmsAdded(new Set(cmmsAddedRef.current));
    }
    setInboxItems((rows) => [
      ...rows,
      {
        key: `cmms-${recordId ?? file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      },
    ]);
  }, []);

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

  // ── unauthenticated gate ────────────────────────────────────────────────────
  if (authChecked && !user) {
    return (
      <div className="bi-shell" style={{ gridTemplateColumns: '1fr' }}>
        <main className="bi-main">
          <div className="bi-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div className="fds-widget" style={{ maxWidth: 420, width: '100%' }}>
              <div className="fds-widget__header">
                <span className="fds-widget__title">Facilio · Bill Intelligence</span>
              </div>
              <div className="fds-widget__body">
                <div className="empty">
                  <div className="empty__text">Sign in to read and save bills.</div>
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={() => vibe.login()}
                  >
                    Sign in
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const onNotifications = () =>
    setToast(
      notificationCount > 0
        ? `${notificationCount} bill(s) need attention — open the Review Queue to resolve them.`
        : 'No notifications. Low-confidence parses and source failures will appear here.',
    );

  const onProfile = () =>
    setToast(
      user?.email
        ? `Signed in as ${user.email}. Profile and role management aren't built yet.`
        : 'Not signed in.',
    );

  return (
    <div className="bi-shell">
      <Sidebar
        active={nav}
        onNavigate={setNav}
        badges={badges}
        theme={theme}
        onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />

      <main className="bi-main">
        <Topbar
          title={NAV_TITLE[nav]}
          search={nav === 'inbox' ? inboxSearch : undefined}
          onSearch={nav === 'inbox' ? setInboxSearch : undefined}
          searchPlaceholder="Search bills, providers…"
          syncState={syncState}
          syncLabel={syncLabel}
          notificationCount={notificationCount}
          onNotifications={onNotifications}
          user={user}
          onProfile={onProfile}
        />

        <div className="bi-page">
          {listError && (
            <div className="notice notice--error" role="alert">
              <span>{listError}</span>
            </div>
          )}

          {nav === 'inbox' && (
            <InboxScreen
              items={inboxItems}
              setItems={setInboxItems}
              search={inboxSearch}
              onParsed={(savedId, provenance) => {
                if (provenance.length > 0) {
                  setProvenanceById((m) => ({ ...m, [savedId]: provenance }));
                }
                void refresh(search);
              }}
              onReviewAll={() => setNav('review')}
              reviewer={user?.email ?? null}
            />
          )}

          {nav === 'review' && (
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

          {nav === 'dashboard' && (
            <StatsScreen
              stats={stats}
              bills={bills}
              onGoToParse={() => setNav('inbox')}
              onGoToInbox={() => setNav('review')}
            />
          )}

          {nav === 'cmms' && (
            <CmmsBillsScreen
              onSendToInbox={addToInbox}
              onGoToInbox={() => setNav('inbox')}
              addedIds={cmmsAdded}
            />
          )}

          {nav === 'sources' && <IntegrationsScreen />}

          {nav === 'reports' && (
            <Placeholder
              icon="reports"
              title="Reports"
              blurb="Scheduled exports and spend reports will live here. Cost analytics are on the Home dashboard for now."
            />
          )}
          {nav === 'templates' && (
            <Placeholder
              icon="templates"
              title="Templates"
              blurb="Per-vendor extraction templates that lock field positions for known bill layouts. Not built yet — every bill is read by the AI extractor today."
            />
          )}
          {nav === 'clients' && (
            <Placeholder
              icon="clients"
              title="Clients & Providers"
              blurb="A directory of clients and utility providers to attribute each bill to. Not modelled yet — bills carry the parsed provider name only."
            />
          )}
          {nav === 'settings' && (
            <Placeholder
              icon="settings"
              title="Settings"
              blurb="Org preferences, extraction defaults and roles will live here."
            />
          )}
        </div>
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
