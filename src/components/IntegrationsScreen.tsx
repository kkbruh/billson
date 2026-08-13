import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  configureIntegration,
  listIntegrations,
  STATUS_UI,
  syncCatalog,
  testConnection,
  type IntegrationRow,
  type IntegrationSide,
  type IntegrationsView,
} from '../lib/integrations';
import { errorMessage } from '../lib/api';
import { FIELDS, FIELD_GROUPS } from '../lib/fields';

/** A short, human line about what a status means and what to do next. */
function statusHint(row: IntegrationRow): string {
  switch (row.status) {
    case 'live':
      return 'Connected and returning data.';
    case 'degraded':
      return 'Authorized, but a live check came back empty or errored — needs configuration.';
    case 'needs_auth':
      return 'Connector is available but not authorized yet. Connect it in Facilio Connections, then re-check.';
    case 'unavailable':
      return 'Not available in this org.';
  }
}

interface CardProps {
  side: IntegrationSide;
  row: IntegrationRow;
  busy: boolean;
  onToggle: (row: IntegrationRow, enabled: boolean) => void;
  onTest: (row: IntegrationRow) => void;
  onSaveConfig: (row: IntegrationRow, config: Record<string, unknown>) => void;
  onSaveFieldMap: (row: IntegrationRow, fieldMap: Record<string, string>) => void;
}

function IntegrationCard({
  side,
  row,
  busy,
  onToggle,
  onTest,
  onSaveConfig,
  onSaveFieldMap,
}: CardProps) {
  const [open, setOpen] = useState(false);
  const ui = STATUS_UI[row.status];

  // Config is edited as JSON text — the backend column is free-form JSON.
  const [configText, setConfigText] = useState(() => JSON.stringify(row.config ?? {}, null, 2));
  const [configErr, setConfigErr] = useState<string | null>(null);

  // Field map is edited as structured inputs: our field → their field name.
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(() => ({ ...row.fieldMap }));

  // Re-seed local buffers if the row changes underneath us (after a refresh).
  useEffect(() => {
    setConfigText(JSON.stringify(row.config ?? {}, null, 2));
    setFieldMap({ ...row.fieldMap });
  }, [row]);

  const mappedCount = useMemo(
    () => Object.values(fieldMap).filter((v) => v && v.trim() !== '').length,
    [fieldMap],
  );

  const saveConfig = () => {
    let parsed: Record<string, unknown>;
    try {
      const v = configText.trim() === '' ? {} : JSON.parse(configText);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be a JSON object');
      parsed = v as Record<string, unknown>;
    } catch (e) {
      setConfigErr(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    setConfigErr(null);
    onSaveConfig(row, parsed);
  };

  const saveFieldMap = () => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v && v.trim() !== '') cleaned[k] = v.trim();
    }
    onSaveFieldMap(row, cleaned);
  };

  return (
    <div className="intg-card">
      <div className="intg-card__head">
        <div className="intg-card__id">
          <span className={`fds-dot ${ui.dot}`} />
          <span className="intg-card__name">{row.displayName}</span>
          <span className={`chip ${ui.chip}`}>{ui.label}</span>
          {row.enabled && <span className="chip chip--neutral">Enabled</span>}
        </div>

        <div className="intg-card__controls">
          <label className="toggle" title={row.enabled ? 'Disable' : 'Enable'}>
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={busy}
              onChange={(e) => onToggle(row, e.target.checked)}
            />
            <span className="toggle__track">
              <span className="toggle__thumb" />
            </span>
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => onTest(row)}
          >
            {busy ? <span className="btn__spinner" aria-hidden="true" /> : 'Re-check'}
          </button>
          <button
            type="button"
            className="btn"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Configure'}
          </button>
        </div>
      </div>

      <p className="intg-card__detail muted">
        {statusHint(row)}
        {row.statusDetail ? ` — ${row.statusDetail}` : ''}
      </p>
      {row.lastError && (
        <p className="intg-card__detail intg-card__detail--err">Last error: {row.lastError}</p>
      )}

      {open && (
        <div className="intg-card__body">
          <div className="fds-section-head">
            <span className="fds-section-head__label">
              {side === 'source' ? 'Source settings' : 'Destination settings'}
            </span>
            <span className="fds-section-head__rule" />
          </div>

          <label className="field">
            <span className="field__label">Config (JSON)</span>
            <textarea
              className="input intg-textarea"
              spellCheck={false}
              rows={4}
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
            />
          </label>
          {configErr && <p className="intg-card__detail intg-card__detail--err">{configErr}</p>}
          <div className="intg-actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={saveConfig}>
              Save settings
            </button>
          </div>

          {side === 'destination' && (
            <>
              <div className="fds-section-head" style={{ marginTop: '16px' }}>
                <span className="fds-section-head__label">
                  Field mapping — bill field → {row.displayName} field ({mappedCount} mapped)
                </span>
                <span className="fds-section-head__rule" />
              </div>
              <p className="muted intg-card__detail">
                Map each parsed bill field to the name it should carry in {row.displayName}. Leave a
                row blank to skip it.
              </p>

              {FIELD_GROUPS.map((group) => (
                <div className="intg-map-group" key={group}>
                  <span className="intg-map-group__label">{group}</span>
                  {FIELDS.filter((f) => f.group === group).map((f) => (
                    <div className="intg-map-row" key={String(f.key)}>
                      <label className="intg-map-row__key" htmlFor={`map-${row.kind}-${f.key}`}>
                        {f.label}
                      </label>
                      <span className="intg-map-row__arrow" aria-hidden="true">
                        →
                      </span>
                      <input
                        id={`map-${row.kind}-${f.key}`}
                        className="input intg-map-row__input"
                        placeholder="(unmapped)"
                        value={fieldMap[f.key] ?? ''}
                        onChange={(e) =>
                          setFieldMap((m) => ({ ...m, [f.key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}

              <div className="intg-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={saveFieldMap}
                >
                  Save field mapping
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function IntegrationsScreen() {
  const [view, setView] = useState<IntegrationsView>({ sources: [], destinations: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await listIntegrations());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const recheckAll = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncCatalog();
      await load();
      setNotice('Re-checked every integration.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const withBusy = async (kind: string, fn: () => Promise<void>, done: string) => {
    setBusyKind(kind);
    setError(null);
    try {
      await fn();
      await load();
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyKind(null);
    }
  };

  const cardHandlers = (side: IntegrationSide) => ({
    onToggle: (row: IntegrationRow, enabled: boolean) =>
      void withBusy(
        row.kind,
        () => configureIntegration(side, row.kind, { enabled }),
        `${row.displayName} ${enabled ? 'enabled' : 'disabled'}.`,
      ),
    onTest: (row: IntegrationRow) =>
      void withBusy(
        row.kind,
        async () => {
          const res = await testConnection(row.kind);
          setNotice(`${res.display}: ${STATUS_UI[res.status].label} — ${res.detail}`);
        },
        '',
      ),
    onSaveConfig: (row: IntegrationRow, config: Record<string, unknown>) =>
      void withBusy(
        row.kind,
        () => configureIntegration(side, row.kind, { config }),
        `Saved settings for ${row.displayName}.`,
      ),
    onSaveFieldMap: (row: IntegrationRow, fieldMap: Record<string, string>) =>
      void withBusy(
        row.kind,
        () => configureIntegration(side, row.kind, { fieldMap }),
        `Saved field mapping for ${row.displayName}.`,
      ),
  });

  const sourceHandlers = cardHandlers('source');
  const destHandlers = cardHandlers('destination');

  const liveCount = (rows: IntegrationRow[]) => rows.filter((r) => r.status === 'live').length;

  return (
    <div className="app__main-inner">
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="page-head__title">Integrations</h1>
          <p className="page-head__sub">
            Entry points bring bills in; exit points push the digitized bill out. A connector can be
            authorized and still not work, so status is checked live.
          </p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn" disabled={syncing} onClick={() => void recheckAll()}>
            {syncing ? <span className="btn__spinner" aria-hidden="true" /> : null}
            {syncing ? ' Re-checking…' : 'Re-check all'}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice--success" role="status">
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading integrations…</p>
      ) : (
        <>
          <section className="intg-section">
            <div className="fds-section-head">
              <span className="fds-section-head__label">
                Entry points — where bills come in ({liveCount(view.sources)}/{view.sources.length}{' '}
                connected)
              </span>
              <span className="fds-section-head__rule" />
            </div>
            {view.sources.length === 0 ? (
              <p className="muted">No sources in the registry yet. Run “Re-check all”.</p>
            ) : (
              view.sources.map((row) => (
                <IntegrationCard
                  key={row.kind}
                  side="source"
                  row={row}
                  busy={busyKind === row.kind}
                  {...sourceHandlers}
                />
              ))
            )}
          </section>

          <section className="intg-section">
            <div className="fds-section-head">
              <span className="fds-section-head__label">
                Exit points — where digitized bills go ({liveCount(view.destinations)}/
                {view.destinations.length} connected)
              </span>
              <span className="fds-section-head__rule" />
            </div>
            {view.destinations.length === 0 ? (
              <p className="muted">No destinations in the registry yet. Run “Re-check all”.</p>
            ) : (
              view.destinations.map((row) => (
                <IntegrationCard
                  key={row.kind}
                  side="destination"
                  row={row}
                  busy={busyKind === row.kind}
                  {...destHandlers}
                />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
