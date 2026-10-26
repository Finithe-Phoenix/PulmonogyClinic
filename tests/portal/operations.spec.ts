import { test, expect, type Page, type Locator, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Patient, Appointment } from '../../src/app/portal/operations-api';
import type { CashShift, CashPayment } from '../../src/app/portal/cash-api';
import type { EquipmentAsset, EquipmentMaintenance } from '../../src/app/portal/equipment-api';

// Keep credentials only in memory. Authentication pages/requests must never be recorded.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120_000 });

function adminPassword(): string {
  const key = 'DEV_ADMIN_PASSWORD';
  const line = readFileSync('.local/private.env', 'utf8').split(/\r?\n/).find((value: string) => value.startsWith(key + '='));
  const password = line?.slice(key.length + 1).trim();
  if (!password) throw new Error('Falta DEV_ADMIN_PASSWORD en .local/private.env para el acceso local real.');
  return password;
}

async function signInFromCurrentPage(page: Page) {
  if (await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  // A fresh context shows the form; after reload Keycloak may resume its existing SSO session.
  await expect.poll(async () => (await page.locator('#username').isVisible()) ||
    (await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).isVisible()), { timeout: 25000 }).toBe(true);
  if (await page.locator('#username').isVisible()) {
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill(adminPassword());
    await page.locator('#kc-login').click();
  }
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
}

async function login(page: Page) {
  await page.goto('/');
  await signInFromCurrentPage(page);
  await expect(page.getByRole('heading', { name: 'Todo en su lugar.', exact: true })).toBeVisible();
}

async function go(page: Page, label: string) {
  const link = page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: label, exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'Abrir o cerrar navegación', exact: true }).click();
  const initialPatients = label === 'Pacientes' ? page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/v1/operations/patients' &&
      url.searchParams.get('limit') === '26' && url.searchParams.get('offset') === '0' && !url.searchParams.get('q');
  }) : Promise.resolve(null);
  const [initialResponse] = await Promise.all([initialPatients, link.click()]);
  const headings: Record<string,string> = {Pacientes:'Pacientes',Agenda:'Agenda y recepción',Caja:'Caja',Equipos:'Equipos'};
  await expect(page.locator('main h1')).toHaveText(headings[label] || label);
  if (initialResponse) {
    expect(initialResponse.status(), 'El directorio inicial debe terminar antes de interactuar con su formulario').toBe(200);
    expect(await initialResponse.finished()).toBeNull();
    await expect(page.getByRole('region', {name:'Pacientes registrados',exact:true})).toHaveAttribute('aria-busy','false');
    await expect(page.getByRole('region', {name:'Directorio administrativo',exact:true})
      .getByRole('button', {name:'Buscar',exact:true})).toBeEnabled();
  }
}

const uuidSuffix = () => randomUUID().slice(0, 12).replaceAll('-', '').toUpperCase();
const mxn = (cents: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
const decimalPesos = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
function mexicoDate(days = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + days * 86400000));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value['year']}-${value['month']}-${value['day']}`;
}
function responseFor(page: Page, method: string, path: string): Promise<Response> {
  return page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
}
async function submit<T>(page: Page, path: string, action: () => Promise<unknown>, expectedStatus = 200): Promise<T> {
  const [response] = await Promise.all([responseFor(page, 'POST', path), action()]);
  expect(response.status(), `POST ${path} debe confirmar la operación`).toBe(expectedStatus);
  return await response.json() as T;
}
async function closeDialog(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function patientDraft(page: Page, reference: string, fullName: string) {
  await page.getByRole('button', { name: 'Nuevo paciente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Referencia/ }).fill(reference);
  await dialog.getByLabel('Nombre completo', { exact: true }).fill(fullName);
  await dialog.getByLabel('Fecha de nacimiento', { exact: true }).fill('1990-05-17');
  await dialog.getByRole('checkbox', { name: 'Confirmo que estos datos son ficticios y no pertenecen a un paciente real.', exact: true }).check();
  return dialog;
}

test('pacientes: revisión de homónimos, agenda, llegada, consulta e historial', async ({ page }) => {
  await login(page);
  const suffix = uuidSuffix();
  const reference = 'PAC-E2E-' + suffix, duplicateReference = 'PAC-HOM-' + suffix;
  const name = 'Persona sintética ' + suffix, service = 'Consulta sintética ' + suffix;
  await go(page, 'Pacientes');
  let dialog = await patientDraft(page, reference, name);
  await dialog.getByRole('button', { name: 'Revisar coincidencias', exact: true }).click();
  await expect(dialog.getByText('No encontramos coincidencias por nombre o por nacimiento y teléfono.', { exact: true })).toBeVisible();
  const original = await submit<Patient>(page, '/api/v1/operations/patients', () =>
    dialog.getByRole('button', { name: 'Registrar paciente', exact: true }).click(), 201);
  expect(original.reference).toBe(reference);
  expect(original.synthetic).toBe(true);
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  await closeDialog(page);

  // Same synthetic identity is intentionally reviewed, never silently merged.
  dialog = await patientDraft(page, duplicateReference, name);
  await dialog.getByRole('button', { name: 'Revisar coincidencias', exact: true }).click();
  const candidates = dialog.getByRole('region', { name: 'Posibles coincidencias', exact: true });
  await expect(candidates).toContainText(reference);
  await expect(dialog.getByRole('button', { name: 'Registrar paciente', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Revisé las coincidencias y confirmo que este registro debe mantenerse independiente.', exact: true }).check();
  const duplicate = await submit<Patient>(page, '/api/v1/operations/patients', () =>
    dialog.getByRole('button', { name: 'Registrar paciente', exact: true }).click(), 201);
  expect(duplicate.id).not.toBe(original.id);
  expect(duplicate.reference).toBe(duplicateReference);
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  await closeDialog(page);

  await go(page, 'Agenda');
  await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Buscar paciente para la cita', exact: true }).fill(reference);
  await dialog.getByRole('button', { name: 'Buscar', exact: true }).click();
  await dialog.getByRole('button', { name: `Seleccionar a ${name}, referencia ${reference}`, exact: true }).click();
  const day = mexicoDate(1);
  await dialog.getByLabel('Fecha y hora · Ciudad de México', { exact: true }).fill(day + 'T10:15');
  await dialog.getByLabel('Duración en minutos', { exact: true }).fill('30');
  await dialog.getByLabel('Servicio', { exact: true }).fill(service);
  await dialog.getByRole('textbox', { name: /^Profesional/ }).fill('MED-E2E-' + suffix);
  await dialog.getByRole('textbox', { name: /^Consultorio o equipo/ }).fill('SALA-E2E-' + suffix);
  const appointment = await submit<Appointment>(page, '/api/v1/operations/appointments', () =>
    dialog.getByRole('button', { name: 'Confirmar reserva', exact: true }).click(), 201);
  expect(appointment.patientId).toBe(original.id);
  expect(appointment.status).toBe('BOOKED');
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(dialog.getByText('Programada', { exact: true })).toBeVisible();

  for (const [button, status, label] of [
    ['Registrar llegada', 'ARRIVED', 'En espera'],
    ['Iniciar consulta', 'IN_CONSULTATION', 'En consulta'],
    ['Finalizar consulta', 'COMPLETED', 'Finalizada'],
  ]) {
    const changed = await submit<Appointment>(page, `/api/v1/operations/appointments/${appointment.id}/transition`, () =>
      dialog.getByRole('button', { name: button, exact: true }).click());
    expect(changed.status).toBe(status);
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }
  for (const text of ['Cita registrada', 'Programada → En espera', 'En espera → En consulta', 'En consulta → Finalizada']) {
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  }
  await closeDialog(page);
  const appointmentRow = page.getByRole('region', { name: 'Citas de la jornada', exact: true }).getByRole('row').filter({ hasText: reference });
  await expect(appointmentRow).toContainText('Finalizada');

  await go(page, 'Pacientes');
  const directory = page.getByRole('region', {name:'Directorio administrativo',exact:true});
  const searchInput = directory.getByRole('textbox', { name: 'Buscar paciente por nombre o referencia', exact: true });
  await searchInput.fill(reference);
  await expect(searchInput).toHaveValue(reference);
  const [filteredResponse] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === '/api/v1/operations/patients' &&
        url.searchParams.get('q') === reference && url.searchParams.get('offset') === '0';
    }),
    directory.getByRole('button', {name:'Buscar',exact:true}).click(),
  ]);
  expect(filteredResponse.status()).toBe(200);
  expect(await filteredResponse.finished()).toBeNull();
  const filteredPatients = await filteredResponse.json() as {items: Patient[]};
  expect(filteredPatients.items.map(patient => patient.id)).toEqual([original.id]);
  await expect(searchInput).toHaveValue(reference);
  await expect(page.getByRole('region', {name:'Pacientes registrados',exact:true})).toHaveAttribute('aria-busy','false');
  const patientRow = page.getByRole('region', { name: 'Pacientes registrados', exact: true }).getByRole('row').filter({ hasText: reference });
  await expect(patientRow).toHaveCount(1);
  await patientRow.getByRole('button', { name: 'Ver a ' + name, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Citas registradas', exact: true })).toBeVisible();
  await expect(dialog.locator('.compact-list')).toContainText(service);
  await expect(dialog.locator('.compact-list')).toContainText('Finalizada');
  await closeDialog(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function cashPayment(page: Page, shiftId: string, reference: string, pesos: string, method: 'CASH' | 'CARD') {
  await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Referencia única del cobro', { exact: true }).fill(reference);
  await dialog.getByLabel('Importe · MXN', { exact: true }).fill(pesos);
  await dialog.getByRole('combobox', { name: 'Método de pago', exact: true }).selectOption(method);
  const result = await submit<CashPayment>(page, `/api/v1/cash/shifts/${shiftId}/payments`, () =>
    dialog.getByRole('button', { name: 'Confirmar cobro', exact: true }).click(), 201);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return result;
}
function paymentRow(page: Page, reference: string): Locator {
  return page.getByRole('region', { name: 'Cobros del turno', exact: true }).getByRole('row').filter({ hasText: reference });
}
async function cashClose(page: Page, shiftId: string, pesos: string, reason: string): Promise<CashShift> {
  await page.getByRole('button', { name: 'Conciliar y cerrar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Efectivo contado · MXN', { exact: true }).fill(pesos);
  await dialog.getByLabel('Observaciones y motivo de cierre', { exact: true }).fill(reason);
  await expect(dialog.getByRole('button', { name: 'Confirmar cierre', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Revisé el conteo y confirmo el cierre definitivo de este turno.', exact: true }).check();
  return submit<CashShift>(page, `/api/v1/cash/shifts/${shiftId}/close`, () =>
    dialog.getByRole('button', { name: 'Confirmar cierre', exact: true }).click());
}

/** Only the exact synthetic shift created by this test can be closed by cleanup. */
async function cleanupOwnedShift(page: Page, owned: { id: string; reference: string }) {
  await page.goto('/');
  await page.reload();
  await signInFromCurrentPage(page);
  const [response] = await Promise.all([
    responseFor(page, 'GET', `/api/v1/cash/shifts/${owned.id}`),
    page.goto('/#/caja/' + owned.id),
  ]);
  if (response.status() !== 200) throw new Error('No se pudo comprobar el turno propio antes de su limpieza.');
  const shift = await response.json() as CashShift;
  if (shift.id !== owned.id || shift.reference !== owned.reference) throw new Error('Identidad de turno distinta: limpieza cancelada.');
  if (shift.status === 'CLOSED') return;
  await expect(page.getByRole('heading', { name: owned.reference, exact: true })).toBeVisible();
  // An uncertain write from this test retains its original key; resolve it before closure.
  const retry = page.getByRole('button', { name: 'Reintentar operación', exact: true });
  if (await retry.isVisible()) {
    await retry.click();
    await expect(retry).toHaveCount(0);
    const [result] = await Promise.all([
      responseFor(page, 'GET', `/api/v1/cash/shifts/${owned.id}`),
      page.getByRole('button', { name: 'Actualizar', exact: true }).click(),
    ]);
    if (result.status() !== 200) throw new Error('No se pudo actualizar el turno propio después del reintento.');
    const current = await result.json() as CashShift;
    if (current.id !== owned.id || current.reference !== owned.reference) throw new Error('Identidad de turno distinta después del reintento.');
    if (current.status === 'CLOSED') return;
    await cashClose(page, owned.id, decimalPesos(current.expectedCashCents), 'Cierre de limpieza del turno sintético creado por E2E ' + owned.reference);
  } else {
    await cashClose(page, owned.id, decimalPesos(shift.expectedCashCents), 'Cierre de limpieza del turno sintético creado por E2E ' + owned.reference);
  }
}

async function readCurrentCashPage(page: Page, action: () => Promise<unknown>): Promise<Response | null> {
  // Observe before navigation/refresh. A transport failure emits requestfailed, not response;
  // request.response() reports that distinction without waiting for an impossible response event.
  const [request] = await Promise.all([
    page.waitForRequest(request => {
      const url = new URL(request.url());
      return request.method() === 'GET' && url.pathname === '/api/v1/cash/shifts' &&
        url.searchParams.get('limit') === '2' && url.searchParams.get('offset') === '0';
    }),
    action(),
  ]);
  return request.response();
}

test('caja: centavos exactos, segundo método, reverso, diferencia y persistencia', async ({ page }, testInfo) => {
  await login(page);
  const suffix = uuidSuffix(), reference = 'CAJA-E2E-' + suffix;
  const cashReference = 'EFE-E2E-' + suffix, cardReference = 'TAR-E2E-' + suffix;
  let owned: { id: string; reference: string } | null = null;
  let closed = false;
  try {
    let activeResponse = await readCurrentCashPage(page, () => go(page, 'Caja'));
    if (activeResponse === null) {
      // Observed in the mobile regression: both list reads failed in transport. This is not a
      // listener race. Permit exactly one explicit read-only UI recovery, never retry HTTP errors.
      testInfo.annotations.push({type:'transport-retry',description:'Falló el transporte del GET de caja; se usó Actualizar una sola vez antes de crear el turno propio.'});
      await page.locator('main > .notice.error').getByRole('button', {name:'Cerrar aviso de error',exact:true}).click();
      activeResponse = await readCurrentCashPage(page, () =>
        page.locator('main > .workspace-meta').getByRole('button', {name:'Actualizar',exact:true}).click());
    }
    if (activeResponse === null) throw new Error('La lectura del turno actual volvió a fallar en transporte; no se abrió ni modificó ningún turno.');
    expect(activeResponse.status()).toBe(200);
    const current = await activeResponse.json() as { items: CashShift[] };
    const existing = current.items.find(shift => shift.status === 'OPEN');
    expect(existing, 'Hay un turno abierto ajeno a este test. No se modifica ni se cierra automáticamente; concílialo manualmente antes de ejecutar caja.').toBeUndefined();

    await page.getByRole('button', { name: 'Abrir turno', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Referencia del turno', { exact: true }).fill(reference);
    await dialog.getByLabel('Fondo inicial · MXN', { exact: true }).fill('1000.00');
    const created = await submit<CashShift>(page, '/api/v1/cash/shifts', () =>
      dialog.getByRole('button', { name: 'Abrir turno', exact: true }).click(), 201);
    // Record ownership before any UI assertion, so a rendering failure still cleans up safely.
    if (created.reference === reference && /^[0-9a-f-]{36}$/i.test(created.id)) owned = { id: created.id, reference };
    expect(owned).not.toBeNull();
    expect(created.openingFloatCents).toBe(100000);
    await expect(page.getByRole('heading', { name: reference, exact: true })).toBeVisible();
    const cash = await cashPayment(page, created.id, cashReference, '123.45', 'CASH');
    const card = await cashPayment(page, created.id, cardReference, '50.10', 'CARD');
    expect(cash.amountCents).toBe(12345); expect(cash.method).toBe('CASH');
    expect(card.amountCents).toBe(5010); expect(card.method).toBe('CARD');
    await expect(paymentRow(page, cashReference)).toContainText(mxn(12345));
    await expect(paymentRow(page, cardReference)).toContainText(mxn(5010));
    await expect(page.getByRole('region', { name: 'Conciliación de efectivo', exact: true })).toContainText(mxn(112345));

    const reverseReason = 'Corrección sintética E2E ' + suffix;
    await paymentRow(page, cardReference).getByRole('button', { name: 'Revertir cobro ' + cardReference, exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo del reverso', { exact: true }).fill(reverseReason);
    const reversed = await submit<CashPayment>(page, `/api/v1/cash/payments/${card.id}/reverse`, () =>
      dialog.getByRole('button', { name: 'Confirmar reverso', exact: true }).click());
    expect(reversed.reversed).toBe(true); expect(reversed.amountCents).toBe(5010);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(paymentRow(page, cardReference)).toContainText('Revertido');
    await expect(paymentRow(page, cardReference)).toContainText(reverseReason);
    await expect(paymentRow(page, cardReference)).toContainText(mxn(5010));

    const result = await cashClose(page, created.id, '1120.00', 'Conteo sintético E2E con faltante de 3.45 ' + suffix);
    closed = result.status === 'CLOSED';
    expect(result.expectedCashCents).toBe(112345);
    expect(result.countedCashCents).toBe(112000);
    expect(result.differenceCents).toBe(-345);
    expect(result.cashTotalCents).toBe(12345); expect(result.cardTotalCents).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Faltante: ' + mxn(-345), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar cobro', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await login(page);
    await go(page, 'Caja');
    await page.getByRole('link', { name: 'Ver turno ' + reference, exact: true }).click();
    await expect(page.getByRole('heading', { name: reference, exact: true })).toBeVisible();
    await expect(page.getByText('Faltante: ' + mxn(-345), { exact: true })).toBeVisible();
    await expect(paymentRow(page, cardReference)).toContainText('Revertido');
    await expect(paymentRow(page, cashReference)).toContainText(mxn(12345));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (owned && !closed) {
      try { await cleanupOwnedShift(page, owned); }
      catch {
        testInfo.annotations.push({ type: 'cleanup-required', description: `No se pudo cerrar el turno sintético propio ${owned.reference} (${owned.id}). Revisarlo manualmente; no se tocó ningún turno ajeno.` });
      }
    }
  }
});

test('equipos: alta, mantenimiento trazable y regreso a disponible', async ({ page }) => {
  await login(page);
  const suffix = uuidSuffix(), reference = 'EQ-E2E-' + suffix, name = 'Equipo sintético ' + suffix;
  const description = 'Revisión sintética demostrativa ' + suffix + '; sin afirmar calibración ni certificación.';
  await go(page, 'Equipos');
  await page.getByRole('button', { name: 'Registrar equipo', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Referencia interna/ }).fill(reference);
  await dialog.getByRole('textbox', { name: /^Número de serie/ }).fill('SERIE-SYN-' + suffix);
  await dialog.getByRole('textbox', { name: /^Nombre del equipo/ }).fill(name);
  await dialog.getByRole('textbox', { name: /^Ubicación/ }).fill('Sala sintética ' + suffix);
  const asset = await submit<EquipmentAsset>(page, '/api/v1/equipment/assets', () =>
    dialog.getByRole('button', { name: 'Registrar equipo', exact: true }).click(), 201);
  expect(asset.reference).toBe(reference); expect(asset.status).toBe('AVAILABLE');
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Cambiar disponibilidad', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Nueva disponibilidad/ }).selectOption('MAINTENANCE');
  await dialog.getByRole('textbox', { name: /^Motivo del cambio/ }).fill('Revisión sintética programada ' + suffix);
  const unavailable = await submit<EquipmentAsset>(page, `/api/v1/equipment/assets/${asset.id}/status`, () =>
    dialog.getByRole('button', { name: 'Confirmar disponibilidad', exact: true }).click());
  expect(unavailable.status).toBe('MAINTENANCE');
  await expect(dialog.getByText('En mantenimiento', { exact: true })).toBeVisible();
  await expect(dialog.getByText('La agenda no permite nuevas reservas ni iniciar citas con la referencia de este equipo. Revisa las citas que ya lo tengan asignado.', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Registrar mantenimiento', exact: true }).click();
  await dialog.getByLabel(/^Fecha de la intervención/).fill(mexicoDate());
  await dialog.getByLabel(/^Próxima intervención/).fill(mexicoDate(30));
  await dialog.getByRole('textbox', { name: /^Responsable de la intervención/ }).fill('Responsable sintético ' + suffix);
  await dialog.getByRole('textbox', { name: /^Trabajo realizado/ }).fill(description);
  const maintenance = await submit<EquipmentMaintenance>(page, `/api/v1/equipment/assets/${asset.id}/maintenance`, () =>
    dialog.getByRole('button', { name: 'Guardar intervención', exact: true }).click(), 201);
  expect(maintenance.assetId).toBe(asset.id); expect(maintenance.description).toBe(description);
  await expect(dialog.getByRole('heading', { name: 'Historial de mantenimiento', exact: true })).toBeVisible();
  await expect(dialog.locator('clinic-equipment-history')).toContainText(description);

  await dialog.getByRole('button', { name: 'Cambiar disponibilidad', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Nueva disponibilidad/ }).selectOption('AVAILABLE');
  await dialog.getByRole('textbox', { name: /^Motivo del cambio/ }).fill('Revisión sintética terminada ' + suffix);
  const available = await submit<EquipmentAsset>(page, `/api/v1/equipment/assets/${asset.id}/status`, () =>
    dialog.getByRole('button', { name: 'Confirmar disponibilidad', exact: true }).click());
  expect(available.status).toBe('AVAILABLE');
  await expect(dialog.getByText('Disponible', { exact: true })).toBeVisible();
  await closeDialog(page);

  // Leave the module and read the saved asset and history again from the API.
  await go(page, 'Pacientes'); await go(page, 'Equipos');
  await page.getByRole('searchbox', { name: 'Buscar equipos', exact: true }).fill(reference);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const row = page.locator(`tr[data-reference="${reference}"]`);
  await expect(row).toContainText('Disponible');
  await row.getByRole('button', { name: 'Ver equipo ' + name, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('clinic-equipment-history')).toContainText(description);
  await expect(dialog.getByText('Disponible', { exact: true })).toBeVisible();
  await closeDialog(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
