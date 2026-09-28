import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/app/seed.ts";
import { addSupplier, createPurchase, receivePurchase, cancelPurchase, purchaseStatus,
  purchaseTotal, eligibleFEFO, dispense, restoreDemoState } from "../src/app/domain.ts";
import type { PurchaseDraft, ReceiptInput } from "../src/app/domain.ts";

const draft: PurchaseDraft = { id: "PO-NEW", reference: "OC-NEW", supplierId: "SUP-001",
  date: "2026-09-28", expectedDate: "2026-10-02",
  lines: [{ id: "NEW-LINE", sku: "MED-DEMO-01", ordered: 10, unitCostCents: 20000 }] };
const delivery: ReceiptInput = { id: "REC-01", reference: "REC-DEMO-01", purchaseId: "OC-001", lineId: "LINE-001",
  date: "2026-09-28", batch: "NEW-BATCH", expires: "2027-01-30", quantity: 6, quarantined: false, newLotId: "NEW-LOT" };

test("crear una orden conserva existencias y caja; los costos históricos se copian", () => {
  const before = seed(); const state = createPurchase(before, draft);
  assert.equal(state.lots, before.lots); assert.equal(state.payments, before.payments);
  assert.equal(state.movements.length, 0);
  const order = state.purchases.at(-1)!;
  assert.equal(purchaseStatus(order), "Pendiente"); assert.equal(purchaseTotal(order), 200000);
  assert.equal(before.purchases.length, 1); assert.equal(order.lines[0].received, 0);
  assert.equal(order.lines[0].product, before.lots[0].product);
});

test("las órdenes validan proveedor, fechas, cantidades, importes y referencias", () => {
  const state = seed();
  assert.throws(() => createPurchase(state, { ...draft, supplierId: "missing" }), /proveedor/);
  assert.throws(() => createPurchase(state, { ...draft, expectedDate: "2026-02-30" }), /fechas/);
  assert.throws(() => createPurchase(state, { ...draft, expectedDate: "2026-09-27" }), /fechas/);
  assert.throws(() => createPurchase(state, { ...draft, lines: [] }), /producto/);
  assert.throws(() => createPurchase(state, { ...draft, lines: [...draft.lines, { ...draft.lines[0], id: "duplicate" }] }), /una sola vez/);
  for (const ordered of [0, -1, 0.5, NaN])
    assert.throws(() => createPurchase(state, { ...draft, lines: [{ ...draft.lines[0], ordered }] }));
  assert.throws(() => createPurchase(state, { ...draft, lines: [{ ...draft.lines[0], unitCostCents: 0 }] }));
  assert.throws(() => createPurchase(state, { ...draft, lines: [{ ...draft.lines[0], ordered: Number.MAX_SAFE_INTEGER }] }), /rango/);
  const after = createPurchase(state, draft);
  assert.throws(() => createPurchase(after, { ...draft, id: "another", reference: " oc-new " }), /existe/);
});

test("las entregas parciales crean un lote, actualizan saldo y conservan trazabilidad", () => {
  const before = seed(); const partial = receivePurchase(before, delivery);
  assert.equal(purchaseStatus(partial.purchases[0]), "Parcial");
  assert.equal(partial.purchases[0].lines[0].received, 6);
  assert.equal(purchaseTotal(partial.purchases[0], true), 280000);
  assert.equal(partial.lots.find(l => l.id === "NEW-LOT")!.quantity, 6);
  assert.equal(partial.movements[0].receiptId, delivery.id);
  assert.equal(partial.movements[0].purchaseId, "OC-001");
  assert.equal(partial.receipts[0].unitCostCents, 20000);
  const complete = receivePurchase(partial, { ...delivery, id: "REC-02", reference: "REC-DEMO-02", quantity: 14, newLotId: "IGNORED-ID" });
  assert.equal(purchaseStatus(complete.purchases[0]), "Recibida");
  assert.equal(complete.lots.filter(l => l.batch === "NEW-BATCH").length, 1);
  assert.equal(complete.lots.find(l => l.id === "NEW-LOT")!.quantity, 20);
  assert.equal(complete.receipts.length, 2); assert.equal(complete.movements.length, 2);
  assert.equal(before.purchases[0].lines[0].received, 0);
});

test("repetir un folio con los mismos datos no duplica stock; datos diferentes se rechazan", () => {
  const state = receivePurchase(seed(), delivery);
  assert.equal(receivePurchase(state, { ...delivery, id: "retry", newLotId: "retry-lot" }), state);
  assert.throws(() => receivePurchase(state, { ...delivery, id: "retry", quantity: 7 }), /datos distintos/);
  assert.throws(() => receivePurchase(state, { ...delivery, reference: "DIFFERENT" }), /datos distintos/);
  assert.equal(state.lots.find(l => l.id === "NEW-LOT")!.quantity, 6);
});

test("una recepción inválida no altera ninguna parte del estado", () => {
  const state = seed(); const snapshot = structuredClone(state);
  for (const patch of [{ quantity: 21 }, { quantity: 0 }, { expires: "2026-09-27" },
    { expires: "2027-02-30" }, { date: "2026-09-27" }, { lineId: "missing" }, { batch: " " }]) {
    assert.throws(() => receivePurchase(state, { ...delivery, ...patch }));
    assert.deepEqual(state, snapshot);
  }
});

test("un lote existente no cambia su caducidad ni se libera su cuarentena al recibir", () => {
  const state = receivePurchase(seed(), { ...delivery, quarantined: true });
  assert.throws(() => receivePurchase(state, { ...delivery, id: "rec2", reference: "REC-02" }), /otra caducidad o condición/);
  assert.throws(() => receivePurchase(state, { ...delivery, id: "rec2", reference: "REC-02", quarantined: true, expires: "2027-02-28" }), /otra caducidad o condición/);
  assert(!eligibleFEFO(state.lots, "MED-DEMO-01", delivery.date).some(l => l.id === "NEW-LOT"));
  assert.throws(() => dispense(state.lots, "NEW-LOT", 1, delivery.date), /cuarentena/);
});

test("cancelar un saldo parcial conserva recepciones y stock, y bloquea entregas nuevas", () => {
  const partial = receivePurchase(seed(), delivery);
  assert.throws(() => cancelPurchase(partial, "OC-001", " "), /motivo/);
  const cancelled = cancelPurchase(partial, "OC-001", "Cancelar saldo de ejemplo");
  assert.equal(purchaseStatus(cancelled.purchases[0]), "Cancelada");
  assert.equal(cancelled.lots, partial.lots); assert.equal(cancelled.receipts, partial.receipts);
  assert.equal(cancelled.purchases[0].lines[0].received, 6);
  assert.throws(() => receivePurchase(cancelled, { ...delivery, id: "second", reference: "REC-02" }), /cancelada/);
  assert.equal(receivePurchase(cancelled, delivery), cancelled);
  const complete = receivePurchase(seed(), { ...delivery, quantity: 20 });
  assert.throws(() => cancelPurchase(complete, "OC-001", "No procede"), /saldo pendiente/);
});

test("un proveedor requiere identidad propia y referencia única normalizada", () => {
  const state = addSupplier(seed(), { id: "new", name: "Proveedor ficticio", reference: " prov-03 " });
  assert.equal(state.suppliers.at(-1)!.reference, "PROV-03");
  assert.throws(() => addSupplier(state, { id: "other", name: "Otro", reference: "prov-03" }), /referencia/);
  assert.throws(() => addSupplier(state, { id: "other", name: " ", reference: "prov-04" }), /nombre/);
});

test("la migración de v1 conserva pacientes, notas, cobros y existencias modificadas", () => {
  const { suppliers: _s, purchases: _p, receipts: _r, ...legacy } = seed();
  legacy.lots[0].quantity = 3;
  legacy.patients[0].name = "Nombre de ejemplo editado";
  const old = { ...legacy, version: 1 };
  const upgraded = restoreDemoState(old, seed());
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.lots[0].quantity, 3);
  assert.deepEqual(upgraded.patients, old.patients);
  assert.deepEqual(upgraded.notes, old.notes);
  assert.deepEqual(upgraded.payments, old.payments);
  assert.equal(upgraded.purchases.length, 1);
  assert.equal(restoreDemoState(upgraded, seed()), upgraded);
  assert.equal(restoreDemoState({ version: 9 }, seed()).version, 2);
});
