// Applies src/site.config.json to the built public site.
// Preview mode (official=false) keeps the build untouched: noindex and robots Disallow.
// Official mode requires the titular's approval and real contact data; it refuses to
// publish a half-configured site rather than inventing phones, hours or URLs.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOCTOR = 'Dr. Marco Antonio De Nova Macedo';
const ADDRESS = {
  '@type': 'PostalAddress',
  streetAddress: 'Plaza PAME, local 3, Blvd. Solidaridad Las Torres 605, Moderna de la Cruz',
  addressLocality: 'Toluca de Lerdo',
  addressRegion: 'Estado de México',
  addressCountry: 'MX',
};
const SCHEMA_HOURS = /^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?(,(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?)* ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function validateSiteConfig(config) {
  const errors = [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  if (typeof config.official !== 'boolean') errors.push('official debe ser true o false.');
  const phone = text(config.phone), whatsapp = text(config.whatsapp), email = text(config.email);
  if (phone && !/^\+52 ?\d{2,3}( ?\d{3,4}){2}$/.test(phone)) errors.push('phone debe ser un número mexicano con lada, p. ej. +52 722 123 4567.');
  if (whatsapp && !/^52\d{10}$/.test(whatsapp)) errors.push('whatsapp debe tener 12 dígitos sin espacios ni +, p. ej. 527221234567.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email no es válido.');
  if (!Array.isArray(config.hours)) errors.push('hours debe ser una lista.');
  else config.hours.forEach((h, i) => {
    if (!text(h?.days) || !text(h?.time)) errors.push(`hours[${i}] requiere days y time.`);
    if (h?.schema !== undefined && !SCHEMA_HOURS.test(h.schema)) errors.push(`hours[${i}].schema debe usar el formato Mo-Fr 10:00-14:00.`);
  });
  for (const key of ['canonicalUrl', 'privacyNoticeUrl']) {
    const value = text(config[key]);
    if (!value) continue;
    let url;
    try { url = new URL(value); } catch { errors.push(`${key} no es una URL válida.`); continue; }
    if (url.protocol !== 'https:') errors.push(`${key} debe usar https.`);
    if (key === 'canonicalUrl' && (!value.endsWith('/') || url.search || url.hash)) errors.push('canonicalUrl debe terminar en / y no llevar ? ni #.');
  }
  if (config.official === true) {
    if (!text(config.approvedBy)) errors.push('Modo oficial: approvedBy debe registrar quién aprobó la publicación.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(config.approvedOn))) errors.push('Modo oficial: approvedOn debe ser una fecha AAAA-MM-DD.');
    if (!text(config.canonicalUrl)) errors.push('Modo oficial: canonicalUrl es obligatorio.');
    if (!phone && !whatsapp) errors.push('Modo oficial: se requiere al menos phone o whatsapp confirmados.');
    if (!Array.isArray(config.hours) || config.hours.length === 0) errors.push('Modo oficial: se requiere al menos un horario confirmado.');
  }
  return errors;
}

const escapeAttr = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderOfficialSite(indexHtml, config) {
  const canonical = config.canonicalUrl.trim();
  const url = new URL(canonical);
  const title = `${DOCTOR} · Neumólogo en Toluca`;
  const description = 'Neumología en Toluca: consulta, espirometría, caminata de seis minutos y seguimiento respiratorio. Plaza PAME, Blvd. Solidaridad Las Torres 605.';
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    name: DOCTOR,
    medicalSpecialty: 'Pulmonary',
    url: canonical,
    address: ADDRESS,
    ...(config.phone ? { telephone: config.phone.trim() } : {}),
    ...(config.email ? { email: config.email.trim() } : {}),
    ...(config.hours.some(h => h.schema) ? { openingHours: config.hours.filter(h => h.schema).map(h => h.schema) } : {}),
  };
  const head = [
    `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="es_MX" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonical)}" />`,
    `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
  // Every substitution must apply: a partially patched page could stay noindex or keep demo copy.
  let html = indexHtml;
  const must = (pattern, replacement, label) => {
    if (!pattern.test(html)) throw new Error(`No se encontró ${label} en index.html; no se publica un sitio a medias.`);
    html = html.replace(pattern, replacement);
  };
  must(/<title>[^<]*<\/title>/, `<title>${title}</title>`, 'el título');
  must(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeAttr(description)}" />`, 'la descripción');
  must(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, '<meta name="robots" content="index,follow" />', 'la etiqueta robots');
  must(/<base\s+href="[^"]*"\s*\/?>/, `<base href="${escapeAttr(url.pathname)}">`, 'la etiqueta base');
  must(/<noscript[^>]*>[\s\S]*?<\/noscript\s*>/, '<noscript>Este sitio requiere JavaScript. Dirección: Plaza PAME local 3, Blvd. Solidaridad Las Torres 605, Toluca.</noscript>', 'el aviso noscript');
  must(/<\/head>/, `    ${head}\n  </head>`, 'el cierre de head');
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', canonical)}\n`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${canonical}</loc><lastmod>${config.approvedOn}</lastmod></url>\n</urlset>\n`;
  const cname = url.hostname.endsWith('.github.io') ? null : url.hostname + '\n';
  return { html, robots, sitemap, cname };
}

function main(outDir) {
  const config = JSON.parse(readFileSync(new URL('../src/site.config.json', import.meta.url), 'utf8'));
  const errors = validateSiteConfig(config);
  if (errors.length) {
    console.error('src/site.config.json no es publicable:\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  if (!config.official) {
    console.log('Modo propuesta: sitio no indexable, sin cambios en el build.');
    return;
  }
  const indexPath = `${outDir}/index.html`;
  if (!existsSync(indexPath)) throw new Error(`No existe ${indexPath}. Ejecuta el build antes.`);
  const out = renderOfficialSite(readFileSync(indexPath, 'utf8'), config);
  writeFileSync(indexPath, out.html);
  writeFileSync(`${outDir}/robots.txt`, out.robots);
  writeFileSync(`${outDir}/sitemap.xml`, out.sitemap);
  if (out.cname) writeFileSync(`${outDir}/CNAME`, out.cname);
  else rmSync(`${outDir}/CNAME`, { force: true });
  console.log(`Modo oficial aplicado para ${config.canonicalUrl} (aprobado por ${config.approvedBy}, ${config.approvedOn}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv[2] || 'dist/clinic/browser');
