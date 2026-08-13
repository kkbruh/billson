import { vibe } from '../vibe';
import samplePdf from '../assets/samples/burnsville-june.pdf?inline';

/**
 * Read-only client for the Facilio CMMS `custom_bills` module (the Bills the
 * mail/drive sweeps mirror into the product). This reads records LIVE through the
 * facilio-cmms connection — there is no app-DB copy.
 *
 * The attachment list-projection is metadata only ({ fileId, fileName, … }), but
 * the real bytes ARE reachable now via `facilio-cmms.download-a-file-field`
 * (see fetchBillFile) — so the PDF can be previewed inline and, later, re-parsed.
 */

const CONNECTION = 'facilio-cmms';
const ACTION = 'list-custom-module-records';
const MODULE = 'custom_bills';
/** The custom_bills FILE field that holds the bill PDF. */
const FILE_FIELD = 'bill_attachment_pdf_custom_bills';

/** Field API names (from the module metadata). Custom fields are `{field}_{module}`. */
const SELECT = [
  'name',
  'amount_custom_bills',
  'currency_custom_bills',
  'invoicenumber_custom_bills',
  'vendor_custom_bills_1',
  'duedate_custom_bills',
  'receivedat_custom_bills',
  'fromemail_custom_bills',
  'description_custom_bills',
  'moduleState',
  'bill_attachment_pdf_custom_bills',
].join(',');

export interface CmmsAttachment {
  fileId: number;
  fileName: string;
  fileSize: number | null;
  fileContentType: string | null;
}

export interface CmmsBill {
  id: number;
  name: string | null;
  amount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  vendor: string | null;
  dueDate: string | null;
  receivedAt: string | null;
  fromEmail: string | null;
  description: string | null;
  status: string | null;
  attachment: CmmsAttachment | null;
}

export interface CmmsBillsPage {
  bills: CmmsBill[];
  count: number | null;
  page: number;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** moduleState comes back either as a string or a lookup object with a label. */
function toStatus(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return toStr(o.displayName ?? o.label ?? o.value ?? o.name);
  }
  return toStr(v);
}

function toAttachment(v: unknown): CmmsAttachment | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const fileId = toNum(o.fileId);
  const fileName = toStr(o.fileName);
  if (fileId === null || !fileName) return null;
  return {
    fileId,
    fileName,
    fileSize: toNum(o.fileSize),
    fileContentType: toStr(o.fileContentType),
  };
}

function toBill(row: Record<string, unknown>): CmmsBill {
  return {
    id: toNum(row.id) ?? 0,
    name: toStr(row.name),
    amount: toNum(row.amount_custom_bills),
    currency: toStr(row.currency_custom_bills),
    invoiceNumber: toStr(row.invoicenumber_custom_bills),
    vendor: toStr(row.vendor_custom_bills_1),
    dueDate: toStr(row.duedate_custom_bills),
    receivedAt: toStr(row.receivedat_custom_bills),
    fromEmail: toStr(row.fromemail_custom_bills),
    description: toStr(row.description_custom_bills),
    status: toStatus(row.moduleState),
    attachment: toAttachment(row.bill_attachment_pdf_custom_bills),
  };
}

/** Link to the record's summary page in the Facilio product. */
export function recordUrl(id: number): string {
  return `https://app.facilio.com/maintenance/goto/summary/${MODULE}/${id}`;
}

// ── dev fixture ──────────────────────────────────────────────────────────────
function devPage(): CmmsBillsPage {
  const mk = (id: number, name: string, vendor: string | null, amount: number | null, file: string | null): CmmsBill => ({
    id,
    name,
    amount,
    currency: 'USD',
    invoiceNumber: name.startsWith('INV') ? name : null,
    vendor,
    dueDate: '2026-09-01',
    receivedAt: '2026-08-13T16:14:02Z',
    fromEmail: 'krishna.k@facilio.com',
    description: 'Vendor bill triaged automatically from the Outlook mailbox.',
    status: 'open',
    attachment: file ? { fileId: 72480323, fileName: file, fileSize: 2938, fileContentType: 'application/pdf' } : null,
  });
  return {
    page: 1,
    count: 3,
    bills: [
      mk(4833403, 'INVOICE 50', 'North Grid Energy', 128.4, '01_electricity_northgrid.pdf'),
      mk(4833401, 'INV 002', 'City Water', 64.0, '01_electricity_northgrid.pdf'),
      mk(4830898, 'Invoice INV-88213 - August electricity', 'North Grid Energy', 212.75, '01_electricity_northgrid.pdf'),
    ],
  };
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export async function listCmmsBills(params: ListParams = {}): Promise<CmmsBillsPage> {
  const page = params.page ?? 1;
  if (import.meta.env.DEV) return devPage();

  const body: Record<string, unknown> = {
    custom_module: MODULE,
    page,
    page_size: params.pageSize ?? 50,
    select: SELECT,
    sort_by: 'sysCreatedTime',
    sort_order: 'desc',
    include_count: true,
  };
  const search = params.search?.trim();
  if (search) body.filters = `name(contains)=${search}`;

  const raw = await vibe.executeAction<Record<string, unknown>>(CONNECTION, ACTION, body);

  // The action's payload may arrive flat ({ data, count, pagination }) or wrapped
  // in an `output` envelope depending on the transport — tolerate both.
  const payload = (raw && typeof raw.output === 'object' && raw.output !== null
    ? (raw.output as Record<string, unknown>)
    : raw) ?? {};
  const rows = Array.isArray(payload.data) ? (payload.data as Record<string, unknown>[]) : [];
  const pagination = payload.pagination as { page?: number } | undefined;

  return {
    bills: rows.map(toBill),
    count: toNum(payload.count),
    page: pagination?.page ?? page,
  };
}

// ── attachment bytes (via facilio-cmms.download-a-file-field) ────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** The download action's payload may be flat, wrapped in `output`, or inside a
 *  `results[]` batch envelope — find the object that actually carries the bytes. */
function findFilePayload(o: unknown): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  const obj = o as Record<string, unknown>;
  if (typeof obj.file_base64 === 'string') return obj;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const it of v) {
        const r = findFilePayload(it);
        if (r) return r;
      }
    } else {
      const r = findFilePayload(v);
      if (r) return r;
    }
  }
  return null;
}

export interface BillFile {
  file: File;
  url: string;
  type: string;
  name: string;
}

/**
 * Fetch a record's bill PDF bytes. Returns a File (to hand to the Inbox) plus an
 * object URL (for inline preview) — the caller revokes the url. Local dev has no
 * Facilio session, so a bundled sample stands in.
 */
export async function fetchBillFile(recordId: number, displayName?: string): Promise<BillFile> {
  const name = displayName || `bill-${recordId}.pdf`;

  if (import.meta.env.DEV) {
    const bytes = base64ToBytes((samplePdf.split(',')[1] ?? ''));
    const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
    return { file, url: URL.createObjectURL(file), type: 'application/pdf', name };
  }

  const raw = await vibe.executeAction<Record<string, unknown>>(CONNECTION, 'download-a-file-field', {
    module_name: MODULE,
    record_id: recordId,
    field_name: FILE_FIELD,
  });
  const payload = findFilePayload(raw);
  const b64 = payload && typeof payload.file_base64 === 'string' ? (payload.file_base64 as string) : '';
  if (!b64) throw new Error('The bill file came back empty.');

  const type = (
    payload && typeof payload.content_type === 'string' ? (payload.content_type as string) : 'application/pdf'
  ).split(';')[0];
  const file = new File([base64ToBytes(b64) as BlobPart], name, { type });
  return { file, url: URL.createObjectURL(file), type, name };
}
