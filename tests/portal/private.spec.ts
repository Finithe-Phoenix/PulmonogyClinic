import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const secrets = Object.fromEntries(readFileSync('.local/private.env', 'utf8').trim().split(/\r?\n/).map(l => l.split('=')));
const keys: Record<string,string> = { admin:'DEV_ADMIN_PASSWORD', farmacia:'DEV_PHARMACY_PASSWORD', auditor:'DEV_AUDITOR_PASSWORD', recepcion:'DEV_RECEPTION_PASSWORD' };
async function login(page: Page, username = 'admin') {
  await page.goto('/');
  await page.getByRole('button', {name:'Iniciar sesión',exact:true}).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(secrets[keys[username]]);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('button', {name:'Cerrar sesión'})).toBeVisible();
  if (username !== 'recepcion') await expect(page.getByRole('button',{name:'Actualizar',exact:true})).toBeEnabled();
}
async function setupOrder(page: Page, quantity = 10) {
  const suffix = randomUUID().slice(0,8).toUpperCase();
  await page.getByLabel('SKU', {exact:true}).fill('SYN-' + suffix);
  await page.getByLabel('Nombre del producto', {exact:true}).fill('Insumo sintético ' + suffix);
  await page.getByRole('button', {name:'Crear producto',exact:true}).click();
  await expect(page.locator('#catalogo li').filter({hasText:'SYN-' + suffix})).toBeVisible();
  await expect(page.getByRole('button', {name:'Crear producto',exact:true})).toBeEnabled();
  await page.getByLabel('Referencia del proveedor',{exact:true}).fill('PROV-' + suffix);
  await page.getByLabel('Nombre del proveedor',{exact:true}).fill('Proveedor sintético ' + suffix);
  await page.getByRole('button', {name:'Crear proveedor',exact:true}).click();
  await expect(page.locator('#proveedores li').filter({hasText:'PROV-' + suffix})).toBeVisible();
  await expect(page.getByRole('button', {name:'Crear proveedor',exact:true})).toBeEnabled();
  await page.getByLabel('Referencia de orden',{exact:true}).fill('OC-' + suffix);
  await page.getByRole('combobox',{name:'Proveedor',exact:true}).selectOption({label:'Proveedor sintético ' + suffix});
  await page.getByRole('combobox',{name:'Producto de partida 1',exact:true}).selectOption({label:`SYN-${suffix} · Insumo sintético ${suffix}`});
  await page.getByLabel('Cantidad de partida 1',{exact:true}).fill(String(quantity));
  await page.getByRole('button', {name:'Crear orden',exact:true}).click();
  await expect(page.getByTestId('order-status')).toHaveText('Estado: PENDING');
  await expect(page.getByRole('button',{name:'Actualizar',exact:true})).toBeEnabled();
  return suffix;
}
async function prepareReceipt(page: Page, suffix: string, quantity: number, ref: string) {
  await page.getByLabel('Folio de recepción',{exact:true}).fill(ref);
  await page.getByLabel('Unidades recibidas',{exact:true}).fill(String(quantity));
  await page.getByLabel('Lote',{exact:true}).fill('LOT-' + suffix);
}

test('acceso, recepción parcial, persistencia entre sesiones y auditoría', async ({page}) => {
  await login(page);
  const suffix = await setupOrder(page);
  await prepareReceipt(page,suffix,4,'REC-' + suffix);
  await page.getByRole('button',{name:'Confirmar recepción',exact:true}).click();
  await expect(page.getByTestId('order-status')).toHaveText('Estado: PARTIAL');
  await expect(page.locator(`[data-batch="LOT-${suffix}"]`)).toContainText('Existencias: 4');
  await expect(page.locator('#auditoria')).toContainText('Recepción REC-' + suffix);
  await expect(page.locator('#auditoria')).toContainText('PURCHASE_RECEIVED');
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await login(page);
  await page.getByRole('button',{name:'Abrir OC-' + suffix,exact:true}).click();
  await expect(page.getByTestId('order-status')).toHaveText('Estado: PARTIAL');
  await expect(page.locator(`[data-batch="LOT-${suffix}"]`)).toContainText('Existencias: 4');
  await page.reload();
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cerrar sesión'})).toBeVisible();
  await expect(page.locator(`[data-batch="LOT-${suffix}"]`)).toContainText('Existencias: 4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('respuesta perdida conserva clave incluso al recargar y no duplica recepción', async ({page}) => {
  await login(page);
  const suffix = await setupOrder(page);
  await prepareReceipt(page,suffix,3,'REC-' + suffix);
  await page.route('**/api/v1/purchasing/orders/*/receipts', async route => {
    await route.fetch(); // commit succeeds; simulate losing only its response
    await route.abort('failed');
  }, {times:1});
  await page.getByRole('button',{name:'Confirmar recepción',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reintentar operación'})).toBeEnabled();
  await page.reload();
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reintentar operación'})).toBeEnabled();
  await page.getByRole('button',{name:'Reintentar operación'}).click();
  await expect(page.getByRole('button',{name:'Reintentar operación'})).toHaveCount(0);
  await expect(page.locator(`[data-batch="LOT-${suffix}"]`)).toContainText('Existencias: 3');
});

test('dos usuarios compiten por el saldo sin sobreentrega', async ({page,browser}) => {
  await login(page);
  const suffix = await setupOrder(page,1);
  const secondContext = await browser.newContext({baseURL:'http://localhost:4180'});
  const second = await secondContext.newPage();
  try {
    await login(second,'farmacia');
    await second.getByRole('button',{name:'Abrir OC-' + suffix,exact:true}).click();
    await prepareReceipt(page,suffix,1,'REC-A-' + suffix);
    await prepareReceipt(second,suffix,1,'REC-B-' + suffix);
    await Promise.all([page.getByRole('button',{name:'Confirmar recepción',exact:true}).click(), second.getByRole('button',{name:'Confirmar recepción',exact:true}).click()]);
    await expect(page.getByRole('button',{name:'Actualizar',exact:true})).toBeEnabled();
    await expect(second.getByRole('button',{name:'Actualizar',exact:true})).toBeEnabled();
    const alerts = (await page.getByRole('alert').allTextContents()).join(' ') + (await second.getByRole('alert').allTextContents()).join(' ');
    expect(alerts).toMatch(/OVER_RECEIPT|ORDER_COMPLETE/);
    await page.getByRole('button',{name:'Actualizar',exact:true}).click();
    await expect(page.locator(`[data-batch="LOT-${suffix}"]`)).toContainText('Existencias: 1');
    await expect(page.getByTestId('order-status')).toHaveText('Estado: RECEIVED');
  } finally { await secondContext.close(); }
});

test('auditor consulta pero el servidor rechaza sus escrituras', async ({page}) => {
  let authorization = '';
  page.on('request', request => { if(request.url().includes('/api/v1/')) authorization = request.headers()['authorization'] || authorization; });
  await login(page,'auditor');
  await expect(page.getByRole('heading',{name:'Auditoría del servidor'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Crear proveedor',exact:true})).toHaveCount(0);
  const response = await page.request.post('/api/v1/purchasing/suppliers', {headers:{Authorization:authorization,'Idempotency-Key':randomUUID()},data:{reference:'DENIED-' + randomUUID(),name:'Sintético'}});
  expect(response.status()).toBe(403);
});

test('recepción no ve inventario; peticiones anónimas se rechazan', async ({page}) => {
  const response = await page.request.get('/api/v1/inventory/products');
  expect(response.status()).toBe(401);
  await login(page,'recepcion');
  await expect(page.getByRole('heading',{name:'Acceso restringido'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Existencias por lote'})).toHaveCount(0);
});
