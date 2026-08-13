import { Fragment, useCallback, useEffect, useState } from 'react';
import { icons, type IconName } from '../lib/icons';
import { errorMessage } from '../lib/api';
import {
  configureIntegration,
  listIntegrations,
  syncCatalog,
  testConnection,
  type IntegrationRow,
  type IntegrationStatus,
} from '../lib/integrations';

function mask(icon: string) {
  return { maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` };
}

/** Four-state registry status → the new design's tag palette. */
const TAG: Record<IntegrationStatus, { label: string; cls: string }> = {
  live: { label: 'Connected', cls: 'bi-tag--green' },
  degraded: { label: 'Needs configuration', cls: 'bi-tag--amber' },
  needs_auth: { label: 'Not connected', cls: 'bi-tag--neutral' },
  unavailable: { label: 'Unavailable', cls: 'bi-tag--red' },
};

/** Per-connector glyph, falling back to the generic sources icon. */
const ICON: Record<string, IconName> = {
  outlook: 'mail',
  gmail: 'mail',
  'google-drive': 'drive',
  sharepoint: 'sharepoint',
};

function hint(row: IntegrationRow): string {
  switch (row.status) {
    case 'live':
      return 'Connected and returning data.';
    case 'degraded':
      return 'Authorized, but a live check came back empty or errored — needs configuration.';
    case 'needs_auth':
      return 'Available but not authorized. Connect it in Facilio Connections, then re-check.';
    case 'unavailable':
      return 'Not available in this org.';
  }
}

export function SourcesScreen() {
  const [sources, setSources] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [configErr, setConfigErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const view = await listIntegrations();
      setSources(view.sources);
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

  const recheckAll = () =>
    void (async () => {
      setSyncing(true);
      setError(null);
      try {
        await syncCatalog();
        await load();
        setNotice('Re-checked every source.');
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSyncing(false);
      }
    })();

  const openConfig = (row: IntegrationRow) => {
    if (expanded === row.kind) {
      setExpanded(null);
      return;
    }
    setExpanded(row.kind);
    setConfigErr(null);
    setConfigText(JSON.stringify(row.config ?? {}, null, 2));
  };

  const saveConfig = (row: IntegrationRow) => {
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
    void withBusy(
      row.kind,
      () => configureIntegration('source', row.kind, { config: parsed }),
      `Saved settings for ${row.displayName}.`,
    );
  };

  const connectedCount = sources.filter((s) => s.status === 'live').length;

  return (
    <>
      <div className="bi-toolbar">
        <span className="bi-muted">
          Entry points bring bills in automatically. A connector can be authorized and still not
          work, so status is checked live. {connectedCount}/{sources.length} connected.
        </span>
        <div className="bi-toolbar__end">
          <button type="button" className="btn" disabled={syncing} onClick={recheckAll}>
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

      <div className="bi-tablecard">
        <div className="bi-tablescroll">
          <table className="bi-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Enabled</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && sources.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="bi-empty">Loading sources…</div>
                  </td>
                </tr>
              ) : sources.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="bi-empty">No sources in the registry yet. Run “Re-check all”.</div>
                  </td>
                </tr>
              ) : (
                sources.map((row) => {
                  const tag = TAG[row.status];
                  const busy = busyKind === row.kind;
                  const open = expanded === row.kind;
                  return (
                    <Fragment key={row.kind}>
                      <tr className={open ? 'bi-row--selected' : undefined}>
                        <td>
                          <span className="bi-source">
                            <span
                              className="bi-source__icon"
                              style={mask(icons[ICON[row.kind] ?? 'sources'])}
                              aria-hidden="true"
                            />
                            <span>
                              <strong>{row.displayName}</strong>
                              <span className="bi-cell-2__sub" style={{ display: 'block' }}>
                                {hint(row)}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={`bi-tag ${tag.cls}`} title={row.statusDetail || undefined}>
                            {busy && <span className="bi-tag__spinner" aria-hidden="true" />}
                            {tag.label}
                          </span>
                        </td>
                        <td>
                          <label className="toggle" title={row.enabled ? 'Disable' : 'Enable'}>
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              disabled={busy}
                              onChange={(e) =>
                                void withBusy(
                                  row.kind,
                                  () =>
                                    configureIntegration('source', row.kind, {
                                      enabled: e.target.checked,
                                    }),
                                  `${row.displayName} ${e.target.checked ? 'enabled' : 'disabled'}.`,
                                )
                              }
                            />
                            <span className="toggle__track">
                              <span className="toggle__thumb" />
                            </span>
                          </label>
                        </td>
                        <td>
                          <div className="bi-toolbar__end">
                            <button
                              type="button"
                              className="btn btn--ghost"
                              disabled={busy}
                              onClick={() =>
                                void withBusy(
                                  row.kind,
                                  async () => {
                                    const res = await testConnection(row.kind);
                                    setNotice(`${res.display}: ${TAG[res.status].label} — ${res.detail}`);
                                  },
                                  '',
                                )
                              }
                            >
                              Re-check
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              aria-expanded={open}
                              onClick={() => openConfig(row)}
                            >
                              {open ? 'Close' : 'Configure'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={4}>
                            <div className="bi-source-config">
                              <label className="field">
                                <span className="field__label">Config (JSON)</span>
                                <textarea
                                  className="input bi-source-config__text"
                                  spellCheck={false}
                                  rows={4}
                                  value={configText}
                                  onChange={(e) => setConfigText(e.target.value)}
                                />
                              </label>
                              {configErr && (
                                <p className="bi-vtext bi-vtext--red">{configErr}</p>
                              )}
                              <div className="bi-toolbar__end">
                                <button
                                  type="button"
                                  className="btn btn--accent"
                                  disabled={busy}
                                  onClick={() => saveConfig(row)}
                                >
                                  Save settings
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
