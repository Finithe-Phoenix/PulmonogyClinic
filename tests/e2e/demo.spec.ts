import { test, expect } from '@playwright/test';

const base = '/PulmonogyClinic/';
test('sitio adaptable y navegación de los ocho módulos sin errores', async ({ page, isMobile }, info) => {
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
  for (const label of ['Recepción', 'Pacientes', 'Consultas', 'Inventario', 'Equipos', 'Caja', 'Plan del proyecto', 'Resumen']) {
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
