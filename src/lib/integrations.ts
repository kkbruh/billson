import { vibe } from '../vibe';

/**
 * Client for the deployed `registry` server function — the config layer for bill
 * intake (sources / entry points) and output (destinations / exit points).
 *
 * The backend is already live; this module is just the typed browser seam. Status
 * is four-valued on purpose (see the function's own header): being authorized is
 * not the same as working, so a connector that answers but returns nothing useful
 * is `degraded`, not `live`.
 */

const FUNCTION = 'registry';

export type IntegrationStatus = 'live' | 'degraded' | 'needs_auth' | 'unavailable';
export type IntegrationSide = 'source' | 'destination';

/** One entry- or exit-point row, normalized from the registry's text columns. */
export interface IntegrationRow {
  kind: string;
  displayName: string;
  enabled: boolean;
  status: IntegrationStatus;
  statusDetail: string;
  /** Free-form per-connector config (folder/label to watch, site id, …). */
  config: Record<string, unknown>;
  /** Destination only: our-field → their-field mapping. */
  fieldMap: Record<string, string>;
  lastPollAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
}

export interface IntegrationsView {
  sources: IntegrationRow[];
  destinations: IntegrationRow[];
}

const STATUS_VALUES: IntegrationStatus[] = ['live', 'degraded', 'needs_auth', 'unavailable'];

function toStatus(v: unknown): IntegrationStatus {
  const s = String(v ?? '').trim().toLowerCase();
  return (STATUS_VALUES as string[]).includes(s) ? (s as IntegrationStatus) : 'unavailable';
}

function toBool(v: unknown): boolean {
  return v === true || String(v ?? '').trim().toLowerCase() === 'true';
}

function toStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Parse a JSON text column into an object; never throw on a bad blob. */
function toObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v !== 'string' || v.trim() === '') return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** field_map is a flat string→string map; coerce every value to a string. */
function toFieldMap(v: unknown): Record<string, string> {
  const obj = toObject(v);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj)) {
    const s = toStrOrNull(val);
    if (s) out[k] = s;
  }
  return out;
}

function toRow(raw: Record<string, unknown>): IntegrationRow {
  return {
    kind: String(raw.kind ?? ''),
    displayName: String(raw.display_name ?? raw.kind ?? ''),
    enabled: toBool(raw.enabled),
    status: toStatus(raw.status),
    statusDetail: String(raw.status_detail ?? ''),
    config: toObject(raw.config),
    fieldMap: toFieldMap(raw.field_map),
    lastPollAt: toStrOrNull(raw.last_poll_at),
    lastPushAt: toStrOrNull(raw.last_push_at),
    lastError: toStrOrNull(raw.last_error),
  };
}

// ── presentation helpers ─────────────────────────────────────────────────────

export interface StatusPresentation {
  label: string;
  /** Reuses the existing chip palette: green / red / neutral. */
  chip: 'chip--green' | 'chip--red' | 'chip--neutral';
  dot: string;
}

export const STATUS_UI: Record<IntegrationStatus, StatusPresentation> = {
  live: { label: 'Connected', chip: 'chip--green', dot: 'fds-dot--success' },
  degraded: { label: 'Needs configuration', chip: 'chip--neutral', dot: 'fds-dot--warning' },
  needs_auth: { label: 'Not connected', chip: 'chip--neutral', dot: 'fds-dot--neutral' },
  unavailable: { label: 'Unavailable', chip: 'chip--red', dot: 'fds-dot--error' },
};

// ── dev fixture ──────────────────────────────────────────────────────────────
// Local dev has no Facilio session, so the registry function can't run. Serve a
// representative snapshot (matching the live GBU catalog) so the screen is fully
// explorable from `npm run dev`. Dead code in a production build.

function devView(): IntegrationsView {
  const mk = (
    kind: string,
    displayName: string,
    status: IntegrationStatus,
    enabled: boolean,
    extra: Partial<IntegrationRow> = {},
  ): IntegrationRow => ({
    kind,
    displayName,
    enabled,
    status,
    statusDetail: STATUS_UI[status].label,
    config: {},
    fieldMap: {},
    lastPollAt: null,
    lastPushAt: null,
    lastError: null,
    ...extra,
  });
  return {
    sources: [
      mk('outlook', 'Outlook mailbox', 'live', true),
      mk('gmail', 'Gmail mailbox', 'needs_auth', false),
      mk('google-drive', 'Google Drive folder', 'needs_auth', false),
      mk('sharepoint', 'SharePoint / OneDrive folder', 'degraded', false),
    ],
    destinations: [
      mk('facilio', 'Facilio CMMS (Bills module)', 'live', true, {
        fieldMap: { vendor_name: 'vendor', total_amount: 'amount', invoice_number: 'name' },
      }),
      mk('xero', 'Xero', 'needs_auth', false),
      mk('quickbooks-online', 'QuickBooks Online', 'needs_auth', false),
      mk('netsuite', 'NetSuite', 'needs_auth', false),
      mk('sage-intacct', 'Sage Intacct', 'needs_auth', false),
      mk('oracle-fusion-erp', 'Oracle Fusion ERP', 'needs_auth', false),
    ],
  };
}

// ── calls ────────────────────────────────────────────────────────────────────

export async function listIntegrations(): Promise<IntegrationsView> {
  if (import.meta.env.DEV) return devView();
  const res = await vibe.executeFunction<{
    sources: Record<string, unknown>[];
    destinations: Record<string, unknown>[];
  }>(FUNCTION, 'list-integrations', {});
  return {
    sources: (res?.sources ?? []).map(toRow),
    destinations: (res?.destinations ?? []).map(toRow),
  };
}

export interface SyncOutcome {
  kind: string;
  display: string;
  status: IntegrationStatus;
  detail: string;
}

export interface SyncResult {
  checkedAt: string;
  sources: SyncOutcome[];
  destinations: SyncOutcome[];
}

/** Re-probe every integration (or one `only` kind) and refresh stored status. */
export async function syncCatalog(only?: string): Promise<SyncResult> {
  if (import.meta.env.DEV) {
    const v = devView();
    const map = (r: IntegrationRow): SyncOutcome => ({
      kind: r.kind,
      display: r.displayName,
      status: r.status,
      detail: r.statusDetail,
    });
    return { checkedAt: new Date().toISOString(), sources: v.sources.map(map), destinations: v.destinations.map(map) };
  }
  const res = await vibe.executeFunction<{
    checkedAt: string;
    sources: SyncOutcome[];
    destinations: SyncOutcome[];
  }>(FUNCTION, 'sync-catalog', only ? { only } : {});
  return {
    checkedAt: res?.checkedAt ?? new Date().toISOString(),
    sources: res?.sources ?? [],
    destinations: res?.destinations ?? [],
  };
}

export interface ConfigurePatch {
  enabled?: boolean;
  config?: Record<string, unknown>;
  fieldMap?: Record<string, string>;
}

/** Enable/disable an integration and/or update its config or field map. */
export async function configureIntegration(
  side: IntegrationSide,
  kind: string,
  patch: ConfigurePatch,
): Promise<void> {
  if (import.meta.env.DEV) return;
  const args: Record<string, string> = { side, kind };
  if (patch.enabled !== undefined) args.enabled = patch.enabled ? 'true' : 'false';
  if (patch.config !== undefined) args.config = JSON.stringify(patch.config);
  if (patch.fieldMap !== undefined) args.fieldMap = JSON.stringify(patch.fieldMap);
  await vibe.executeFunction(FUNCTION, 'configure', args);
}

export interface TestResult {
  kind: string;
  display: string;
  status: IntegrationStatus;
  detail: string;
  checkedAt: string;
}

/** Probe one integration right now and report what actually came back. */
export async function testConnection(kind: string): Promise<TestResult> {
  if (import.meta.env.DEV) {
    return {
      kind,
      display: kind,
      status: 'degraded',
      detail: 'Dev mode — no live connection to probe.',
      checkedAt: new Date().toISOString(),
    };
  }
  const res = await vibe.executeFunction<{
    kind: string;
    display: string;
    status: IntegrationStatus;
    detail: string;
    checkedAt: string;
  }>(FUNCTION, 'test-connection', { kind });
  return {
    kind: res?.kind ?? kind,
    display: res?.display ?? kind,
    status: toStatus(res?.status),
    detail: String(res?.detail ?? ''),
    checkedAt: res?.checkedAt ?? new Date().toISOString(),
  };
}
