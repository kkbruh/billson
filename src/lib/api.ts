import { VibeError } from '@facilio/vibe-sdk';
import { vibe } from '../vibe';
import type { ExtractedBill, Provenance, SavedBill } from '../types';
import { devListBills, devParseBillFile, devSaveBill } from './devParse';

const FUNCTION = 'bills';
const AGENT = 'bill-extractor';
export const BILLS_TOPIC = 'bills';

/** Postgres returns `numeric` as a string over JSON — coerce back to a number. */
function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Normalize the agent's provenance array. The model can name a field it then
 * omitted, so entries are only kept when they carry usable evidence; the caller
 * drops any whose field ended up empty.
 */
function toProvenance(value: unknown): Provenance[] {
  if (!Array.isArray(value)) return [];
  const out: Provenance[] = [];
  for (const raw of value.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const field = toStr(row.field);
    const source = toStr(row.source_text);
    if (!field || !source) continue;
    out.push({ field, source_text: source, page: toNum(row.page) });
  }
  return out;
}

/** line_items is stored as a JSON string in a text column. */
function toLineItems(value: unknown): SavedBill['line_items'] {
  if (Array.isArray(value)) return value as SavedBill['line_items'];
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalize one row from the database into the shape the UI expects. */
function toBill(row: Record<string, unknown>): SavedBill {
  return {
    id: String(row.id ?? ''),
    vendor_name: toStr(row.vendor_name),
    account_number: toStr(row.account_number),
    invoice_number: toStr(row.invoice_number),
    service_address: toStr(row.service_address),
    utility_type: toStr(row.utility_type) as SavedBill['utility_type'],
    billing_period_start: toStr(row.billing_period_start),
    billing_period_end: toStr(row.billing_period_end),
    statement_date: toStr(row.statement_date),
    due_date: toStr(row.due_date),
    meter_number: toStr(row.meter_number),
    previous_read: toNum(row.previous_read),
    current_read: toNum(row.current_read),
    consumption: toNum(row.consumption),
    consumption_unit: toStr(row.consumption_unit),
    currency: toStr(row.currency),
    subtotal: toNum(row.subtotal),
    tax: toNum(row.tax),
    total_amount: toNum(row.total_amount),
    line_items: toLineItems(row.line_items),
    confidence: toStr(row.confidence) as SavedBill['confidence'],
    notes: toStr(row.notes),
    // Provenance is evidence about one extraction run, not a stored column.
    provenance: [],
    file_id: toStr(row.file_id),
    file_name: toStr(row.file_name),
    status: (toStr(row.status) ?? 'parsed') as SavedBill['status'],
    reviewed_by: toStr(row.reviewed_by),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export interface BillStats {
  total_bills: number;
  confirmed: number;
  flagged: number;
  awaiting_review: number;
  total_amount: number;
  accounts: number;
  last_parsed_at: string | null;
}

export async function listBills(
  search: string,
  limit = 200,
): Promise<{ bills: SavedBill[]; total: number }> {
  if (import.meta.env.DEV) return devListBills(search);
  const res = await vibe.executeFunction<{
    bills: Record<string, unknown>[];
    total: number;
  }>(FUNCTION, 'list-bills', { search, limit, offset: 0 });
  return {
    bills: (res?.bills ?? []).map(toBill),
    total: res?.total ?? 0,
  };
}

export async function getStats(): Promise<BillStats> {
  if (import.meta.env.DEV) {
    return {
      total_bills: 3,
      confirmed: 1,
      flagged: 1,
      awaiting_review: 1,
      total_amount: 49_708.62,
      accounts: 1,
      last_parsed_at: new Date().toISOString(),
    };
  }
  const res = await vibe.executeFunction<Record<string, unknown>>(
    FUNCTION,
    'get-stats',
    {},
  );
  return {
    total_bills: toNum(res?.total_bills) ?? 0,
    confirmed: toNum(res?.confirmed) ?? 0,
    flagged: toNum(res?.flagged) ?? 0,
    awaiting_review: toNum(res?.awaiting_review) ?? 0,
    total_amount: toNum(res?.total_amount) ?? 0,
    accounts: toNum(res?.accounts) ?? 0,
    last_parsed_at: toStr(res?.last_parsed_at),
  };
}

export async function saveBill(
  bill: Partial<SavedBill>,
  id?: string | null,
): Promise<SavedBill> {
  if (import.meta.env.DEV) return devSaveBill(bill);

  const res = await vibe.executeFunction<{ bill: Record<string, unknown> }>(
    FUNCTION,
    'save-bill',
    { payload: JSON.stringify(bill), id: id ?? '' },
  );
  return toBill(res?.bill ?? {});
}

export async function deleteBill(id: string): Promise<void> {
  await vibe.executeFunction(FUNCTION, 'delete-bill', { id });
}

/**
 * The agent itself is missing or not provisioned — retrying will not help, and
 * the app should fall back to manual entry.
 */
export class ExtractionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionUnavailableError';
  }
}

/**
 * The run failed for a transient reason — a gateway timeout on a long document,
 * a rate limit, or a 5xx. Worth retrying; distinct from "unavailable" because
 * telling the user extraction is switched off when it merely timed out sends
 * them to the wrong fix.
 */
export class ExtractionTransientError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ExtractionTransientError';
    this.status = status;
  }
}

function statusOf(err: unknown): number | null {
  if (err instanceof VibeError && typeof err.status === 'number') return err.status;
  const m = err instanceof Error ? /\b(\d{3})\b/.exec(err.message) : null;
  return m ? Number(m[1]) : null;
}

/** 404/401 mean the agent isn't there; anything else transport-ish is retryable. */
function classify(err: unknown): Error {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : 'extraction failed';
  if (status === 404 || status === 401 || status === 403) {
    return new ExtractionUnavailableError(message);
  }
  if (status === null || status === 408 || status === 429 || status >= 500) {
    return new ExtractionTransientError(
      status === 504 || status === 408
        ? 'The extractor timed out reading this document.'
        : message,
      status,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

export interface ParseResult {
  bill: ExtractedBill;
  fileId: number;
  fileName: string;
}

/**
 * Upload the document to the app's own file store, then hand its id to the
 * extraction agent. The file is sent to the configured model provider — the UI
 * says so before the user picks a file.
 */
export async function parseBillFile(file: File): Promise<ParseResult> {
  // Local dev has no Facilio session, so uploads and agent runs can't work from
  // localhost. Simulate the pipeline there so the parsing UI is fully explorable.
  if (import.meta.env.DEV) return devParseBillFile(file);

  const stored = await vibe.uploadFile(file);

  const prompt =
    'Extract every field you can read from this bill document. Reply only with JSON matching the schema.';

  // One retry: a long document can exceed the gateway timeout on the first run
  // and succeed on the second. Only transient failures are retried.
  let raw: unknown;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await vibe.executeAgent<{ response?: { content?: unknown } }>(
        AGENT,
        prompt,
        { fileIds: [stored.fileId] },
      );
      raw = res?.response?.content;
      lastError = null;
      break;
    } catch (err) {
      const classified = classify(err);
      // Nothing to gain from a second attempt if the agent isn't there.
      if (classified instanceof ExtractionUnavailableError) throw classified;
      lastError = classified;
    }
  }
  if (lastError) throw lastError;

  // Structured-output replies arrive as a JSON *string* — always parse.
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('The extraction agent did not return valid JSON.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The extraction agent returned an unexpected shape.');
  }

  const obj = parsed as Record<string, unknown>;

  // Treat the model's output as untrusted: coerce every field before it reaches
  // the form, and never let it through to a write unvalidated.
  const bill: ExtractedBill = {
    vendor_name: toStr(obj.vendor_name),
    account_number: toStr(obj.account_number),
    invoice_number: toStr(obj.invoice_number),
    service_address: toStr(obj.service_address),
    utility_type: toStr(obj.utility_type) as ExtractedBill['utility_type'],
    billing_period_start: toStr(obj.billing_period_start),
    billing_period_end: toStr(obj.billing_period_end),
    statement_date: toStr(obj.statement_date),
    due_date: toStr(obj.due_date),
    meter_number: toStr(obj.meter_number),
    previous_read: toNum(obj.previous_read),
    current_read: toNum(obj.current_read),
    consumption: toNum(obj.consumption),
    consumption_unit: toStr(obj.consumption_unit),
    currency: toStr(obj.currency),
    subtotal: toNum(obj.subtotal),
    tax: toNum(obj.tax),
    total_amount: toNum(obj.total_amount),
    line_items: toLineItems(obj.line_items),
    confidence: toStr(obj.confidence) as ExtractedBill['confidence'],
    notes: toStr(obj.notes),
    provenance: toProvenance(obj.provenance),
  };

  return { bill, fileId: stored.fileId, fileName: stored.fileName ?? file.name };
}

/**
 * Fetch a stored document for preview. Returns an object URL the caller owns and
 * must revoke. Null when the file is gone or the browser can't render its type.
 */
export async function loadStoredPreview(
  fileId: number,
): Promise<{ url: string; type: string } | null> {
  try {
    const blob = await vibe.downloadFile(fileId);
    if (!blob || blob.size === 0) return null;
    const type = blob.type || 'application/pdf';
    return { url: URL.createObjectURL(blob), type };
  } catch {
    return null;
  }
}

/** Upload only — used when extraction is unavailable but the file should still be attached. */
export async function uploadOnly(file: File): Promise<{ fileId: number; fileName: string }> {
  const stored = await vibe.uploadFile(file);
  return { fileId: stored.fileId, fileName: stored.fileName ?? file.name };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}

export interface CurrentUser {
  uid: number | null;
  email: string | null;
  name: string | null;
  orgId: number | null;
}

/**
 * getCurrentUser returns `{ user: {...}, org: {...} }` — the fields are nested,
 * not on the root. Flatten it so callers can't accidentally read undefined.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const raw = await vibe.getCurrentUser<{
    user?: { uid?: number; email?: string; name?: string; username?: string };
    org?: { orgId?: number };
  }>();
  if (!raw) return null;

  const user = raw.user ?? {};
  return {
    uid: typeof user.uid === 'number' ? user.uid : null,
    email: toStr(user.email ?? user.username),
    name: toStr(user.name),
    orgId: typeof raw.org?.orgId === 'number' ? raw.org.orgId : null,
  };
}
