import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSiteConfig, renderOfficialSite } from '../scripts/site-mode.mjs';

const preview = JSON.parse(readFileSync(new URL('../src/site.config.json', import.meta.url), 'utf8'));
const official = {
  official: true, approvedBy: 'Titular del consultorio', approvedOn: '2026-11-01',
  canonicalUrl: 'https://www.ejemplo-consultorio.mx/', phone: '+52 722 123 4567', whatsapp: '527221234567',
  email: 'recepcion@ejemplo-consultorio.mx', hours: [{ days: 'Lunes a viernes', time: '10:00 a 14:00', schema: 'Mo-Fr 10:00-14:00' }],
  privacyNoticeUrl: '',
};
const index = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

test('la configuración versionada es publicable y permanece en modo propuesta', () => {
  assert.deepEqual(validateSiteConfig(preview), []);
  assert.equal(preview.official, false);
});

test('el modo oficial exige aprobación, URL, contacto y horario confirmados', () => {
  const errors = validateSiteConfig({ ...preview, official: true });
  for (const fragment of ['approvedBy', 'approvedOn', 'canonicalUrl', 'phone o whatsapp', 'horario']) {
    assert.ok(errors.some(error => error.includes(fragment)), fragment);
  }
  assert.deepEqual(validateSiteConfig(official), []);
});

test('rechaza formatos de contacto, horario y URL incorrectos', () => {
  const cases: Record<string, unknown>[] = [
    { phone: '7221234567' }, { whatsapp: '+52 722 123 4567' }, { email: 'recepcion' },
    { canonicalUrl: 'http://www.ejemplo-consultorio.mx/' }, { canonicalUrl: 'https://www.ejemplo-consultorio.mx' },
    { hours: [{ days: 'Lunes', time: '' }] }, { hours: [{ days: 'Lunes', time: '10 a 14', schema: 'Lunes 10-14' }] },
  ];
  for (const patch of cases) assert.notDeepEqual(validateSiteConfig({ ...official, ...patch }), [], JSON.stringify(patch));
});

test('el sitio oficial se indexa con canonical, datos estructurados, sitemap y dominio', () => {
  const out = renderOfficialSite(index, official);
  assert.match(out.html, /<meta name="robots" content="index,follow" \/>/);
  assert.doesNotMatch(out.html, /Demo|Datos ficticios|noindex/);
  assert.match(out.html, /<base href="\/">/);
  assert.match(out.html, /<link rel="canonical" href="https:\/\/www\.ejemplo-consultorio\.mx\/" \/>/);
  const schema = JSON.parse(out.html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
  assert.equal(schema['@type'], 'Physician');
  assert.equal(schema.telephone, '+52 722 123 4567');
  assert.deepEqual(schema.openingHours, ['Mo-Fr 10:00-14:00']);
  assert.match(out.robots, /Allow: \/\n\nSitemap: https:\/\/www\.ejemplo-consultorio\.mx\/sitemap\.xml/);
  assert.match(out.sitemap, /<loc>https:\/\/www\.ejemplo-consultorio\.mx\/<\/loc><lastmod>2026-11-01<\/lastmod>/);
  assert.equal(out.cname, 'www.ejemplo-consultorio.mx\n');
});

test('en GitHub Pages conserva la ruta del repositorio y no crea dominio propio', () => {
  const out = renderOfficialSite(index, { ...official, canonicalUrl: 'https://finithe-phoenix.github.io/PulmonogyClinic/' });
  assert.match(out.html, /<base href="\/PulmonogyClinic\/">/);
  assert.equal(out.cname, null);
});

test('aplica las sustituciones sobre el HTML minimizado del build y falla si falta una', () => {
  const built = index.replace(/\s*\/>/g, '>');
  assert.match(renderOfficialSite(built, official).html, /<meta name="robots" content="index,follow" \/>/);
  assert.throws(() => renderOfficialSite(built.replace(/<meta name="robots"[^>]*>/, ''), official), /robots/);
});
