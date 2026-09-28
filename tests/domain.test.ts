import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addVisit,
  appendAddendum,
  cashTotal,
  closeNote,
  dispense,
  eligibleFEFO,
  postPayment,
  receive,
  toCSV,
} from "../src/app/domain.ts";
import type { ClinicalNote, Lot, Payment, Visit } from "../src/app/domain.ts";
const day = "2026-09-28";
const lot: Lot = {
  id: "l1",
  product: "Producto ficticio",
  category: "Farmacia",
  sku: "x",
  batch: "a",
  expires: "2027-01-01",
  quantity: 1,
  minimum: 1,
  priceCents: 100,
  quarantined: false,
};
const payment: Payment = {
  id: "p1",
  reference: "r1",
  patientId: "fake",
  concept: "Prueba",
  amountCents: 10001,
  method: "Efectivo",
  date: day,
  reversed: false,
};
const note: ClinicalNote = {
  id: "n1",
  patientId: "fake",
  date: day,
  reason: "Ejemplo",
  history: "Ficticio",
  assessment: "Demostración",
  plan: "Sin validez clínica",
  status: "Borrador",
  addenda: [],
};
const visit: Visit = {
  id: "v1",
  patientId: "fake",
  date: day,
  time: "10:20",
  service: "Ejemplo",
  status: "Confirmada",
  externalRef: "Simulada",
};
test("la última unidad se entrega una sola vez en el estado secuencial de la demo", () => {
  const after = dispense([lot], lot.id, 1, day);
  assert.equal(after[0].quantity, 0);
  assert.throws(() => dispense(after, lot.id, 1, day), /existencias/);
  assert.equal(lot.quantity, 1);
});
test("no se entrega un lote vencido ni en cuarentena", () => {
  assert.throws(
    () => dispense([{ ...lot, expires: "2026-09-27" }], "l1", 1, day),
    /caducado/,
  );
  assert.throws(
    () => dispense([{ ...lot, quarantined: true }], "l1", 1, day),
    /cuarentena/,
  );
});
test("no se aceptan cantidades negativas, cero, fracciones ni NaN", () => {
  for (const qty of [-1, 0, 0.5, NaN, Infinity])
    assert.throws(() => receive([lot], "l1", qty), /entero/);
  assert.throws(() => dispense([lot], "l1", -1, day));
});
test("una entrada incrementa solo el lote elegido sin mutar el original", () => {
  const other = { ...lot, id: "l2", quantity: 7 };
  const after = receive([lot, other], "l1", 5);
  assert.equal(after[0].quantity, 6);
  assert.equal(after[1].quantity, 7);
  assert.equal(lot.quantity, 1);
});
test("FEFO excluye lotes bloqueados, vencidos y agotados y ordena los aptos", () => {
  const lots = [
    lot,
    { ...lot, id: "early", expires: "2026-10-01" },
    { ...lot, id: "expired", expires: "2025-01-01" },
    { ...lot, id: "blocked", quarantined: true },
    { ...lot, id: "empty", quantity: 0 },
  ];
  assert.deepEqual(
    eligibleFEFO(lots, "x", day).map((l) => l.id),
    ["early", "l1"],
  );
});
test("el horario ocupado no se duplica y una cita cancelada libera ese horario de demo", () => {
  assert.throws(() => addVisit([visit], { ...visit, id: "v2" }), /ocupado/);
  assert.equal(
    addVisit([{ ...visit, status: "Cancelada" }], { ...visit, id: "v2" })
      .length,
    2,
  );
  assert.equal(
    addVisit([visit], { ...visit, id: "v2", date: "2026-09-29" }).length,
    2,
  );
});
test("hora inválida se rechaza", () => {
  assert.throws(() => addVisit([], { ...visit, time: "25:00" }), /inválida/);
});
test("una referencia de cobro no se registra dos veces incluso después de reversarla", () => {
  assert.throws(
    () => postPayment([payment], { ...payment, id: "p2" }),
    /duplicó/,
  );
  assert.throws(
    () => postPayment([{ ...payment, reversed: true }], payment),
    /duplicó/,
  );
});
test("el cierre suma centavos exactos y excluye tarjeta, reversos y otros días", () => {
  assert.equal(
    cashTotal(
      [
        payment,
        { ...payment, id: "p2", amountCents: 2999 },
        { ...payment, method: "Tarjeta" },
        { ...payment, reversed: true },
        { ...payment, date: "2026-09-27" },
      ],
      day,
    ),
    13000,
  );
});
test("importes inválidos no pasan al libro de caja", () => {
  for (const amountCents of [0, -5, 1.5, NaN, Infinity])
    assert.throws(() => postPayment([], { ...payment, amountCents }));
});
test("no se cierra una nota incompleta; una adenda conserva el texto original", () => {
  assert.throws(() => closeNote({ ...note, plan: " " }), /Completa/);
  const closed = closeNote(note);
  const amended = appendAddendum(
    closed,
    "Corrección ficticia",
    "2026-09-28T10:00:00Z",
  );
  assert.equal(amended.reason, note.reason);
  assert.equal(amended.status, "Cerrada");
  assert.equal(amended.addenda.length, 1);
  assert.equal(closed.addenda.length, 0);
  assert.throws(() => appendAddendum(note, "texto", day), /cerradas/);
});
test("el CSV protege celdas de fórmula y conserva comas, comillas y saltos", () => {
  const csv = toCSV([
    ['=HYPERLINK("x")', "Texto, con coma", "Normal", "\n@SUM(A1)"],
  ]);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"Texto, con coma"'));
  assert.ok(csv.includes('"\'\n@SUM(A1)"'));
});
