import { test, expect, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Keep credentials and bearer headers in memory only. Portal config disables traces/videos.
const secrets = Object.fromEntries(readFileSync('.local/private.env', 'utf8').split(/\r?\n/)
  .filter(line => line.trim() && !line.trimStart().startsWith('#') && line.includes('='))
  .map(line => { const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)]; }));
const passwords = { admin: 'DEV_ADMIN_PASSWORD', farmacia: 'DEV_PHARMACY_PASSWORD' } as const;
type Username = keyof typeof passwords;
interface LotFixture { id: string; batch: string; productName: string; initial: number }
interface Movement { id: string; lotId: string; reason: string; quantity: number; balanceAfter: number }
interface Attempt { path: string; key: string; body: unknown }

async function login(page: Page, username: Username = 'admin') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const password = secrets[passwords[username]];
  expect(Boolean(password), 'La identidad sintética necesita su contraseña en .local/private.env').toBe(true);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todo en su lugar.', exact: true })).toBeVisible();
}

async function logout(page: Page) {
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
  const origin = new URL(page.url()).origin;
  // Wait for the identity provider's return navigation, not just the immediate local sign-out UI.
  const returned = page.waitForEvent('requestfinished', request => {
    const url = new URL(request.url());
    return request.isNavigationRequest() && url.origin === origin && url.pathname === '/';
  });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await returned;
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
}

function sessionApi(page: Page) {
  let authorization = '';
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) authorization = request.headers()['authorization'] || authorization;
  });
  return {
    async get<T>(path: string): Promise<T> {
      await expect.poll(() => Boolean(authorization), { message: 'Se requiere una sesión de API autenticada' }).toBe(true);
      const response = await page.request.get('/api/v1/' + path, { headers: { Authorization: authorization } });
      expect(response.status(), 'Lectura de fixture sintético: ' + path).toBe(200);
      return response.json();
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      await expect.poll(() => Boolean(authorization), { message: 'Se requiere una sesión de API autenticada' }).toBe(true);
      const response = await page.request.post('/api/v1/' + path, {
        headers: { Authorization: authorization, 'Idempotency-Key': randomUUID() }, data: body,
      });
      expect(response.status(), 'Alta de fixture sintético: ' + path).toBe(201);
      return response.json();
    },
  };
}
type SessionApi = ReturnType<typeof sessionApi>;

async function stock(api: SessionApi, initial = 10): Promise<LotFixture> {
  const suffix = randomUUID().replaceAll('-', '').toUpperCase();
  const productName = 'Insumo sintético recuperación ' + suffix;
  const product = await api.post<{ id: string }>('inventory/products', {
    sku: 'SYN-' + suffix, name: productName, category: 'INSUMOS', unit: 'pieza', minimumStock: 0,
  });
  const batch = 'RECOVERY-' + suffix;
  const lot = await api.post<{ id: string }>('inventory/lots', {
    productId: product.id, batch, expiresOn: null, quarantined: false,
  });
  await api.post('inventory/lots/' + lot.id + '/movements', {
    kind: 'RECEIPT', quantity: initial, reason: 'Saldo inicial sintético ' + suffix,
  });
  return { id: lot.id, batch, productName, initial };
}

async function openLot(page: Page, lot: LotFixture) {
  const link = page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Inventario', exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'Abrir o cerrar navegación', exact: true }).click();
  await link.click();
  await page.getByRole('button', { name: 'Existencias por lote', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar inventario', exact: true }).fill(lot.batch);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver lote ' + lot.batch, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Lote ' + lot.batch, exact: true })).toBeVisible();
  await expect(dialog.locator('#dialog-description')).toHaveText(lot.productName);
}

async function prepareIssue(page: Page, quantity: number, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Tipo', exact: true }).selectOption('ISSUE');
  await dialog.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill(String(quantity));
  await dialog.getByRole('textbox', { name: 'Motivo del movimiento', exact: true }).fill(reason);
}

function movementPath(lot: LotFixture) { return '/api/v1/inventory/lots/' + lot.id + '/movements'; }
function isRequest(request: Request, path: string, method: string) {
  return request.method() === method && new URL(request.url()).pathname === path;
}
function captureAttempts(page: Page, lot: LotFixture) {
  const attempts: Attempt[] = [];
  page.on('request', request => {
    if (isRequest(request, movementPath(lot), 'POST')) attempts.push({
      path: new URL(request.url()).pathname,
      key: request.headers()['idempotency-key'] || '',
      body: request.postDataJSON(),
    });
  });
  return attempts;
}
async function loseNextMovementResponse(page: Page, lot: LotFixture) {
  await page.route('**' + movementPath(lot), async route => {
    // Execute against PostgreSQL, then hide the committed response from the UI.
    const committed = await route.fetch();
    expect(committed.status(), 'El movimiento debe haberse confirmado antes de perder la respuesta').toBe(201);
    await route.abort('failed');
  }, { times: 1 });
}
function expectSameRetry(attempts: Attempt[]) {
  expect(attempts).toHaveLength(2);
  expect(attempts[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(attempts[1]).toEqual(attempts[0]);
}
async function expectExactlyOneIssue(api: SessionApi, lot: LotFixture, quantity: number, reason: string) {
  const persisted = await api.get<{ quantity: number }>('inventory/lots/' + lot.id);
  expect(persisted.quantity).toBe(lot.initial - quantity);
  const history = await api.get<{ items: Movement[] }>('inventory/movements?lotId=' + lot.id + '&limit=100');
  expect(history.items).toHaveLength(2); // Initial receipt plus exactly one issue.
  const matching = history.items.filter(movement => movement.reason === reason);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({ lotId: lot.id, quantity, balanceAfter: lot.initial - quantity });
}
function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}

test('reintentar un movimiento confirmado sin respuesta cierra el diálogo y afecta el saldo una sola vez', async ({ page }) => {
  const api = sessionApi(page);
  await login(page);
  const lot = await stock(api);
  const reason = 'Salida sintética con respuesta perdida ' + randomUUID();
  const attempts = captureAttempts(page, lot);
  await openLot(page, lot);
  await prepareIssue(page, 3, reason);
  await loseNextMovementResponse(page, lot);
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true }).click();
  const retry = page.getByRole('dialog').getByRole('button', { name: 'Reintentar operación', exact: true });
  await expect(retry).toBeEnabled();
  await expectExactlyOneIssue(api, lot, 3, reason);
  await retry.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar movimiento', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar operación', exact: true })).toHaveCount(0);
  expectSameRetry(attempts);
  await expectExactlyOneIssue(api, lot, 3, reason);
  await openLot(page, lot);
  await expect(page.getByRole('dialog').locator('.detail-metrics > div').first().locator('strong')).toHaveText('7');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true })).toHaveCount(0);
});

test('la operación pendiente de A sobrevive al movimiento de B y se recupera con la misma clave', async ({ page }) => {
  test.setTimeout(180000);
  const api = sessionApi(page);
  await login(page, 'admin');
  const lotA = await stock(api, 10), lotB = await stock(api, 12);
  const reasonA = 'Salida sintética pendiente A ' + randomUUID();
  const reasonB = 'Salida sintética independiente B ' + randomUUID();
  const attemptsA = captureAttempts(page, lotA), attemptsB = captureAttempts(page, lotB);
  await openLot(page, lotA);
  await prepareIssue(page, 3, reasonA);
  await loseNextMovementResponse(page, lotA);
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Reintentar operación', exact: true })).toBeEnabled();
  await expectExactlyOneIssue(api, lotA, 3, reasonA);
  await logout(page);

  // Same browser tab/sessionStorage, different authenticated subject.
  await login(page, 'farmacia');
  await expect(page.getByRole('button', { name: 'Reintentar operación', exact: true })).toHaveCount(0);
  await openLot(page, lotB);
  await prepareIssue(page, 2, reasonB);
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true })).toHaveCount(0);
  await expectExactlyOneIssue(api, lotB, 2, reasonB);
  expect(attemptsA).toHaveLength(1);
  expect(attemptsB).toHaveLength(1);
  expect(attemptsB[0].key).not.toBe(attemptsA[0].key);
  await logout(page);

  await login(page, 'admin');
  const retry = page.getByRole('button', { name: 'Reintentar operación', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expectSameRetry(attemptsA);
  expect(attemptsB).toHaveLength(1);
  await expectExactlyOneIssue(api, lotA, 3, reasonA);
  await expectExactlyOneIssue(api, lotB, 2, reasonB);
});

test('la recarga tardía del lote A no reemplaza el detalle abierto del lote B ni dirige su movimiento a A', async ({ page }) => {
  const api = sessionApi(page);
  await login(page);
  const lotA = await stock(api, 8), lotB = await stock(api, 13);
  const reasonA = 'Salida sintética antes de cambiar lote ' + randomUUID();
  const reasonB = 'Salida sintética del lote visible ' + randomUUID();
  const attemptsA = captureAttempts(page, lotA), attemptsB = captureAttempts(page, lotB);
  const reloadReady = gate(), releaseReload = gate();
  const reloadPath = '/api/v1/inventory/lots/' + lotA.id;
  await openLot(page, lotA);
  await prepareIssue(page, 2, reasonA);
  await page.route('**' + reloadPath, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    reloadReady.open();
    await releaseReload.wait;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar movimiento', exact: true }).click();
    await reloadReady.wait;
    await page.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
    await openLot(page, lotB);
    const reloadFinished = page.waitForEvent('requestfinished', request => isRequest(request, reloadPath, 'GET'));
    releaseReload.open();
    await reloadFinished;
    // Let the delivered fetch callback and Angular render run, without a timing sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Lote ' + lotB.batch, exact: true })).toBeVisible();
    await expect(dialog.locator('#dialog-description')).toHaveText(lotB.productName);
    await expect(dialog.locator('.detail-metrics > div').first().locator('strong')).toHaveText('13');
    await expect(dialog.locator('.compact-list')).not.toContainText(reasonA);
    await prepareIssue(page, 3, reasonB);
    await dialog.getByRole('button', { name: 'Confirmar movimiento', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Confirmar movimiento', exact: true })).toHaveCount(0);
    await expect(dialog.locator('.detail-metrics > div').first().locator('strong')).toHaveText('10');
    expect(attemptsA).toHaveLength(1);
    expect(attemptsB).toHaveLength(1);
    await expectExactlyOneIssue(api, lotA, 2, reasonA);
    await expectExactlyOneIssue(api, lotB, 3, reasonB);
  } finally {
    releaseReload.open();
  }
});
