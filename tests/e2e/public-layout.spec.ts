import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const base = '/PulmonogyClinic/';
const modules = [
  ['resumen', 'Resumen'], ['recepcion', 'Recepción'], ['pacientes', 'Pacientes'],
  ['consultas', 'Consultas'], ['inventario', 'Inventario'], ['compras', 'Compras'],
  ['equipos', 'Equipos'], ['caja', 'Caja'], ['proyecto', 'Plan del proyecto'],
] as const;

async function accessibleLayout(page: Page, context: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
    message: context + ': el documento no debe desbordarse horizontalmente',
  }).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(violation => ({
    id: violation.id, impact: violation.impact, targets: violation.nodes.map(node => node.target),
  })), context + ': no se excluyen reglas ni elementos de la revisión automática').toEqual([]);
}

for (const width of [360, 390, 768, 1280, 1440]) {
  test('sitio y demo accesibles sin desbordamiento a ' + width + ' px', async ({ page }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    await test.step('Sitio, servicios y navegación pública', async () => {
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Respirar mejor');
      await accessibleLayout(page, 'Sitio público a ' + width + ' px');
      await page.screenshot({ path: info.outputPath('public-' + width + '.png'), fullPage: true });
      await page.getByRole('button', { name: /Espirometría/ }).click();
      await expect(page.getByRole('dialog')).toContainText('broncodilatador');
      await accessibleLayout(page, 'Detalle del servicio a ' + width + ' px');
      await page.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      const menu = page.getByRole('button', { name: 'Menú del consultorio', exact: true });
      if (await menu.isVisible()) {
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        await accessibleLayout(page, 'Menú público abierto a ' + width + ' px');
      }
      await page.getByRole('navigation', { name: 'Sitio del doctor' })
        .getByRole('button', { name: 'Preguntas', exact: true }).click();
      const question = page.locator('details').filter({ hasText: '¿Cómo puedo agendar una consulta?' });
      await question.locator('summary').click();
      await expect(question).toHaveAttribute('open', '');
      await expect(question.locator('p')).toContainText('Doctoralia');
      await accessibleLayout(page, 'Pregunta desplegada a ' + width + ' px');
    });

    for (const [route, label] of modules) {
      await test.step('Demo sintética: ' + label, async () => {
        await page.goto(base + '#/panel/' + route);
        await expect(page.locator('.breadcrumbs strong')).toHaveText(label);
        await expect(page.locator('.demo-notice')).toContainText('Datos ficticios');
        await accessibleLayout(page, label + ' a ' + width + ' px');
        if (route === 'resumen') {
          await page.screenshot({ path: info.outputPath('demo-' + width + '.png'), fullPage: true });
        }
        if (route === 'inventario') {
          const lot = page.getByRole('row').filter({ hasText: 'SIM-2601' });
          await expect(lot.locator('td').nth(2)).toContainText('8 uds.');
          await lot.getByRole('button', { name: 'Registrar', exact: true }).click();
          const dialog = page.getByRole('dialog');
          await dialog.getByLabel('Cantidad de unidades').fill('1');
          await dialog.getByLabel('Motivo', { exact: true }).fill('Salida sintética de revisión adaptable ' + width);
          await accessibleLayout(page, 'Movimiento sintético a ' + width + ' px');
          await dialog.getByRole('button', { name: 'Guardar ejemplo', exact: true }).click();
          await expect(dialog).not.toBeVisible();
          await expect(lot.locator('td').nth(2)).toContainText('7 uds.');
          await accessibleLayout(page, 'Movimiento confirmado a ' + width + ' px');
        }
      });
    }
  });
}
