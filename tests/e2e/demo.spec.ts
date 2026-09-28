import { test, expect } from '@playwright/test';
import { seed } from '../../src/app/seed';

const base = '/PulmonogyClinic/';
test('sitio adaptable y navegación de los nueve módulos sin errores', async ({ page, isMobile }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Respirar mejor');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('link', { name: 'Consultar citas en Doctoralia' })).toHaveAttribute('href', /doctoralia\.com\.mx/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sitio.png'), fullPage: true });
  await page.screenshot({ path: info.outputPath('sitio-viewport.jpg'), type: 'jpeg', quality: 85 });
  await page.getByRole('link', { name: 'Explorar plataforma', exact: true }).click();
  await expect(page).toHaveURL(/#\/panel\/resumen$/);
  for (const label of ['Recepción', 'Pacientes', 'Consultas', 'Inventario', 'Compras', 'Equipos', 'Caja', 'Plan del proyecto', 'Resumen']) {
    if (isMobile) await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('navigation', { name: 'Módulos de gestión' }).getByRole('link', { name: new RegExp(label) }).click();
    await expect(page.locator('.breadcrumbs strong')).toHaveText(label);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label).toBe(true);
  }
  await page.reload();
  await expect(page.locator('.breadcrumbs strong')).toHaveText('Resumen');
  await page.screenshot({ path: info.outputPath('panel.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('recepción rechaza una cita duplicada y conserva una nueva al recargar', async ({ page }) => {
  await page.goto(base + '#/panel/recepcion');
  await page.getByRole('button', { name: 'Simular cita' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Hora simulada').fill('11:00');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(dialog.getByRole('alert')).toContainText('ocupado');
  await dialog.getByLabel('Hora simulada').fill('13:20');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: '13:20' })).toHaveCount(1);
});

test('inventario bloquea caducados, aplica una salida y exporta CSV', async ({ page }) => {
  await page.goto(base + '#/panel/inventario');
  const expired = page.getByRole('row').filter({ hasText: 'SIM-2603' });
  await expired.getByRole('button', { name: 'Registrar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo', { exact: true }).fill('Caso ficticio caducado');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(dialog.getByRole('alert')).toContainText('caducado');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const apt = page.getByRole('row').filter({ hasText: 'SIM-2601' });
  await apt.getByRole('button', { name: 'Registrar' }).click();
  await dialog.getByLabel('Cantidad de unidades').fill('2');
  await dialog.getByLabel('Motivo', { exact: true }).fill('Salida ficticia de prueba');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(apt.locator('td').nth(2)).toContainText('6 uds.');
  await page.reload();
  await expect(apt.locator('td').nth(2)).toContainText('6 uds.');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toBe('inventario-ficticio.csv');
});

test('consulta conserva la nota cerrada y permite una adenda', async ({ page }) => {
  await page.goto(base + '#/panel/consultas');
  const fields = ['Motivo de consulta', 'Antecedentes y evolución', 'Evaluación del profesional', 'Plan y seguimiento'];
  for (const field of fields) await page.getByLabel(field, { exact: true }).fill('Contenido ficticio: ' + field);
  await page.getByRole('button', { name: 'Cerrar nota de ejemplo', exact: true }).click();
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Agregar adenda', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo y corrección de ejemplo').fill('Corrección ficticia trazable');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(page.locator('.addendum')).toContainText('Corrección ficticia trazable');
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toHaveValue('Contenido ficticio: Motivo de consulta');
  await page.reload();
  await page.locator('.note-item').click();
  await expect(page.locator('.addendum')).toContainText('Corrección ficticia trazable');
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toBeDisabled();
});

test('caja suma, concilia y revierte un cobro sin borrarlo', async ({ page }) => {
  await page.goto(base + '#/panel/caja');
  await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Concepto', { exact: true }).fill('Cobro ficticio E2E');
  await dialog.getByLabel('Importe ilustrativo (MXN)').fill('250');
  await dialog.getByLabel('Referencia única').fill('DEMO-E2E-001');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await page.getByLabel('Efectivo contado (MXN)').fill('1250');
  await page.getByRole('button', { name: 'Conciliar efectivo' }).click();
  await expect(page.locator('.cash-result')).toContainText('sin diferencia');
  const payment = page.getByRole('row').filter({ hasText: 'DEMO-E2E-001' });
  await payment.getByRole('button', { name: 'Reversar', exact: true }).click();
  await dialog.getByLabel('Motivo del reverso').fill('Corrección de ejemplo');
  await dialog.getByRole('button', { name: 'Guardar ejemplo' }).click();
  await expect(payment).toContainText('Reversado');
  await page.getByLabel('Efectivo contado (MXN)').fill('1000');
  await page.getByRole('button', { name: 'Conciliar efectivo' }).click();
  await expect(page.locator('.cash-result')).toContainText('sin diferencia');
});

test('el navegador sin almacenamiento muestra que los cambios son temporales', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'QuotaExceededError'); };
  });
  await page.goto(base + '#/panel/equipos');
  await page.getByRole('button', { name: 'Marcar en mantenimiento' }).first().click();
  await expect(page.locator('.storage-warning')).toContainText('se pierden al recargar');
  await expect(page.locator('.toast')).toContainText('Modo temporal');
});

test('una compra de dos productos se recibe por lotes y conserva sus saldos', async ({ page }, info) => {
  await page.goto(base + '#/panel/compras');
  await page.getByRole('button', { name: 'Nueva orden', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folio de la orden').fill('OC-E2E-001');
  await dialog.getByLabel('Unidades a pedir').fill('5');
  await dialog.getByRole('button', { name: 'Agregar partida', exact: true }).click();
  await dialog.getByLabel('Producto del catálogo ficticio').selectOption('INS-001');
  await dialog.getByLabel('Unidades a pedir').fill('10');
  await dialog.getByLabel('Costo unitario ilustrativo (MXN)').fill('20');
  await dialog.getByRole('button', { name: 'Agregar partida', exact: true }).click();
  await dialog.getByRole('button', { name: 'Crear orden', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const order = page.locator('.purchase-table tbody tr').filter({ hasText: 'OC-E2E-001' });
  await expect(order).toContainText('Pendiente');
  await order.getByRole('button', { name: 'Recibir', exact: true }).click();
  await dialog.getByLabel('Folio de recepción').fill('REC-E2E-001');
  await dialog.getByLabel('Unidades recibidas').fill('3');
  await dialog.getByLabel('Lote del fabricante').fill('BATCH-E2E-001');
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(order).toContainText('Parcial');
  await expect(order).toContainText('3 / 5');
  await page.getByRole('button', { name: 'Cerrar notificación' }).click();
  expect(await page.locator('.purchase-table').evaluate(el => el.scrollWidth <= el.parentElement!.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compras.png'), fullPage: true });
  await page.goto(base + '#/panel/inventario');
  await page.getByLabel('Buscar inventario').fill('BATCH-E2E-001');
  await expect(page.getByRole('row').filter({ hasText: 'BATCH-E2E-001' })).toContainText('3 uds.');
  await page.goto(base + '#/panel/compras');
  await order.getByRole('button', { name: 'Recibir', exact: true }).click();
  await dialog.getByLabel('Folio de recepción').fill('REC-E2E-002');
  await dialog.getByLabel('Lote del fabricante').fill('BATCH-E2E-001');
  await dialog.getByLabel('Unidades recibidas').fill('3');
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('supera el saldo');
  await dialog.getByLabel('Unidades recibidas').fill('2');
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(order).toContainText('5 / 5');
  await order.getByRole('button', { name: 'Recibir', exact: true }).click();
  await dialog.getByLabel('Folio de recepción').fill('REC-E2E-003');
  await dialog.getByLabel('Unidades recibidas').fill('10');
  await dialog.getByLabel('Lote del fabricante').fill('BATCH-E2E-INS');
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(order).toContainText('Recibida');
  await page.reload();
  await expect(order).toContainText('Recibida');
  await expect(order.getByRole('button', { name: 'Recibir', exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar compras' }).click();
  expect((await download).suggestedFilename()).toBe('compras-ficticias.csv');
});

test('cancelar el pendiente conserva el lote ya recibido en cuarentena', async ({ page }) => {
  await page.goto(base + '#/panel/compras');
  const order = page.locator('.purchase-table tbody tr').filter({ hasText: 'OC-DEMO-001' });
  await order.getByRole('button', { name: 'Recibir', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Unidades recibidas').fill('5');
  await dialog.getByLabel('Lote del fabricante').fill('BATCH-E2E-HOLD');
  await dialog.getByLabel('Condición de recepción').selectOption({ label: 'Cuarentena' });
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await order.getByRole('button', { name: 'Cancelar pendiente', exact: true }).click();
  await dialog.getByLabel('Motivo de cancelación').fill('Saldo cancelado de ejemplo');
  await dialog.getByRole('button', { name: 'Guardar ejemplo', exact: true }).click();
  await expect(order).toContainText('Cancelada');
  await expect(order).toContainText('5 / 20');
  await page.goto(base + '#/panel/inventario');
  await page.getByLabel('Buscar inventario').fill('BATCH-E2E-HOLD');
  const lot = page.getByRole('row').filter({ hasText: 'BATCH-E2E-HOLD' });
  await expect(lot).toContainText('5 uds.');
  await expect(lot).toContainText('Cuarentena');
  await lot.getByRole('button', { name: 'Registrar', exact: true }).click();
  await dialog.getByLabel('Motivo', { exact: true }).fill('Salida ficticia bloqueada');
  await dialog.getByRole('button', { name: 'Guardar ejemplo', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('cuarentena');
});

test('los ejemplos guardados en v1 se conservan al migrar y agregar un proveedor', async ({ page }) => {
  const { suppliers: _s, purchases: _p, receipts: _r, ...legacy } = seed();
  legacy.lots[0].quantity = 3;
  await page.goto(base);
  await page.evaluate(data => localStorage.setItem('pulmonogy.demo.v1', JSON.stringify(data)), { ...legacy, version: 1 });
  await page.reload();
  await page.goto(base + '#/panel/inventario');
  await expect(page.getByRole('row').filter({ hasText: 'SIM-2601' })).toContainText('3 uds.');
  await page.goto(base + '#/panel/compras');
  await page.getByRole('button', { name: 'Agregar proveedor', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre ficticio del proveedor').fill('Proveedor E2E');
  await dialog.getByLabel('Referencia del proveedor').fill('PROV-E2E');
  await dialog.getByRole('button', { name: 'Guardar ejemplo', exact: true }).click();
  await page.reload();
  await expect(page.locator('.supplier-list')).toContainText('Proveedor E2E · Demo');
  await page.goto(base + '#/panel/inventario');
  await expect(page.getByRole('row').filter({ hasText: 'SIM-2601' })).toContainText('3 uds.');
});
