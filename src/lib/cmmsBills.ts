import { vibe } from '../vibe';

/**
 * Read-only client for the Facilio CMMS `custom_bills` module (the Bills the
 * mail/drive sweeps mirror into the product). This reads records LIVE through the
 * facilio-cmms connection — there is no app-DB copy.
 *
 * Note: the attachment comes back as metadata only ({ fileId, fileName, … }).
 * Facilio exposes no supported way to pull a custom-module file's bytes back out,
 * so this tab links to the record in Facilio to view/download the PDF rather than
 * rendering it inline. Parsing the file is a separate, source-refetch step.
 */

const CONNECTION = 'facilio-cmms';
const ACTION = 'list-custom-module-records';
const MODULE = 'custom_bills';

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
