import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

// Runs only when src/site.config.json has official=true (see playwright.config.ts).
const site = JSON.parse(readFileSync('src/site.config.json', 'utf8'));
const base = new URL(site.canonicalUrl).pathname;

async function accessibleLayout(page: Page, context: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
    message: context + ': el documento no debe desbordarse horizontalmente',
  }).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), context).toEqual([]);
}

test('el sitio oficial es indexable y no muestra avisos ni accesos de demostración', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Respirar mejor');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', site.canonicalUrl);
  const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}');
  expect(schema['@type']).toBe('Physician');
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['propuesta', 'no oficial', 'demo', 'ficticio', 'provisional']) expect(text, word).not.toContain(word);
  await expect(page.locator('a[href^="#/panel"]')).toHaveCount(0);
  const robots = await request.get(base + 'robots.txt');
  expect(await robots.text()).toContain('Allow: /');
  expect((await request.get(base + 'sitemap.xml')).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test('las rutas del panel de demostración regresan al inicio', async ({ page }) => {
  await page.goto(base + '#/panel/caja');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Respirar mejor');
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('contacto y horario confirmados son visibles y enlazan correctamente', async ({ page }) => {
  await page.goto(base);
  const location = page.locator('#ubicacion');
  if (site.phone) await expect(location.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:' + site.phone.replace(/\s/g, ''));
  if (site.whatsapp) await expect(location.locator('a[href^="https://wa.me/"]')).toHaveAttribute('href', 'https://wa.me/' + site.whatsapp);
  for (const h of site.hours) await expect(location.locator('.opening-hours')).toContainText(h.time);
  const primary = page.locator('header .button.primary');
  await expect(primary).toHaveAttribute('href', site.whatsapp ? 'https://wa.me/' + site.whatsapp : 'tel:' + site.phone.replace(/\s/g, ''));
  if (site.privacyNoticeUrl) await expect(page.getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', site.privacyNoticeUrl);
});

for (const width of [360, 768, 1280]) {
  test('sitio oficial accesible y sin desbordamiento a ' + width + ' px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    await accessibleLayout(page, 'Inicio a ' + width + ' px');
    await page.getByRole('button', { name: /Espirometría/ }).click();
    await accessibleLayout(page, 'Detalle de servicio a ' + width + ' px');
  });
}
