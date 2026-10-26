import { test, expect, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mexicoInstant, mexicoLocal, type Appointment, type Patient } from '../../src/app/portal/operations-api';

// Real local identity/PostgreSQL and synthetic UUID-scoped records. Never record credentials or bearer headers.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120_000 });
const suffix = () => randomUUID().replaceAll('-', '').toUpperCase();
function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}
function matches(request: Request, path: string, method: string) {
  return request.method() === method && new URL(request.url()).pathname === '/api/v1/' + path;
}
async function renderTurn(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function login(page: Page) {
  const key = 'DEV_ADMIN_PASSWORD';
  const line = readFileSync('.local/private.env', 'utf8').split(/\r?\n/).find(row => row.startsWith(key + '='));
  const password = line?.slice(key.length + 1).trim();
  if (!password) throw Error('Falta la credencial sintética de administración para esta prueba.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('Todo en su lugar.');
}
function sessionApi(page: Page) {
  let authorization = '';
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) authorization = request.headers()['authorization'] || authorization;
  });
  return {
    async get<T>(path: string): Promise<T> {
      await expect.poll(() => Boolean(authorization)).toBe(true);
      const response = await page.request.get('/api/v1/' + path, { headers: { Authorization: authorization } });
      expect(response.status(), 'Lectura de fixture sintético').toBe(200);
      return response.json();
    },
    async post<T>(path: string, body: unknown, status = 201): Promise<T> {
      await expect.poll(() => Boolean(authorization)).toBe(true);
      const response = await page.request.post('/api/v1/' + path, {
        headers: { Authorization: authorization, 'Idempotency-Key': randomUUID() }, data: body,
      });
      expect(response.status(), 'Escritura de fixture sintético').toBe(status);
      return response.json();
    },
  };
}
type SessionApi = ReturnType<typeof sessionApi>;
async function patient(api: SessionApi) {
  const id = suffix();
  return api.post<Patient>('operations/patients', {
    reference: 'PC-' + id, fullName: 'Persona sintética contexto ' + id,
    birthDate: '1990-05-17', phone: null, email: null, duplicateReviewed: false, synthetic: true,
  });
}
function patientUpdate(record: Patient, fullName = record.fullName) {
  return { reference: record.reference, fullName, birthDate: record.birthDate, phone: record.phone,
    email: record.email, duplicateReviewed: false, synthetic: true, expectedVersion: record.version };
}
function futureDay() {
  // Spread independent fixtures across the supported two-year window, not the busy current-day page.
  const days = 20 + parseInt(suffix().slice(0, 6), 16) % 600;
  return mexicoLocal(new Date(Date.now() + days * 86400000)).slice(0, 10);
}
async function appointment(api: SessionApi, day: string) {
  const owner = await patient(api), id = suffix();
  return api.post<Appointment>('operations/appointments', {
    patientId: owner.id, startsAt: mexicoInstant(day + 'T09:00'), durationMinutes: 30,
    service: 'Consulta sintética ' + id, practitioner: 'MED-' + id, resource: 'SALA-' + id,
    source: 'LOCAL', externalReference: null,
  });
}
function rescheduleBody(record: Appointment, localStart: string, service = record.service) {
  return { startsAt: mexicoInstant(localStart), durationMinutes: record.durationMinutes, service,
    practitioner: record.practitioner, resource: record.resource, source: record.source,
    externalReference: record.externalReference, expectedVersion: record.version };
}
async function go(page: Page, label: 'Pacientes' | 'Agenda') {
  const link = page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: label, exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'Abrir o cerrar navegación', exact: true }).click();
  await link.click();
  await expect(page.locator('main h1')).toHaveText(label === 'Agenda' ? 'Agenda y recepción' : label);
}
async function openPatient(page: Page, record: Patient) {
  await page.getByRole('textbox', { name: 'Buscar paciente por nombre o referencia', exact: true }).fill(record.reference);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver a ' + record.fullName, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: record.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Editar datos', exact: true })).toBeEnabled();
}
async function editPatient(page: Page, name: string) {
  await page.getByRole('dialog').getByRole('button', { name: 'Editar datos', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo', { exact: true }).fill(name);
  await dialog.getByRole('checkbox', { name: 'Confirmo que estos datos son ficticios y no pertenecen a un paciente real.', exact: true }).check();
  return dialog;
}
async function closeDialog(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function agendaDay(page: Page, day: string) {
  await go(page, 'Agenda');
  await page.getByLabel('Fecha de la jornada', { exact: true }).fill(day);
  await page.getByRole('region', { name: 'Jornada del consultorio', exact: true }).getByRole('button', { name: 'Actualizar', exact: true }).click();
}
async function openAppointment(page: Page, record: Appointment) {
  const row = page.getByRole('region', { name: 'Citas de la jornada', exact: true }).getByRole('row').filter({ hasText: record.patientReference });
  await row.getByRole('button', { name: /^Abrir cita de/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: record.patientName, exact: true })).toBeVisible();
  await expect(dialog.getByText('Actualizando la cita…', { exact: true })).toHaveCount(0);
  return dialog;
}
async function uiSubmit(page: Page, path: string, action: () => Promise<unknown>, status = 200) {
  const response = page.waitForResponse(result => matches(result.request(), path, 'POST'));
  await action();
  const result = await response;
  expect(result.status(), 'Respuesta al comando de la interfaz').toBe(status);
  return result.json();
}
function attempts(page: Page, path: string) {
  const bodies: { expectedVersion?: number }[] = [];
  page.on('request', request => { if (matches(request, path, 'POST')) bodies.push(request.postDataJSON()); });
  return bodies;
}

for (const editing of [false, true]) {
  test(`pacientes: cerrar durante preflight cancela ${editing ? 'la edición sin convertirla en alta' : 'el alta antes del POST'}`, async ({ page }) => {
    const api = sessionApi(page); await login(page);
    const original = editing ? await patient(api) : null;
    await go(page, 'Pacientes');
    const reference = 'PC-' + suffix(), name = 'Borrador sintético cancelado ' + suffix();
    if (original) { await openPatient(page, original); await editPatient(page, name); }
    else {
      await page.getByRole('button', { name: 'Nuevo paciente', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Nombre completo', { exact: true }).fill(name);
      await page.getByRole('dialog').getByLabel('Fecha de nacimiento', { exact: true }).fill('1990-05-17');
      await page.getByRole('dialog').getByRole('checkbox', { name: 'Confirmo que estos datos son ficticios y no pertenecen a un paciente real.', exact: true }).check();
    }
    await page.getByRole('dialog').getByRole('textbox', { name: /^Referencia/ }).fill(reference);
    const sent: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/v1/operations/patients')) sent.push(new URL(request.url()).pathname);
    });
    const ready = gate(), release = gate();
    await page.route('**/api/v1/operations/patients/duplicates?**', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      ready.open(); await release.wait; await route.fulfill({ response });
    }, { times: 1 });
    try {
      await page.getByRole('dialog').getByRole('button', { name: editing ? 'Guardar cambios' : 'Registrar paciente', exact: true }).click();
      await ready.wait; await closeDialog(page);
      const finished = page.waitForEvent('requestfinished', request => matches(request, 'operations/patients/duplicates', 'GET'));
      release.open(); await finished; await renderTurn(page);
      expect(sent).toEqual([]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const found = await api.get<{ items: Patient[] }>('operations/patients?q=' + reference);
      expect(found.items).toHaveLength(0);
      if (original) expect(await api.get<Patient>('operations/patients/' + original.id)).toEqual(original);
    } finally { release.open(); }
  });
}

test('pacientes: confirmar A después de abrir B no reemplaza B ni su historial', async ({ page }) => {
  const api = sessionApi(page); await login(page);
  const a = await patient(api), b = await patient(api), editedName = 'Corrección sintética ' + suffix();
  await go(page, 'Pacientes'); await openPatient(page, a); await editPatient(page, editedName);
  const path = `operations/patients/${a.id}/update`, ready = gate(), release = gate();
  await page.route('**/api/v1/' + path, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200);
    ready.open(); await release.wait; await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await ready.wait; await closeDialog(page);
    // Reads remain available while the original write waits for confirmation.
    await page.getByRole('textbox', { name: 'Buscar paciente por nombre o referencia', exact: true }).fill(b.reference);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('button', { name: 'Ver a ' + b.fullName, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: b.fullName, exact: true })).toBeVisible();
    const finished = page.waitForEvent('requestfinished', request => matches(request, path, 'POST'));
    release.open(); await finished; await renderTurn(page);
    await expect(page.getByRole('dialog').getByRole('heading', { name: b.fullName, exact: true })).toBeVisible();
    await expect(page.locator('main > .notice.success')).toContainText(a.reference);
    expect((await api.get<Patient>('operations/patients/' + a.id)).fullName).toBe(editedName);
    expect(await api.get<Patient>('operations/patients/' + b.id)).toEqual(b);
  } finally { release.open(); }
});

for (const rescheduling of [false, true]) {
  test(`agenda: ${rescheduling ? 'reprogramación' : 'transición'} tardía de A no reemplaza la cita B`, async ({ page }) => {
    const api = sessionApi(page); await login(page);
    const day = futureDay(), a = await appointment(api, day), b = await appointment(api, day);
    await agendaDay(page, day); await openAppointment(page, a);
    if (rescheduling) {
      await page.getByRole('dialog').getByRole('button', { name: 'Reprogramar', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Fecha y hora · Ciudad de México', { exact: true }).fill(day + 'T11:00');
    }
    const path = `operations/appointments/${a.id}/${rescheduling ? 'reschedule' : 'transition'}`;
    const ready = gate(), release = gate();
    await page.route('**/api/v1/' + path, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      ready.open(); await release.wait; await route.fulfill({ response });
    }, { times: 1 });
    try {
      await page.getByRole('dialog').getByRole('button', { name: rescheduling ? 'Guardar nuevo horario' : 'Registrar llegada', exact: true }).click();
      await ready.wait; await closeDialog(page); await openAppointment(page, b);
      const finished = page.waitForEvent('requestfinished', request => matches(request, path, 'POST'));
      release.open(); await finished; await renderTurn(page);
      await expect(page.getByRole('dialog').getByRole('heading', { name: b.patientName, exact: true })).toBeVisible();
      await expect(page.locator('main > .notice.success')).toContainText(a.patientReference);
      expect(await api.get<Appointment>('operations/appointments/' + b.id)).toEqual(b);
      const changed = await api.get<Appointment>('operations/appointments/' + a.id);
      expect(changed.version).toBe(1);
      expect(changed.status).toBe(rescheduling ? 'BOOKED' : 'ARRIVED');
      if (rescheduling) expect(mexicoLocal(changed.startsAt)).toBe(day + 'T11:00');
    } finally { release.open(); }
  });
}

test('pacientes: conflicto conserva borrador y exige revisar la versión antes de volver a guardar', async ({ page }) => {
  const api = sessionApi(page); await login(page);
  const original = await patient(api), draftName = 'Borrador propio ' + suffix(), otherName = 'Cambio concurrente ' + suffix();
  await go(page, 'Pacientes'); await openPatient(page, original); await editPatient(page, draftName);
  const path = `operations/patients/${original.id}/update`;
  await api.post<Patient>(path, patientUpdate(original, otherName), 200);
  const sent = attempts(page, path);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios', exact: true }).click(), 409);
  const comparison = page.getByRole('region', { name: 'Comparar cambios del paciente', exact: true });
  await expect(comparison).toContainText(otherName); await expect(comparison).toContainText(draftName);
  await expect(page.getByRole('dialog').getByLabel('Nombre completo', { exact: true })).toHaveValue(draftName);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios', exact: true })).toBeDisabled();
  await comparison.getByRole('button', { name: 'Usar versión actual y conservar mi borrador', exact: true }).click();
  expect(sent.map(body => body.expectedVersion)).toEqual([0]);
  expect((await api.get<Patient>('operations/patients/' + original.id)).fullName).toBe(otherName);
  await expect(page.getByRole('dialog').getByLabel('Nombre completo', { exact: true })).toHaveValue(draftName);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios', exact: true }).click());
  expect(sent.map(body => body.expectedVersion)).toEqual([0, 1]);
  const saved = await api.get<Patient>('operations/patients/' + original.id);
  expect(saved.fullName).toBe(draftName); expect(saved.version).toBe(2);
});

test('agenda: comparar conflicto conserva horario y servicio antes de reprogramar con la nueva versión', async ({ page }) => {
  const api = sessionApi(page); await login(page);
  const day = futureDay(), original = await appointment(api, day);
  const draftService = 'Servicio de mi borrador ' + suffix(), otherService = 'Servicio concurrente ' + suffix();
  await agendaDay(page, day); await openAppointment(page, original);
  await page.getByRole('dialog').getByRole('button', { name: 'Reprogramar', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Fecha y hora · Ciudad de México', { exact: true }).fill(day + 'T11:00');
  await page.getByRole('dialog').getByLabel('Servicio', { exact: true }).fill(draftService);
  const path = `operations/appointments/${original.id}/reschedule`;
  await api.post<Appointment>(path, rescheduleBody(original, day + 'T10:00', otherService), 200);
  const sent = attempts(page, path);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar nuevo horario', exact: true }).click(), 409);
  const comparison = page.getByRole('region', { name: 'Comparar cambios de la cita', exact: true });
  await expect(comparison).toContainText(otherService); await expect(comparison).toContainText(draftService);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Guardar nuevo horario', exact: true })).toBeDisabled();
  await comparison.getByRole('button', { name: 'Usar versión actual y conservar mi borrador', exact: true }).click();
  expect(sent.map(body => body.expectedVersion)).toEqual([0]);
  await expect(page.getByRole('dialog').getByLabel('Fecha y hora · Ciudad de México', { exact: true })).toHaveValue(day + 'T11:00');
  await expect(page.getByRole('dialog').getByLabel('Servicio', { exact: true })).toHaveValue(draftService);
  expect((await api.get<Appointment>('operations/appointments/' + original.id)).service).toBe(otherService);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar nuevo horario', exact: true }).click());
  expect(sent.map(body => body.expectedVersion)).toEqual([0, 1]);
  const saved = await api.get<Appointment>('operations/appointments/' + original.id);
  expect(saved.version).toBe(2); expect(saved.service).toBe(draftService); expect(mexicoLocal(saved.startsAt)).toBe(day + 'T11:00');
});

test('agenda: una transición concurrente se revisa sin repetir la acción anterior', async ({ page }) => {
  const api = sessionApi(page); await login(page);
  const day = futureDay(), original = await appointment(api, day);
  await agendaDay(page, day); await openAppointment(page, original);
  const path = `operations/appointments/${original.id}/transition`;
  await api.post<Appointment>(path, { expectedVersion: 0, status: 'ARRIVED' }, 200);
  const sent = attempts(page, path);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Registrar llegada', exact: true }).click(), 409);
  const comparison = page.getByRole('region', { name: 'Comparar cambios de la cita', exact: true });
  await expect(comparison).toContainText('En espera');
  await comparison.getByRole('button', { name: 'Usar estado actual sin repetir la acción', exact: true }).click();
  expect(sent.map(body => body.expectedVersion)).toEqual([0]);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Registrar llegada', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Iniciar consulta', exact: true })).toBeEnabled();
  expect((await api.get<Appointment>('operations/appointments/' + original.id)).status).toBe('ARRIVED');
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Iniciar consulta', exact: true }).click());
  expect(sent.map(body => body.expectedVersion)).toEqual([0, 1]);
  await uiSubmit(page, path, () => page.getByRole('dialog').getByRole('button', { name: 'Finalizar consulta', exact: true }).click());
  expect((await api.get<Appointment>('operations/appointments/' + original.id)).status).toBe('COMPLETED');
});
