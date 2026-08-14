import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  configureIntegration,
  listIntegrations,
  syncCatalog,
  testConnection,
  type IntegrationRow,
  type IntegrationSide,
  type IntegrationStatus,
  type IntegrationsView,
} from '../lib/integrations';
import { errorMessage } from '../lib/api';
import { FIELDS, FIELD_GROUPS } from '../lib/fields';

/** Status → Figma pill + dot. Being authorized ≠ working, so four states. */
const STATUS_TAG: Record<IntegrationStatus, { label: string; tag: string; dot: string }> = {
  live: { label: 'Connected', tag: 'bi-tag--green', dot: 'fds-dot--success' },
  degraded: { label: 'Needs config', tag: 'bi-tag--amber', dot: 'fds-dot--warning' },
  needs_auth: { label: 'Not connected', tag: 'bi-tag--neutral', dot: 'fds-dot--neutral' },
  unavailable: { label: 'Unavailable', tag: 'bi-tag--red', dot: 'fds-dot--error' },
};

/** Lettermark for the card's icon square. */
function initial(name: string): string {
  const parts = name.split(/[\s/&·-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

/** Deterministic pastel per connector, so each tile reads distinctly. */
function iconStyle(kind: string) {
  let h = 0;
  for (const c of kind) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 62% 88%)`, color: `hsl(${h} 55% 30%)` };
}

function statusHint(row: IntegrationRow): string {
  switch (row.status) {
    case 'live':
      return 'Connected and returning data.';
    case 'degraded':
      return 'Authorized, but a live check came back empty or errored — needs configuration.';
    case 'needs_auth':
      return 'Available but not authorized yet. Connect it in Facilio Connections, then re-check.';
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
  const ui = STATUS_TAG[row.status];

  const [configText, setConfigText] = useState(() => JSON.stringify(row.config ?? {}, null, 2));
  const [configErr, setConfigErr] = useState<string | null>(null);
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
    <div className={`bi-conn-card${open ? ' bi-conn-card--open' : ''}`}>
      <div className="bi-conn-card__top">
        <span className="bi-conn-card__icon" style={iconStyle(row.kind)} aria-hidden="true">
          {initial(row.displayName)}
        </span>
        <div className="bi-conn-card__meta">
          <span className="bi-conn-card__name" title={row.displayName}>
            {row.displayName}
          </span>
          <span className="bi-conn-card__tags">
            <span className={`bi-tag ${ui.tag}`}>
              <span className={`fds-dot ${ui.dot}`} />
              {ui.label}
            </span>
            {row.enabled && <span className="bi-tag bi-tag--neutral">Enabled</span>}
          </span>
        </div>
        <label className="toggle bi-conn-card__toggle" title={row.enabled ? 'Disable' : 'Enable'}>
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
      </div>

      <p className="bi-conn-card__hint bi-conn-card__hint--clamp">
        {statusHint(row)}
        {row.statusDetail ? ` — ${row.statusDetail}` : ''}
      </p>
      {row.lastError && (
        <p className="bi-conn-card__hint bi-vtext--red">Last error: {row.lastError}</p>
      )}

      <div className="bi-conn-card__foot">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onTest(row)}>
          {busy ? <span className="btn__spinner" aria-hidden="true" /> : 'Re-check'}
        </button>
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Configure'}
        </button>
      </div>

      {open && (
        <div className="bi-conn-card__body">
          <div className="fds-section-head">
            <span className="fds-section-head__label">
              {side === 'source' ? 'Source settings' : 'Destination settings'}
            </span>
            <span className="fds-section-head__rule" />
          </div>

          <label className="field">
            <span className="field__label">Config (JSON)</span>
            <textarea
              className="input bi-conn-textarea"
              spellCheck={false}
              rows={4}
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
            />
          </label>
          {configErr && <p className="bi-conn-card__hint bi-vtext--red">{configErr}</p>}
          <div className="bi-conn-actions">
            <button type="button" className="btn btn--accent" disabled={busy} onClick={saveConfig}>
              Save settings
            </button>
          </div>

          {side === 'destination' && (
            <>
              <div className="fds-section-head" style={{ marginTop: 16 }}>
                <span className="fds-section-head__label">
                  Field mapping — bill field → {row.displayName} ({mappedCount} mapped)
                </span>
                <span className="fds-section-head__rule" />
              </div>
              <p className="bi-conn-card__hint">
                Map each parsed bill field to the name it carries in {row.displayName}. Leave a row
                blank to skip it.
              </p>

              {FIELD_GROUPS.map((group) => (
                <div className="bi-map-group" key={group}>
                  <span className="bi-map-group__label">{group}</span>
                  {FIELDS.filter((f) => f.group === group).map((f) => (
                    <div className="bi-map-row" key={String(f.key)}>
                      <label className="bi-map-row__key" htmlFor={`map-${row.kind}-${f.key}`}>
                        {f.label}
                      </label>
                      <span className="bi-map-row__arrow" aria-hidden="true">
                        →
                      </span>
                      <input
                        id={`map-${row.kind}-${f.key}`}
                        className="input bi-map-row__input"
                        placeholder="(unmapped)"
                        value={fieldMap[f.key] ?? ''}
                        onChange={(e) => setFieldMap((m) => ({ ...m, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              ))}

              <div className="bi-conn-actions">
                <button type="button" className="btn btn--accent" disabled={busy} onClick={saveFieldMap}>
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
      if (done) setNotice(done);
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
          setNotice(`${res.display}: ${STATUS_TAG[res.status].label} — ${res.detail}`);
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
    <>
      <div className="bi-toolbar">
        <p className="bi-conn-card__hint" style={{ margin: 0, maxWidth: 640 }}>
          Entry points bring bills in; exit points push the digitized bill out. A connector can be
          authorized and still not work, so status is checked live.
        </p>
        <div className="bi-toolbar__end">
          <button type="button" className="btn" disabled={syncing} onClick={() => void recheckAll()}>
            {syncing ? <span className="btn__spinner" aria-hidden="true" /> : null}
            {syncing ? 'Re-checking…' : 'Re-check all'}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="bi-empty">Loading integrations…</div>
      ) : (
        <>
          <section className="bi-conn-section">
            <div className="fds-section-head">
              <span className="fds-section-head__label">
                Entry points — where bills come in ({liveCount(view.sources)}/{view.sources.length}{' '}
                connected)
              </span>
              <span className="fds-section-head__rule" />
            </div>
            <div className="bi-conn-list">
              {view.sources.length === 0 ? (
                <div className="bi-empty">No sources in the registry yet. Run “Re-check all”.</div>
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
            </div>
          </section>

          <section className="bi-conn-section">
            <div className="fds-section-head">
              <span className="fds-section-head__label">
                Exit points — where digitized bills go ({liveCount(view.destinations)}/
                {view.destinations.length} connected)
              </span>
              <span className="fds-section-head__rule" />
            </div>
            <div className="bi-conn-list">
              {view.destinations.length === 0 ? (
                <div className="bi-empty">No destinations in the registry yet. Run “Re-check all”.</div>
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
            </div>
          </section>
        </>
      )}
    </>
  );
}
