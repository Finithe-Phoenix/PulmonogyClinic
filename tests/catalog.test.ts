import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryLot, createPurchase, receivePurchase } from '../src/app/domain.ts';
import type { InventoryLotDraft } from '../src/app/domain.ts';
import { seed } from '../src/app/seed.ts';
const date = '2026-09-28';
const draft: InventoryLotDraft = { id: 'LOT-NEW', sku: ' nuevo-001 ', batch: ' batch-new ', expires: '2028-01-31', quarantined: true,
  catalog: { product: 'Producto ficticio', category: 'Insumos', minimum: 2, priceCents: 1250 } };

test('dar de alta producto/lote comienza sin stock y permite comprarlo y recibirlo después', () => {
  const original = seed();
  const lots = createInventoryLot(original.lots, draft, date);
  assert.equal(lots.at(-1)!.quantity, 0);
  assert.equal(lots.at(-1)!.sku, 'NUEVO-001');
  assert.equal(lots.at(-1)!.batch, 'BATCH-NEW');
  assert.equal(original.lots.length, 6);
  let state = createPurchase({ ...original, lots }, { id: 'ORDER-NEW', reference: 'OC-NEW', supplierId: 'SUP-001', date, expectedDate: date,
    lines: [{ id: 'LINE-NEW', sku: 'NUEVO-001', ordered: 4, unitCostCents: 900 }] });
  state = receivePurchase(state, { id: 'REC-NEW', reference: 'REC-NEW', purchaseId: 'ORDER-NEW', lineId: 'LINE-NEW', date,
    batch: 'BATCH-NEW', expires: draft.expires, quantity: 4, quarantined: true, newLotId: 'UNUSED' });
  assert.equal(state.lots.length, lots.length);
  assert.equal(state.lots.at(-1)!.quantity, 4);
  assert.equal(state.lots.at(-1)!.quarantined, true);
  assert.equal(state.movements[0].lotId, draft.id);
});
test('otro lote conserva los datos del producto y los duplicados no alteran existencias', () => {
  const first = createInventoryLot([], draft, date);
  const second = createInventoryLot(first, { ...draft, id: 'LOT-SECOND', batch: 'SECOND', catalog: undefined }, date);
  assert.equal(second[1].product, first[0].product);
  assert.equal(second[1].priceCents, first[0].priceCents);
  assert.equal(second[1].category, first[0].category);
  assert.throws(() => createInventoryLot(first, { ...draft, id: 'another' }, date), /SKU ya existe/);
  assert.throws(() => createInventoryLot(first, { ...draft, id: 'another', catalog: undefined }, date), /lote ya existe/);
  assert.throws(() => createInventoryLot(first, { ...draft, batch: 'OTHER', catalog: undefined }, date), /identificador/);
  assert.equal(first.length, 1);
});
test('el alta rechaza SKU ausente, calendario imposible, importes inválidos y catálogo inexistente', () => {
  for (const change of [{ sku: '' }, { sku: 'BAD / CODE' }, { batch: '' }, { expires: '2026-02-30' }, { expires: '2026-09-01' }, { catalog: undefined }])
    assert.throws(() => createInventoryLot([], { ...draft, ...change }, date));
  for (const change of [{ minimum: -1 }, { minimum: 1.5 }, { priceCents: -1 }, { priceCents: 1.5 }, { priceCents: NaN }, { product: '   ' }])
    assert.throws(() => createInventoryLot([], { ...draft, catalog: { ...draft.catalog!, ...change } }, date));
});
