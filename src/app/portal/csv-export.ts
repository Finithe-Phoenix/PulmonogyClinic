import type { Lot, OrderSummary, Product, Supplier } from '../../portal/api';

export type CsvCell = string | number | boolean | null | undefined;
export interface CsvColumn<T> { heading: string; value: (row: T) => CsvCell }
export interface VisiblePage<T> {
  items(): readonly T[];
  loading(): boolean;
  failed(): boolean;
  offset(): number;
  readonly size: number;
}
export interface PageExport { csv: string; filename: string; count: number }
export type ExportKind = 'catalogo' | 'lotes' | 'compras' | 'proveedores';

export const CSV_PAGE_NOTICE = 'CSV parcial: solo las filas visibles, no la base completa. Los textos de riesgo llevan el prefijo «Texto: ». No es un respaldo ni un expediente clínico.';

/** A visible text marker survives spreadsheet quote stripping; it deliberately changes risky text.
 * RFC 4180: https://www.rfc-editor.org/rfc/rfc4180
 * Threat model: https://community.owasp.org/attacks/CSV_Injection
 * CSV has no type system: downstream importers must still treat text columns as text.
 */
function csvCell(value: CsvCell): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error('El CSV requiere cantidades e importes enteros seguros.');
  }
  let text = value == null ? '' : String(value);
  // Include whitespace/control prefixes and locale variants, not just the first byte.
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@\t\r\n＝＋－＠]/u.test(text)) text = 'Texto: ' + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** UTF-8 BOM, comma delimiters, quoted fields, doubled quotes and CRLF records. */
export function buildCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  if (!columns.length) throw new Error('El CSV requiere columnas explícitas.');
  return '\uFEFF' + [columns.map(column => csvCell(column.heading)).join(','),
    ...rows.map(row => columns.map(column => csvCell(column.value(row))).join(','))].join('\r\n') + '\r\n';
}

/** Preserve date-only semantics: no browser timezone or locale conversion. */
export function csvDate(value: string | null): string {
  if (value === null) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new Error('La fecha del CSV no es válida.');
  }
  return value;
}

// Explicit projections: never serialize API objects or actor/session identifiers wholesale.
export const catalogCsv = (rows: readonly Product[]) => buildCsv(rows, [
  {heading:'SKU', value:row=>row.sku}, {heading:'Producto', value:row=>row.name},
  {heading:'Categoría', value:row=>row.category === 'FARMACIA' ? 'Farmacia' : 'Insumos'},
  {heading:'Unidad', value:row=>row.unit}, {heading:'Existencia mínima', value:row=>row.minimumStock},
]);
export const lotsCsv = (rows: readonly Lot[], condition: (lot: Lot) => string) => buildCsv(rows, [
  {heading:'Lote', value:row=>row.batch}, {heading:'Producto', value:row=>row.productName || ''},
  {heading:'Caducidad (AAAA-MM-DD)', value:row=>csvDate(row.expiresOn)},
  {heading:'Condición', value:condition}, {heading:'Existencias', value:row=>row.quantity},
]);
export const purchasesCsv = (rows: readonly OrderSummary[], status: (value: string) => string) => buildCsv(rows, [
  {heading:'Orden', value:row=>row.reference}, {heading:'Estado', value:row=>status(row.status)},
  {heading:'Recibido (centavos MXN)', value:row=>row.receivedCents},
  {heading:'Pendiente (centavos MXN)', value:row=>row.pendingCents},
]);
export const suppliersCsv = (rows: readonly Supplier[]) => buildCsv(rows, [
  {heading:'Proveedor', value:row=>row.name}, {heading:'Referencia', value:row=>row.reference},
]);

export function canExportPage(page: VisiblePage<unknown>, authorized: boolean): boolean {
  return authorized && !page.loading() && !page.failed() && Number.isSafeInteger(page.size) && page.size > 0 && page.items().length > 0 &&
    page.items().length <= page.size && Number.isSafeInteger(page.offset()) && page.offset() >= 0;
}

/** Snapshot only: deliberately accepts no API client and performs no network requests. */
export function preparePageExport<T>(page: VisiblePage<T>, authorized: boolean, kind: ExportKind,
  serialize: (rows: readonly T[]) => string, now = new Date()): PageExport | null {
  if (!canExportPage(page, authorized)) return null;
  const rows = [...page.items()];
  const pageNumber = Math.floor(page.offset() / page.size) + 1;
  const timestamp = now.toISOString().replaceAll(':', '-');
  return {csv: serialize(rows), count: rows.length,
    filename:`pulmonogy-${kind}-parcial-pagina-${pageNumber}-${rows.length}-registros-${timestamp}.csv`};
}

export function downloadPageCsv(file: PageExport): void {
  const url = URL.createObjectURL(new Blob([file.csv], {type:'text/csv;charset=utf-8;header=present'}));
  const link = document.createElement('a');
  link.href = url; link.download = file.filename;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    // Let the browser consume the blob before releasing it; do not retain downloaded data.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
