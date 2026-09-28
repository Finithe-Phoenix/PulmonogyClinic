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
  version: 1;
  patients: Patient[];
  visits: Visit[];
  lots: Lot[];
  movements: Movement[];
  notes: ClinicalNote[];
  payments: Payment[];
  equipment: Equipment[];
}
export const DEMO_DATE = "2026-09-28";
export function requireQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("La cantidad debe ser un entero mayor que cero.");
}
export function isExpired(lot: Lot, date: string): boolean {
  return lot.expires < date;
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
    !/^\d{4}-\d{2}-\d{2}$/.test(visit.date) ||
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
