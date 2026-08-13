import StudioFunctions, { StudioDatabase, VibeEvents } from "@facilio/studio-functions";

/**
 * Bill register — all SQL for the parsed_bills table lives here.
 *
 * Infrastructure comes from the run's env map (SCHEMA / DB_USER / DB_PASSWORD),
 * never from the caller: the browser passes only bill data. Every dynamic value
 * goes through a $n placeholder.
 *
 * Schema notes — the table is created by `facilio vibe db import` (the function's
 * DB role has no CREATE privilege), so:
 *   - `id` is text; ids are generated here, not by a sequence.
 *   - date/timestamp columns are text holding ISO-8601, which sorts correctly
 *     lexicographically and keeps a half-read date from becoming a bogus date.
 *   - `line_items` is a text column holding a JSON array.
 * Every column is nullable, so an older deployed version of the app that doesn't
 * know about a column still writes successfully. Preview and production share
 * this table, so any future change must stay additive.
 *
 * Handler parameters may only be "string" or "number", so a whole bill crosses
 * the wire as a JSON string in `payload` and is validated here.
 */

const server = new StudioFunctions({ name: "bills" });
const events = new VibeEvents();

const TOPIC = "bills";

const UTILITY_TYPES = ["electricity", "water", "gas", "waste", "telecom", "other"];
const STATUSES = ["parsed", "confirmed", "flagged"];
const CONFIDENCES = ["high", "medium", "low"];

/** Columns a caller may write, in the order used by insert/update. */
const WRITABLE = [
  "vendor_name",
  "account_number",
  "invoice_number",
  "service_address",
  "utility_type",
  "billing_period_start",
  "billing_period_end",
  "statement_date",
  "due_date",
  "meter_number",
  "previous_read",
  "current_read",
  "consumption",
  "consumption_unit",
  "currency",
  "subtotal",
  "tax",
  "total_amount",
  "line_items",
  "confidence",
  "notes",
  "file_id",
  "file_name",
  "status",
  "reviewed_by",
];

function db() {
  return new StudioDatabase({
    userName: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    schema: process.env.SCHEMA,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Collision-resistant enough for one app's bill register; no crypto in the sandbox. */
function newId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `bill_${t}_${r}${r2}`;
}

/** Trimmed non-empty string, else null. Capped so one bad parse can't bloat a row. */
function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Finite number, else null. Tolerates "1,234.56" and "$1234.56" from a loose parse. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Strict ISO calendar date, else null — a half-read date is worse than no date. */
function isoDate(value: unknown): string | null {
  const s = text(value, 32);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parts = s.split("-");
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return s;
}

function oneOf(value: unknown, allowed: string[], fallback: string | null): string | null {
  const s = text(value, 32);
  if (!s) return fallback;
  const lower = s.toLowerCase();
  return allowed.indexOf(lower) >= 0 ? lower : fallback;
}

/** Normalize line items into a compact, predictable JSON array string. */
function lineItems(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  const items = [];
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const description = text(row.description, 500);
    const amount = num(row.amount);
    if (description === null && amount === null) continue;
    items.push({
      description: description,
      quantity: num(row.quantity),
      unit_price: num(row.unit_price),
      amount: amount,
    });
  }
  return JSON.stringify(items);
}

/** Map an incoming payload onto the WRITABLE column order, sanitizing each value. */
function values(payload: Record<string, unknown>) {
  return [
    text(payload.vendor_name, 300),
    text(payload.account_number, 120),
    text(payload.invoice_number, 120),
    text(payload.service_address, 600),
    oneOf(payload.utility_type, UTILITY_TYPES, null),
    isoDate(payload.billing_period_start),
    isoDate(payload.billing_period_end),
    isoDate(payload.statement_date),
    isoDate(payload.due_date),
    text(payload.meter_number, 120),
    num(payload.previous_read),
    num(payload.current_read),
    num(payload.consumption),
    text(payload.consumption_unit, 32),
    text(payload.currency, 12),
    num(payload.subtotal),
    num(payload.tax),
    num(payload.total_amount),
    lineItems(payload.line_items),
    oneOf(payload.confidence, CONFIDENCES, null),
    text(payload.notes, 4000),
    text(payload.file_id, 200),
    text(payload.file_name, 400),
    oneOf(payload.status, STATUSES, "parsed"),
    text(payload.reviewed_by, 200),
  ];
}

function parsePayload(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("payload is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** The searchable text columns, shared by the list query and its count. */
const SEARCH_SQL = `(vendor_name ilike $1
   or account_number ilike $1
   or invoice_number ilike $1
   or service_address ilike $1
   or meter_number ilike $1
   or utility_type ilike $1)`;

// ── health ─────────────────────────────────────────────────────────────────────

server.addHandler({
  name: "check-schema",
  description: "Confirm the parsed_bills table is reachable and report the live row count",
  parameters: {},
  execute: async () => {
    const conn = db();
    const { rows } = conn.query(
      `select count(*)::int as total from parsed_bills where deleted_at is null`
    );
    return { ok: true, total: rows[0]?.total ?? 0 };
  },
});

// ── writes ─────────────────────────────────────────────────────────────────────

server.addHandler({
  name: "save-bill",
  description:
    "Insert a reviewed bill, or update it when id is supplied. payload is a JSON object string.",
  parameters: {
    payload: { description: "Bill fields as a JSON object string", type: "string" },
    id: { description: "Existing bill id to update; empty string inserts", type: "string" },
  },
  execute: async (args) => {
    const payload = parsePayload(args.payload);
    const id = text(args.id, 200);
    const conn = db();
    const vals = values(payload);
    const stamp = nowIso();

    let row;
    if (id) {
      const assignments = WRITABLE.map((col, i) => `${col} = $${i + 1}`).join(", ");
      const { rows } = conn.query(
        `update parsed_bills
            set ${assignments}, updated_at = $${WRITABLE.length + 1}
          where id = $${WRITABLE.length + 2} and deleted_at is null
          returning *`,
        vals.concat([stamp, id])
      );
      if (!rows.length) throw new Error(`bill ${id} not found`);
      row = rows[0];
    } else {
      const cols = ["id"].concat(WRITABLE).concat(["created_at", "updated_at"]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = conn.query(
        `insert into parsed_bills (${cols.join(", ")})
         values (${placeholders})
         returning *`,
        [newId()].concat(vals).concat([stamp, stamp])
      );
      row = rows[0];
    }

    // Announce once, after the write has committed, so open pages refresh.
    const sent = await events.publish(TOPIC, {
      type: id ? "bill.updated" : "bill.created",
      id: row?.id,
    });

    return { ok: true, bill: row, realtime: sent?.ok === true };
  },
});

server.addHandler({
  name: "delete-bill",
  description: "Soft-delete a bill by id (kept for audit; hidden from every list)",
  parameters: {
    id: { description: "Bill id", type: "string" },
  },
  execute: async (args) => {
    const id = text(args.id, 200);
    if (!id) throw new Error("an id is required");

    const conn = db();
    const stamp = nowIso();
    const { rows } = conn.query(
      `update parsed_bills
          set deleted_at = $1, updated_at = $1
        where id = $2 and deleted_at is null
        returning id`,
      [stamp, id]
    );
    if (!rows.length) throw new Error(`bill ${id} not found`);

    const sent = await events.publish(TOPIC, { type: "bill.deleted", id: id });
    return { ok: true, id: id, realtime: sent?.ok === true };
  },
});

// ── reads ──────────────────────────────────────────────────────────────────────

server.addHandler({
  name: "list-bills",
  description:
    "List saved bills, newest first. Optional free-text search over vendor, account, invoice, address, meter and type.",
  parameters: {
    search: { description: "Free-text search; empty for all", type: "string" },
    limit: { description: "Max rows (1-200, default 100)", type: "number" },
    offset: { description: "Rows to skip (default 0)", type: "number" },
  },
  execute: async (args) => {
    const conn = db();
    const search = text(args.search, 200);

    let limit = num(args.limit) ?? 100;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
    let offset = num(args.offset) ?? 0;
    if (offset < 0) offset = 0;

    if (search) {
      const like = `%${search}%`;
      const { rows } = conn.query(
        `select * from parsed_bills
          where deleted_at is null and ${SEARCH_SQL}
          order by created_at desc
          limit $2 offset $3`,
        [like, limit, offset]
      );
      const total = conn.query(
        `select count(*)::int as n from parsed_bills
          where deleted_at is null and ${SEARCH_SQL}`,
        [like]
      );
      return { bills: rows, total: total.rows[0]?.n ?? rows.length };
    }

    const { rows } = conn.query(
      `select * from parsed_bills
        where deleted_at is null
        order by created_at desc
        limit $1 offset $2`,
      [limit, offset]
    );
    const total = conn.query(
      `select count(*)::int as n from parsed_bills where deleted_at is null`
    );
    return { bills: rows, total: total.rows[0]?.n ?? rows.length };
  },
});

server.addHandler({
  name: "get-stats",
  description: "Headline counts and totals across the saved bills",
  parameters: {},
  execute: async () => {
    const conn = db();
    const { rows } = conn.query(
      `select
         count(*)::int                                      as total_bills,
         count(*) filter (where status = 'confirmed')::int   as confirmed,
         count(*) filter (where status = 'flagged')::int     as flagged,
         count(*) filter (where status = 'parsed')::int      as awaiting_review,
         coalesce(sum(total_amount), 0)::float8              as total_amount,
         count(distinct account_number)::int                 as accounts,
         max(created_at)                                     as last_parsed_at
       from parsed_bills
       where deleted_at is null`
    );
    return rows[0] ?? {};
  },
});

server.execute();
