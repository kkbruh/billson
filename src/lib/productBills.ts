import juneData from '../assets/samples/burnsville-june.pdf?inline';
import julyData from '../assets/samples/burnsville-july.pdf?inline';
import augustData from '../assets/samples/burnsville-august.pdf?inline';
import septemberData from '../assets/samples/burnsville-september.pdf?inline';

/**
 * Bills "fetched from the product".
 *
 * The real source is Facilio: bills arrive by email, rules and agents file them
 * into the product, and this app pulls the resulting files. That backend is being
 * built by another team, so for now the same shape is served from four real sample
 * invoices. `fetchProductBills` is the single seam — when the backend lands, only
 * that function changes.
 *
 * The samples are imported with `?inline`, so they are base64 data URIs inside the
 * bundle and are decoded in memory. An earlier version fetched them as emitted
 * asset URLs, which hung on the deployed host and left the UI stuck with no error.
 * Demo fixtures shouldn't depend on the network at all.
 */

export interface ProductBill {
  /** Stable id from the product. */
  externalId: string;
  fileName: string;
  /** Where the product says it came from. */
  origin: string;
  /** When the product received it, ISO-8601. */
  receivedAt: string;
  data: string;
}

const SAMPLES: ProductBill[] = [
  {
    externalId: 'prod-3354-2506',
    fileName: 'Burnsville_Electric_Jun2025.pdf',
    origin: 'Email rule · utilities@byerlys',
    receivedAt: '2025-06-07T09:12:00.000Z',
    data: juneData,
  },
  {
    externalId: 'prod-3354-2507',
    fileName: 'Burnsville_Electric_Jul2025.pdf',
    origin: 'Email rule · utilities@byerlys',
    receivedAt: '2025-07-07T09:04:00.000Z',
    data: julyData,
  },
  {
    externalId: 'prod-3354-2508',
    fileName: 'Burnsville_Electric_Aug2025.pdf',
    origin: 'Email rule · utilities@byerlys',
    receivedAt: '2025-08-07T08:58:00.000Z',
    data: augustData,
  },
  {
    externalId: 'prod-3354-2509',
    fileName: 'Burnsville_Electric_Sep2025.pdf',
    origin: 'Email rule · utilities@byerlys',
    receivedAt: '2025-09-07T09:21:00.000Z',
    data: septemberData,
  },
];

/** Decode a base64 data URI into bytes, without any network round trip. */
function dataUriToBytes(uri: string): ArrayBuffer {
  const comma = uri.indexOf(',');
  const payload = comma >= 0 ? uri.slice(comma + 1) : uri;
  const binary = atob(payload);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

export interface FetchedBill extends Omit<ProductBill, 'data'> {
  file: File;
}

/**
 * Pull the bills the product has waiting. Replace the body with the real Facilio
 * call when the backend is ready; the return shape should not change.
 */
export async function fetchProductBills(): Promise<FetchedBill[]> {
  const out: FetchedBill[] = [];
  for (const bill of SAMPLES) {
    try {
      const bytes = dataUriToBytes(bill.data);
      if (bytes.byteLength === 0) continue;
      const { data: _data, ...rest } = bill;
      out.push({
        ...rest,
        file: new File([bytes], bill.fileName, { type: 'application/pdf' }),
      });
    } catch {
      // A single unreadable fixture shouldn't stop the rest.
    }
  }
  return out;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
