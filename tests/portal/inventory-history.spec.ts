import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Synthetic identities only. Never serialize passwords, bearer headers or browser traces.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const secrets = Object.fromEntries(readFileSync('.local/private.env', 'utf8').split(/\r?\n/)
  .filter(line => line.trim() && !line.trimStart().startsWith('#') && line.includes('='))
  .map(line => { const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)]; }));
interface LotFixture { id: string; batch: string; productName: string; reason: string }

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const password = secrets['DEV_ADMIN_PASSWORD'];
  expect(Boolean(password), 'La identidad sintética requiere su contraseña local').toBe(true);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'Todo en su lugar.', exact: true })).toBeVisible();
}

function sessionApi(page: Page) {
  let authorization = '';
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) authorization = request.headers()['authorization'] || authorization;
  });
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      await expect.poll(() => Boolean(authorization), { message: 'Se requiere una sesión autenticada' }).toBe(true);
      const response = await page.request.post('/api/v1/' + path, {
        headers: { Authorization: authorization, 'Idempotency-Key': randomUUID() }, data: body,
      });
      expect(response.status(), 'Alta de fixture sintético: ' + path).toBe(201);
      return response.json();
    },
  };
}

async function stock(api: ReturnType<typeof sessionApi>, withMovement = true): Promise<LotFixture> {
  const suffix = randomUUID().replaceAll('-', '').toUpperCase();
  const productName = 'Insumo sintético historial ' + suffix;
  const product = await api.post<{ id: string }>('inventory/products', {
    sku: 'SYN-' + suffix, name: productName, category: 'INSUMOS', unit: 'pieza', minimumStock: 0,
  });
  const batch = 'HISTORY-' + suffix;
  const lot = await api.post<{ id: string }>('inventory/lots', { productId: product.id, batch, expiresOn: null, quarantined: false });
  const reason = 'Entrada sintética de historial ' + suffix;
  if (withMovement) await api.post('inventory/lots/' + lot.id + '/movements', { kind: 'RECEIPT', quantity: 7, reason });
  return { id: lot.id, batch, productName, reason };
}

async function openLot(page: Page, lot: LotFixture) {
  const link = page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Inventario', exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'Abrir o cerrar navegación', exact: true }).click();
  await link.click();
  await page.getByRole('button', { name: 'Existencias por lote', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar inventario', exact: true }).fill(lot.batch);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver lote ' + lot.batch, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Lote ' + lot.batch, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').locator('#dialog-description')).toHaveText(lot.productName);
}

function isHistory(url: URL, lot: LotFixture) {
  return url.pathname === '/api/v1/inventory/movements' && url.searchParams.get('lotId') === lot.id;
}
function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}
const history = (page: Page) => page.getByRole('dialog').getByRole('region', { name: 'Historial de movimientos', exact: true });

test('el historial distingue carga, error recuperable y vacío confirmado', async ({ page }) => {
  const api = sessionApi(page);
  await login(page);
  const lot = await stock(api), emptyLot = await stock(api, false);
  const requested = gate(), release = gate();
  await page.route(url => isHistory(url, lot), async route => {
    requested.open();
    await release.wait;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_HISTORY_UNAVAILABLE', detail: 'Consulta sintética temporalmente no disponible.' }) });
  }, { times: 1 });
  try {
    await openLot(page, lot);
    await requested.wait;
    await expect(history(page).getByRole('status')).toHaveText('Consultando historial…');
    await expect(history(page)).not.toContainText('Sin movimientos en esta página.');
    release.open();
    await expect(history(page).getByRole('alert')).toContainText('No pudimos consultar el historial de movimientos.');
    await expect(history(page)).not.toContainText('Sin movimientos en esta página.');
    const retryRequest = page.waitForRequest(request => isHistory(new URL(request.url()), lot));
    await history(page).getByRole('button', { name: 'Reintentar historial', exact: true }).click();
    const request = await retryRequest;
    expect(new URL(request.url()).searchParams.get('offset')).toBe('0');
    await expect(history(page)).toContainText(lot.reason);
    await expect(history(page).getByRole('alert')).toHaveCount(0);
    await expect(history(page).getByRole('button', { name: 'Reintentar historial', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
    await openLot(page, emptyLot);
    await expect(history(page)).toContainText('Sin movimientos en esta página.');
    await expect(history(page).getByRole('alert')).toHaveCount(0);
    await expect(history(page)).not.toContainText(lot.reason);
  } finally { release.open(); }
});

for (const outcome of ['success', 'error'] as const) {
  test(`el historial tardío de A (${outcome}) no reemplaza ni marca como fallido el lote B`, async ({ page }) => {
    const api = sessionApi(page);
    await login(page);
    const lotA = await stock(api), lotB = await stock(api);
    const ready = gate(), release = gate();
    const lateError = 'Error sintético tardío del lote A ' + randomUUID();
    await page.route(url => isHistory(url, lotA), async route => {
      const response = outcome === 'success' ? await route.fetch() : null;
      if (response) expect(response.status()).toBe(200);
      ready.open();
      await release.wait;
      if (response) await route.fulfill({ response });
      else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_LATE_HISTORY', detail: lateError }) });
    }, { times: 1 });
    try {
      await openLot(page, lotA);
      await ready.wait;
      await expect(history(page).getByRole('status')).toHaveText('Consultando historial…');
      await page.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
      await openLot(page, lotB);
      await expect(history(page)).toContainText(lotB.reason);
      const delivered = page.waitForEvent('requestfinished', request => isHistory(new URL(request.url()), lotA));
      release.open();
      await delivered;
      // Settle the delivered fetch callback and Angular render without a fixed timing sleep.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Lote ' + lotB.batch, exact: true })).toBeVisible();
      await expect(history(page)).toContainText(lotB.reason);
      await expect(history(page)).not.toContainText(lotA.reason);
      await expect(history(page).getByRole('alert')).toHaveCount(0);
      await expect(page.getByText(lateError, { exact: true })).toHaveCount(0);
      await expect(history(page)).not.toContainText('Sin movimientos en esta página.');
    } finally { release.open(); }
  });
}
