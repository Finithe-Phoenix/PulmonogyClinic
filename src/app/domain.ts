export type VisitStatus =
  "Confirmada" | "En espera" | "En consulta" | "Finalizada" | "Cancelada";
export interface Patient {
  id: string;
  name: string;
  birth: string;
  phone: string;
  tag: string;
}
export interface Visit {
  id: string;
  patientId: string;
  date: string;
  time: string;
  service: string;
  status: VisitStatus;
  externalRef: string;
}
export interface Lot {
  id: string;
  product: string;
  category: "Farmacia" | "Insumos";
  sku: string;
  batch: string;
  expires: string;
  quantity: number;
  minimum: number;
  priceCents: number;
  quarantined: boolean;
}
export interface Movement {
  id: string;
  lotId: string;
  quantity: number;
  kind: "Entrada" | "Salida";
  reason: string;
  date: string;
  purchaseId?: string;
  receiptId?: string;
}
export interface Supplier {
  id: string;
  reference: string;
  name: string;
}
export interface PurchaseLine {
  id: string;
  sku: string;
  product: string;
  category: Lot["category"];
  ordered: number;
  received: number;
  unitCostCents: number;
  minimum: number;
  priceCents: number;
}
export interface PurchaseOrder {
  id: string;
  reference: string;
  supplierId: string;
  date: string;
  expectedDate: string;
  lines: PurchaseLine[];
  cancelled: boolean;
  cancellationReason?: string;
}
export interface PurchaseDraft {
  id: string;
  reference: string;
  supplierId: string;
  date: string;
  expectedDate: string;
  lines: { id: string; sku: string; ordered: number; unitCostCents: number }[];
}
export interface ReceiptInput {
  id: string;
  reference: string;
  purchaseId: string;
  lineId: string;
  date: string;
  batch: string;
  expires: string;
  quantity: number;
  quarantined: boolean;
  newLotId: string;
}
export interface GoodsReceipt extends Omit<ReceiptInput, "newLotId"> {
  lotId: string;
  unitCostCents: number;
}
export interface ClinicalNote {
  id: string;
  patientId: string;
  date: string;
  reason: string;
  history: string;
  assessment: string;
  plan: string;
  status: "Borrador" | "Cerrada";
  addenda: { text: string; date: string }[];
}
export interface Payment {
  id: string;
  reference: string;
  patientId: string;
  concept: string;
  amountCents: number;
  method: "Efectivo" | "Tarjeta" | "Transferencia";
  date: string;
  reversed: boolean;
  reversalReason?: string;
}
export interface Equipment {
  id: string;
  name: string;
  serial: string;
  place: string;
  nextService: string;
  status: "Disponible" | "En mantenimiento";
}
export interface DemoState {
  version: 2;
  patients: Patient[];
  visits: Visit[];
  lots: Lot[];
  movements: Movement[];
  notes: ClinicalNote[];
  payments: Payment[];
  equipment: Equipment[];
  suppliers: Supplier[];
  purchases: PurchaseOrder[];
  receipts: GoodsReceipt[];
}
export const DEMO_DATE = "2026-09-28";
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function requireQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("La cantidad debe ser un entero mayor que cero.");
}
export function isExpired(lot: Lot, date: string): boolean {
  return lot.expires < date;
}
export interface InventoryLotDraft {
  id: string;
  sku: string;
  batch: string;
  expires: string;
  quarantined: boolean;
  catalog?: Pick<Lot, "product" | "category" | "minimum" | "priceCents">;
}
export function createInventoryLot(lots: Lot[], draft: InventoryLotDraft, date: string): Lot[] {
  const sku = draft.sku.trim().toUpperCase(), batch = draft.batch.trim().toUpperCase();
  if (!draft.id.trim() || lots.some(l => l.id === draft.id)) throw new Error("El identificador de lote ya existe o no es válido.");
  if (!/^[A-Z0-9-]{2,40}$/.test(sku)) throw new Error("Usa un SKU de 2 a 40 letras, números o guiones.");
  if (!batch || batch.length > 80) throw new Error("Escribe un lote de hasta 80 caracteres.");
  if (!isCalendarDate(date) || !isCalendarDate(draft.expires) || draft.expires < date)
    throw new Error("La caducidad debe ser una fecha válida, igual o posterior a la fecha de la demo.");
  if (typeof draft.quarantined !== "boolean") throw new Error("Selecciona la condición del lote.");
  const existing = lots.find(l => l.sku.toUpperCase() === sku);
  if (draft.catalog && existing) throw new Error("El SKU ya existe. Usa Agregar lote para ese producto.");
  if (!draft.catalog && !existing) throw new Error("Selecciona un producto del catálogo.");
  if (lots.some(l => l.sku.toUpperCase() === sku && l.batch.trim().toUpperCase() === batch))
    throw new Error("Ese lote ya existe para este producto. Registra una entrada para aumentar sus unidades.");
  const catalog = draft.catalog || existing!;
  if (!catalog.product.trim() || catalog.product.trim().length > 160) throw new Error("Escribe un nombre de producto de hasta 160 caracteres.");
  if (!["Farmacia", "Insumos"].includes(catalog.category)) throw new Error("Selecciona la categoría del producto.");
  if (!Number.isSafeInteger(catalog.minimum) || catalog.minimum < 0 || catalog.minimum > 1000000)
    throw new Error("El mínimo debe ser un entero entre 0 y 1000000.");
  if (!Number.isSafeInteger(catalog.priceCents) || catalog.priceCents < 0 || catalog.priceCents > 10000000000)
    throw new Error("Revisa el precio ilustrativo; admite hasta dos decimales.");
  return [...lots, { id: draft.id, sku, batch, expires: draft.expires, quarantined: draft.quarantined,
    product: catalog.product.trim(), category: catalog.category, minimum: catalog.minimum,
    priceCents: catalog.priceCents, quantity: 0 }];
}
export function dispense(
  lots: Lot[],
  lotId: string,
  quantity: number,
  date: string,
): Lot[] {
  requireQuantity(quantity);
  const lot = lots.find((x) => x.id === lotId);
  if (!lot) throw new Error("No se encontró el lote.");
  if (isExpired(lot, date))
    throw new Error("Lote caducado: no se permite la salida.");
  if (lot.quarantined) throw new Error("El lote está en cuarentena.");
  if (quantity > lot.quantity)
    throw new Error("No hay existencias suficientes.");
  return lots.map((x) =>
    x.id === lotId ? { ...x, quantity: x.quantity - quantity } : x,
  );
}
export function receive(lots: Lot[], lotId: string, quantity: number): Lot[] {
  requireQuantity(quantity);
  const lot = lots.find((x) => x.id === lotId);
  if (!lot) throw new Error("No se encontró el lote.");
  if (!Number.isSafeInteger(lot.quantity + quantity))
    throw new Error("Cantidad fuera de rango.");
  return lots.map((x) =>
    x.id === lotId ? { ...x, quantity: x.quantity + quantity } : x,
  );
}
export function eligibleFEFO(lots: Lot[], sku: string, date: string): Lot[] {
  return lots
    .filter(
      (l) =>
        l.sku === sku &&
        l.quantity > 0 &&
        !l.quarantined &&
        !isExpired(l, date),
    )
    .sort(
      (a, b) => a.expires.localeCompare(b.expires) || a.id.localeCompare(b.id),
    );
}
export function addVisit(visits: Visit[], visit: Visit): Visit[] {
  if (
    !isCalendarDate(visit.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(visit.time)
  )
    throw new Error("Fecha u hora inválida.");
  if (
    visits.some(
      (x) =>
        x.status !== "Cancelada" &&
        x.date === visit.date &&
        x.time === visit.time,
    )
  )
    throw new Error("Este horario ya está ocupado en la demo.");
  return [...visits, visit];
}
export function postPayment(payments: Payment[], payment: Payment): Payment[] {
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0)
    throw new Error(
      "El importe debe ser mayor que cero y tener hasta dos decimales.",
    );
  if (!payment.reference.trim())
    throw new Error("La referencia es obligatoria.");
  if (payments.some((x) => x.reference === payment.reference))
    throw new Error("La referencia ya se registró. No se duplicó el cobro.");
  return [...payments, payment];
}
export function cashTotal(payments: Payment[], date: string): number {
  return payments
    .filter((p) => p.date === date && !p.reversed && p.method === "Efectivo")
    .reduce((t, p) => t + p.amountCents, 0);
}
export function closeNote(note: ClinicalNote): ClinicalNote {
  if (
    [note.reason, note.history, note.assessment, note.plan].some(
      (x) => !x.trim(),
    )
  )
    throw new Error("Completa los cuatro apartados antes de cerrar.");
  return { ...note, status: "Cerrada" };
}
export function appendAddendum(
  note: ClinicalNote,
  text: string,
  date: string,
): ClinicalNote {
  if (note.status !== "Cerrada")
    throw new Error("Solo se añaden adendas a notas cerradas.");
  if (!text.trim()) throw new Error("Escribe el motivo y la corrección.");
  return { ...note, addenda: [...note.addenda, { text: text.trim(), date }] };
}
export function csvCell(value: unknown): string {
  let v = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(v)) v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
export function toCSV(rows: unknown[][]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const referenceKey = (value: string) => value.trim().toUpperCase();
function requireReference(value: string): string {
  const ref = referenceKey(value);
  if (!ref || ref.length > 80) throw new Error("Escribe una referencia de hasta 80 caracteres.");
  return ref;
}
export function addSupplier(state: DemoState, supplier: Supplier): DemoState {
  const reference = requireReference(supplier.reference);
  if (!supplier.id || !supplier.name.trim()) throw new Error("Escribe el nombre ficticio del proveedor.");
  if (state.suppliers.some(s => s.id === supplier.id || referenceKey(s.reference) === reference))
    throw new Error("Ya existe un proveedor con esa referencia.");
  return { ...state, suppliers: [...state.suppliers, { ...supplier, reference, name: supplier.name.trim() }] };
}
export function purchaseStatus(order: PurchaseOrder): string {
  if (order.cancelled) return "Cancelada";
  if (order.lines.every(l => l.received === l.ordered)) return "Recibida";
  return order.lines.some(l => l.received > 0) ? "Parcial" : "Pendiente";
}
export function purchaseTotal(order: PurchaseOrder, pending = false): number {
  return order.lines.reduce((total, line) => total +
    (pending ? line.ordered - line.received : line.ordered) * line.unitCostCents, 0);
}
export function createPurchase(state: DemoState, draft: PurchaseDraft): DemoState {
  const reference = requireReference(draft.reference);
  if (!draft.id || state.purchases.some(p => p.id === draft.id || referenceKey(p.reference) === reference))
    throw new Error("La orden de compra ya existe.");
  if (!state.suppliers.some(s => s.id === draft.supplierId)) throw new Error("Selecciona un proveedor.");
  if (!isCalendarDate(draft.date) || !isCalendarDate(draft.expectedDate) || draft.expectedDate < draft.date)
    throw new Error("Revisa las fechas de la orden y la entrega esperada.");
  if (!draft.lines.length) throw new Error("Agrega al menos un producto a la orden.");
  const skus = new Set<string>();
  const lineIds = new Set<string>();
  const lines: PurchaseLine[] = draft.lines.map(line => {
    const product = state.lots.find(l => l.sku === line.sku);
    if (!product) throw new Error("El producto no existe en el catálogo ficticio.");
    if (!line.id || lineIds.has(line.id) || skus.has(line.sku)) throw new Error("Cada producto debe aparecer una sola vez por orden.");
    lineIds.add(line.id); skus.add(line.sku);
    requireQuantity(line.ordered);
    requireQuantity(line.unitCostCents);
    if (!Number.isSafeInteger(line.ordered * line.unitCostCents)) throw new Error("Importe fuera de rango.");
    return { id: line.id, sku: line.sku, product: product.product, category: product.category,
      ordered: line.ordered, received: 0, unitCostCents: line.unitCostCents,
      minimum: product.minimum, priceCents: product.priceCents };
  });
  const order: PurchaseOrder = { ...draft, reference, lines, cancelled: false };
  if (!Number.isSafeInteger(purchaseTotal(order))) throw new Error("Total fuera de rango.");
  // Ordering alone never changes physical stock or the cash register.
  return { ...state, purchases: [...state.purchases, order] };
}
export function cancelPurchase(state: DemoState, id: string, reason: string): DemoState {
  const order = state.purchases.find(p => p.id === id);
  if (!order || order.cancelled || purchaseStatus(order) === "Recibida")
    throw new Error("Esta orden no tiene un saldo pendiente que cancelar.");
  if (!reason.trim()) throw new Error("Escribe el motivo de cancelación.");
  return { ...state, purchases: state.purchases.map(p => p.id === id
    ? { ...p, cancelled: true, cancellationReason: reason.trim() } : p) };
}
export function receivePurchase(state: DemoState, input: ReceiptInput): DemoState {
  const reference = requireReference(input.reference);
  const batch = requireReference(input.batch);
  const previous = state.receipts.find(r => r.id === input.id || referenceKey(r.reference) === reference);
  if (previous) {
    const same = previous.reference === reference && previous.purchaseId === input.purchaseId &&
      previous.lineId === input.lineId && previous.date === input.date && previous.batch === batch &&
      previous.expires === input.expires && previous.quantity === input.quantity && previous.quarantined === input.quarantined;
    if (!same) throw new Error("La referencia de recepción ya se usó con datos distintos.");
    return state;
  }
  if (!input.id || !input.newLotId) throw new Error("Falta el identificador de recepción o lote.");
  const order = state.purchases.find(p => p.id === input.purchaseId);
  const line = order?.lines.find(l => l.id === input.lineId);
  if (!order || !line) throw new Error("Selecciona una orden y una partida válidas.");
  if (order.cancelled) throw new Error("No se puede recibir una orden cancelada.");
  requireQuantity(input.quantity);
  if (input.quantity > line.ordered - line.received) throw new Error("La cantidad supera el saldo pendiente de la orden.");
  if (!isCalendarDate(input.date) || input.date < order.date || !isCalendarDate(input.expires))
    throw new Error("Revisa la fecha de recepción y la caducidad.");
  if (input.expires < input.date) throw new Error("No se puede recibir un lote caducado en esta demo.");
  if (typeof input.quarantined !== "boolean") throw new Error("Selecciona la condición de recepción.");
  const existing = state.lots.find(l => l.sku === line.sku && referenceKey(l.batch) === batch);
  if (existing && (existing.expires !== input.expires || existing.quarantined !== input.quarantined))
    throw new Error("El lote existente tiene otra caducidad o condición. Revisa los datos antes de recibir.");
  if (!existing && state.lots.some(l => l.id === input.newLotId)) throw new Error("El identificador del lote ya existe.");
  const quantity = (existing?.quantity || 0) + input.quantity;
  if (!Number.isSafeInteger(quantity)) throw new Error("Cantidad fuera de rango.");
  const lot: Lot = existing ? { ...existing, quantity } : {
    id: input.newLotId, sku: line.sku, product: line.product, category: line.category,
    batch, expires: input.expires, quantity, minimum: line.minimum,
    priceCents: line.priceCents, quarantined: input.quarantined,
  };
  const { newLotId: _unused, ...receiptData } = input;
  const receipt: GoodsReceipt = { ...receiptData, reference, batch, lotId: lot.id, unitCostCents: line.unitCostCents };
  return {
    ...state,
    lots: existing ? state.lots.map(l => l.id === lot.id ? lot : l) : [...state.lots, lot],
    purchases: state.purchases.map(p => p.id === order.id ? { ...p,
      lines: p.lines.map(l => l.id === line.id ? { ...l, received: l.received + input.quantity } : l) } : p),
    receipts: [...state.receipts, receipt],
    movements: [{ id: "MOV-" + receipt.id, lotId: lot.id, quantity: input.quantity, kind: "Entrada",
      reason: "Recepción " + reference + " · " + order.reference,
      date: input.date, purchaseId: order.id, receiptId: receipt.id }, ...state.movements],
  };
}
export function restoreDemoState(raw: unknown, defaults: DemoState): DemoState {
  if (!raw || typeof raw !== "object") return defaults;
  const data = raw as Record<string, unknown>;
  const common = ["patients", "visits", "lots", "movements", "notes", "payments", "equipment"];
  if ((data["version"] !== 1 && data["version"] !== 2) || !common.every(key => Array.isArray(data[key]))) return defaults;
  if (data["version"] === 1) return { ...(data as unknown as DemoState), version: 2,
    suppliers: defaults.suppliers, purchases: defaults.purchases, receipts: [] } as DemoState;
  if (["suppliers", "purchases", "receipts"].every(key => Array.isArray(data[key]))) return data as unknown as DemoState;
  return defaults;
}
