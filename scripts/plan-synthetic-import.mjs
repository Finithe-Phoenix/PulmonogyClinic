#!/usr/bin/env node
// Read-only planning tool: no API, database driver, subprocess, environment credentials or file writes.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({ bytesPerCsv: 262144, manifestBytes: 4096, rowsPerCsv: 500, fieldLength: 4096 });
export const HEADERS = Object.freeze({
  products: ['sourceId', 'sku', 'name', 'category', 'unit', 'minimumStock', 'synthetic'],
  lots: ['sourceId', 'productSourceId', 'targetLotId', 'batch', 'expiresOn', 'quarantined', 'recordedQuantity', 'countedQuantity', 'reason', 'synthetic'],
  patients: ['sourceId', 'reference', 'fullName', 'birthDate', 'phone', 'email', 'synthetic'],
});
const sourcePattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const codePattern = /^[A-Z0-9-]{2,40}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => value.trim().replace(/\s+/g, ' ');
const canonicalName = value => clean(value).toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
export function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** RFC-style comma CSV with LF/CRLF, BOM, escaped quotes and quoted newlines; never evaluates cells. */
export function parseCsv(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > LIMITS.bytesPerCsv) throw Error('CSV_SIZE');
  const text = input.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closedQuote = false, started = false;
  const cell = () => { row.push(field); field = ''; closedQuote = false; started = false; if (row.length > 20) throw Error('CSV_COLUMNS'); };
  const record = () => { cell(); rows.push(row); row = []; if (rows.length > LIMITS.rowsPerCsv + 1) throw Error('CSV_ROWS'); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r') { if (text[index + 1] !== '\n') throw Error('CSV_NEWLINE'); index++; }
      record();
    } else if (closedQuote) throw Error('CSV_AFTER_QUOTE');
    else if (char === '"') { if (started || field.length) throw Error('CSV_QUOTE'); quoted = true; started = true; }
    else { field += char; started = true; }
    if (field.length > LIMITS.fieldLength) throw Error('CSV_FIELD_SIZE');
  }
  if (quoted) throw Error('CSV_UNCLOSED_QUOTE');
  if (started || closedQuote || field.length || row.length) record();
  return rows;
}

/** All inputs are strings. A report is a proposal, never a successful import or permission to execute it. */
export function planImport(bundle, asOf) {
  const errors = [], warnings = [], duplicates = [], items = [];
  const report = { schemaVersion: 1, mode: 'DRY_RUN', status: 'BLOCKED', executionAllowed: false,
    databaseChecked: false, importedRecords: 0, asOf, sourceSystem: null, inputHashes: {},
    counts: { input: 0, accepted: 0, duplicates: 0, errors: 0, warnings: 0 }, errors, warnings, duplicates, items };
  const issue = (collection, file, record, field, code, message) => collection.push({ file, record, field, code, message });
  const error = (file, record, field, code, message) => issue(errors, file, record, field, code, message);
  const warning = (file, record, field, code, message) => issue(warnings, file, record, field, code, message);
  if (!calendarDate(asOf) || Number(asOf.slice(0, 4)) < 1900) {
    error('arguments', 0, 'asOf', 'INVALID_AS_OF', 'Usa una fecha de corte ISO válida, desde 1900, explícita para este ensayo.');
    report.counts.errors = errors.length; return report;
  }
  let manifest;
  try {
    if (typeof bundle.manifest !== 'string' || Buffer.byteLength(bundle.manifest, 'utf8') > LIMITS.manifestBytes) throw Error();
    manifest = JSON.parse(bundle.manifest.replace(/^\uFEFF/, ''));
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object'
      || Object.keys(manifest).sort().join(',') !== 'schemaVersion,sourceSystem,synthetic'
      || manifest.schemaVersion !== 1 || manifest.synthetic !== true
      || typeof manifest.sourceSystem !== 'string' || !sourcePattern.test(manifest.sourceSystem)) throw Error();
  } catch {
    error('manifest.json', 0, '', 'INVALID_MANIFEST', 'Se requiere schemaVersion=1, synthetic=true y sourceSystem de 1–64 caracteres A–Z, dígitos, punto, guion o guion bajo; sin campos adicionales.');
    report.counts.errors = errors.length; return report;
  }
  report.sourceSystem = manifest.sourceSystem;
  report.inputHashes['manifest.json'] = digest(bundle.manifest);
  const catalogs = { products: new Map(), lots: new Map(), patients: new Map() }, businessKeys = new Map();
  const sourceKey = (kind, id) => `${manifest.sourceSystem}/${kind}/${id}`;
  const textField = (row, field, max, file, record, required = true, collapse = false) => {
    const value = collapse ? clean(row[field]) : row[field].trim();
    if ((required && !value) || value.length > max || /[\u0000-\u001f\u007f]/.test(row[field])) {
      error(file, record, field, 'INVALID_TEXT', `Texto ${required ? 'obligatorio' : 'opcional'}, máximo ${max} caracteres, sin controles ni saltos de línea.`);
    }
    return value;
  };
  const integer = (row, field, max, file, record) => {
    if (!/^(0|[1-9]\d*)$/.test(row[field]) || !Number.isSafeInteger(Number(row[field])) || Number(row[field]) > max) {
      error(file, record, field, 'INVALID_INTEGER', `Usa un entero decimal entre 0 y ${max}, sin signo ni separadores.`); return null;
    }
    return Number(row[field]);
  };
  let earliestBirth = String(Number(asOf.slice(0, 4)) - 130).padStart(4, '0') + asOf.slice(4);
  if (!calendarDate(earliestBirth)) earliestBirth = earliestBirth.slice(0, 8) + '28';

  for (const kind of ['products', 'lots', 'patients']) {
    const file = kind + '.csv'; let rows;
    try { rows = parseCsv(bundle[kind]); report.inputHashes[file] = digest(bundle[kind]); }
    catch (cause) { error(file, 0, '', String(cause.message || 'INVALID_CSV'), 'CSV inválido o fuera de sus límites; no se procesó este archivo.'); continue; }
    if (!rows.length || rows[0].join('\u0000') !== HEADERS[kind].join('\u0000')) {
      error(file, 1, '', 'INVALID_HEADER', 'Los encabezados y su orden deben coincidir exactamente con la plantilla v1.'); continue;
    }
    for (let index = 1; index < rows.length; index++) {
      const record = index + 1, before = errors.length; report.counts.input++;
      if (rows[index].length !== HEADERS[kind].length) { error(file, record, '', 'COLUMN_COUNT', 'El registro no contiene el número de columnas de la plantilla.'); continue; }
      const row = Object.fromEntries(HEADERS[kind].map((field, position) => [field, rows[index][position]]));
      if (!sourcePattern.test(row.sourceId)) error(file, record, 'sourceId', 'INVALID_SOURCE_ID', 'ID de fuente estable: 1–64 caracteres A–Z, dígitos, punto, guion o guion bajo.');
      if (row.synthetic !== 'true') error(file, record, 'synthetic', 'REAL_DATA_NOT_ALLOWED', 'Solo se acepta la declaración literal true; no cargar información real.');
      let normalized, businessKey;
      if (kind === 'products') {
        const sku = row.sku.trim().toUpperCase();
        if (!codePattern.test(sku)) error(file, record, 'sku', 'INVALID_SKU', 'SKU de 2–40 letras A–Z, dígitos o guiones.');
        if (!['INSUMOS', 'FARMACIA'].includes(row.category)) error(file, record, 'category', 'INVALID_CATEGORY', 'Categoría INSUMOS o FARMACIA; la categoría no autoriza uso clínico.');
        normalized = { sku, name: textField(row, 'name', 160, file, record), category: row.category,
          unit: textField(row, 'unit', 40, file, record), minimumStock: integer(row, 'minimumStock', 1000000, file, record) };
        businessKey = 'products/' + sku;
      } else if (kind === 'patients') {
        const reference = clean(row.reference).toUpperCase();
        if (!codePattern.test(reference)) error(file, record, 'reference', 'INVALID_REFERENCE', 'Referencia de 2–40 letras A–Z, dígitos o guiones.');
        const fullName = textField(row, 'fullName', 160, file, record, true, true);
        const phone = textField(row, 'phone', 30, file, record, false, true) || null;
        const email = textField(row, 'email', 160, file, record, false, true) || null;
        if (!calendarDate(row.birthDate) || row.birthDate < earliestBirth || row.birthDate > asOf)
          error(file, record, 'birthDate', 'INVALID_BIRTH_DATE', 'Nacimiento ISO entre la fecha de corte menos 130 años y la fecha de corte.');
        if (phone && !/^[0-9+() .-]{7,30}$/.test(phone)) error(file, record, 'phone', 'INVALID_PHONE', 'Teléfono opcional de 7–30 caracteres permitidos por el contrato.');
        if (email && !/^[^\s@]+@[^\s@]+\.invalid$/i.test(email)) error(file, record, 'email', 'SYNTHETIC_EMAIL_REQUIRED', 'En este ensayo el correo opcional debe terminar en .invalid.');
        normalized = { reference, fullName, birthDate: row.birthDate, phone, email, synthetic: true, duplicateReviewed: false };
        businessKey = 'patients/' + reference;
      } else {
        if (!sourcePattern.test(row.productSourceId)) error(file, record, 'productSourceId', 'INVALID_PRODUCT_SOURCE', 'La referencia al producto usa un sourceId de la plantilla.');
        const product = catalogs.products.get(row.productSourceId);
        if (!product) error(file, record, 'productSourceId', 'PRODUCT_NOT_FOUND', 'No existe un producto válido y no ambiguo con este ID de fuente.');
        const batch = textField(row, 'batch', 80, file, record).toUpperCase();
        const targetLotId = row.targetLotId || null;
        if (targetLotId && !uuidPattern.test(targetLotId)) error(file, record, 'targetLotId', 'INVALID_TARGET_ID', 'El ID de lote existente debe ser UUID; se verificará manualmente, nunca por este planificador.');
        if (!['true', 'false'].includes(row.quarantined)) error(file, record, 'quarantined', 'INVALID_BOOLEAN', 'Usa true o false literalmente.');
        if (row.expiresOn && !calendarDate(row.expiresOn)) error(file, record, 'expiresOn', 'INVALID_EXPIRY', 'Caducidad opcional ISO válida.');
        if (product?.data.category === 'FARMACIA' && !row.expiresOn) error(file, record, 'expiresOn', 'EXPIRY_REQUIRED', 'Farmacia requiere caducidad incluso en la plantilla sintética.');
        const recordedQuantity = integer(row, 'recordedQuantity', 1000000000, file, record);
        const countedQuantity = integer(row, 'countedQuantity', 1000000000, file, record);
        const reason = textField(row, 'reason', 240, file, record);
        if (!targetLotId && recordedQuantity !== 0) error(file, record, 'recordedQuantity', 'NEW_LOT_NOT_EMPTY', 'Un lote nuevo comienza en cero. Un saldo previo requiere identificar y verificar el lote existente.');
        const delta = recordedQuantity === null || countedQuantity === null ? null : countedQuantity - recordedQuantity;
        if (delta !== null && Math.abs(delta) > 1000000) error(file, record, 'countedQuantity', 'MOVEMENT_LIMIT', 'La diferencia excede un movimiento de 1 000 000; no se divide automáticamente.');
        if (delta !== null && delta > 0 && row.expiresOn && row.expiresOn < asOf)
          error(file, record, 'expiresOn', 'EXPIRED_RECEIPT', 'El contrato no permite incorporar unidades a un lote caducado. Separar y resolver fuera de este plan.');
        normalized = { productSourceKey: sourceKey('products', row.productSourceId), targetLotId, batch,
          expiresOn: row.expiresOn || null, quarantined: row.quarantined === 'true', recordedQuantity, countedQuantity, delta, reason };
        businessKey = `lots/${product?.data.sku || row.productSourceId}/${batch}`;
      }
      if (errors.length !== before) continue;
      const key = sourceKey(kind, row.sourceId), fingerprint = digest(JSON.stringify(normalized));
      const existingSource = catalogs[kind].get(row.sourceId);
      if (existingSource) {
        if (existingSource.fingerprint === fingerprint) duplicates.push({ sourceKey: key, file, record, retainedRecord: existingSource.record, action: 'IGNORED_IDENTICAL_SOURCE' });
        else error(file, record, 'sourceId', 'SOURCE_CONFLICT', 'El mismo ID de fuente tiene contenido distinto; no se eligió una versión.');
        continue;
      }
      if (businessKeys.has(businessKey)) {
        error(file, record, '', 'BUSINESS_KEY_CONFLICT', 'Otra fuente declara el mismo SKU, referencia o combinación producto/lote. Revisar sin fusionar automáticamente.'); continue;
      }
      if (kind === 'lots' && normalized.targetLotId && [...catalogs.lots.values()].some(item => item.data.targetLotId === normalized.targetLotId)) {
        error(file, record, 'targetLotId', 'TARGET_CONFLICT', 'Un lote existente aparece en dos filas de conteo; resolver antes de planificar.'); continue;
      }
      const item = { sourceKey: key, fingerprint, file, record, data: normalized, proposedSteps: [] };
      catalogs[kind].set(row.sourceId, item); businessKeys.set(businessKey, key); items.push(item);
      if (kind === 'products') item.proposedSteps.push('CHECK_EXISTING_SKU', 'REVIEW_PRODUCT_CREATION');
      if (kind === 'patients') {
        item.proposedSteps.push('CHECK_EXISTING_REFERENCE', 'REVIEW_SERVER_DUPLICATES', 'REVIEW_SYNTHETIC_PATIENT_CREATION');
        const candidates = [...catalogs.patients.values()].filter(other => other !== item &&
          (canonicalName(other.data.fullName) === canonicalName(normalized.fullName)
            || (normalized.phone && other.data.phone && other.data.birthDate === normalized.birthDate
              && other.data.phone.replace(/\D/g, '') === normalized.phone.replace(/\D/g, ''))));
        if (candidates.length) warning(file, record, 'fullName', 'POSSIBLE_DUPLICATE', 'Coincidencia por nombre o nacimiento/teléfono dentro del archivo. Revisión humana obligatoria, sin fusión ni duplicateReviewed automático.');
      }
      if (kind === 'lots') {
        item.proposedSteps.push(normalized.targetLotId ? 'VERIFY_EXISTING_LOT_AND_FRESH_BALANCE' : 'CHECK_EXISTING_PRODUCT_BATCH', 'RECOUNT_AND_AUTHORIZE');
        if (!normalized.targetLotId) item.proposedSteps.push('REVIEW_EMPTY_LOT_CREATION');
        item.proposedSteps.push(normalized.delta > 0 ? 'REVIEW_RECEIPT' : normalized.delta < 0 ? 'REVIEW_NEGATIVE_DIFFERENCE_NO_AUTOMATIC_MOVEMENT' : 'NO_STOCK_CHANGE');
        if (normalized.targetLotId) warning(file, record, 'targetLotId', 'UNVERIFIED_SNAPSHOT', 'ID, producto, condición, caducidad y saldo existentes no fueron contrastados con el servidor.');
        if (normalized.delta < 0) warning(file, record, 'countedQuantity', 'NEGATIVE_DIFFERENCE_REQUIRES_AUTHORIZATION', 'No es una devolución ni una baja automática; resolver la causa y autorización sin borrar historia.');
      }
    }
  }
  if (!report.counts.input && !errors.length) error('bundle', 0, '', 'EMPTY_BATCH', 'La carpeta no contiene registros para revisar.');
  report.counts = { input: report.counts.input, accepted: items.length, duplicates: duplicates.length, errors: errors.length, warnings: warnings.length };
  report.status = errors.length ? 'BLOCKED' : 'READY_FOR_REVIEW';
  // Any error invalidates the entire batch, including apparently valid proposals retained for diagnosis.
  report.planFingerprint = digest(JSON.stringify({ schemaVersion: 1, asOf, sourceSystem: manifest.sourceSystem,
    items: items.map(item => ({ sourceKey: item.sourceKey, fingerprint: item.fingerprint })) }));
  return report;
}

export function readBundle(directory) {
  const result = {};
  for (const key of ['manifest', 'products', 'lots', 'patients']) {
    const file = resolve(directory, key + (key === 'manifest' ? '.json' : '.csv'));
    const info = lstatSync(file), limit = key === 'manifest' ? LIMITS.manifestBytes : LIMITS.bytesPerCsv;
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw Error('INPUT_FILE_REJECTED');
    const bytes = readFileSync(file);
    if (bytes.length > limit) throw Error('INPUT_FILE_REJECTED');
    // Preserve an initial BOM in the input fingerprint; each parser handles it explicitly.
    result[key] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  return result;
}
export function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--as-of' || !argv[1] || !calendarDate(argv[3])) throw Error('INVALID_ARGUMENTS');
  return { input: argv[1], asOf: argv[3] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = parseArguments(process.argv.slice(2)), report = planImport(readBundle(args.input), args.asOf);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.status === 'BLOCKED' ? 2 : 0;
  } catch {
    // Do not echo unvalidated source data, absolute paths or environment values in an error.
    process.stderr.write('No se pudo planificar. Uso: node scripts/plan-synthetic-import.mjs --input <carpeta-sintetica> --as-of AAAA-MM-DD. Revisa archivos regulares UTF-8, esquema y límites. No se ejecutó ninguna importación.\n');
    process.exitCode = 2;
  }
}
