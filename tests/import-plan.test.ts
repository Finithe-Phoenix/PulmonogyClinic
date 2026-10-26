import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { HEADERS, LIMITS, calendarDate, parseArguments, parseCsv, planImport, readBundle } from '../scripts/plan-synthetic-import.mjs';

const asOf = '2026-09-28';
const template = readBundle(fileURLToPath(new URL('../fixtures/import/v1/', import.meta.url)));
const fixture = () => ({ ...template });
const codes = (report: ReturnType<typeof planImport>) => report.errors.map((error: {code:string}) => error.code);
const encode = (value: string) => /[,"\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
function replaceCell(bundle: ReturnType<typeof fixture>, kind: 'products'|'lots'|'patients', record: number, field: string, value: string) {
  const rows = parseCsv(bundle[kind]);
  rows[record][HEADERS[kind].indexOf(field)] = value;
  bundle[kind] = rows.map((row: string[]) => row.map(encode).join(',')).join('\n') + '\n';
}

test('versioned fixture yields a deterministic six-row proposal, never an import', () => {
  const plan = planImport(fixture(), asOf);
  assert.equal(plan.status, 'READY_FOR_REVIEW'); assert.equal(plan.mode, 'DRY_RUN');
  assert.equal(plan.executionAllowed, false); assert.equal(plan.databaseChecked, false); assert.equal(plan.importedRecords, 0);
  assert.deepEqual(plan.counts, { input: 6, accepted: 6, duplicates: 0, errors: 0, warnings: 0 });
  assert.deepEqual(planImport(fixture(), asOf), plan);
  assert.equal(plan.items[0].sourceKey, 'SYNTHETIC-PILOT-V1/products/PROD-001');
  assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(plan.items[2].data.delta, 12);
  assert.ok(plan.items[2].proposedSteps.includes('REVIEW_RECEIPT'));
  assert.ok(plan.items.every((item: {data:object}) => !('id' in item.data) && !('idempotencyKey' in item.data)));
});

test('CSV supports BOM, CRLF, escaped quotes, commas and quoted newlines without evaluation', () => {
  assert.deepEqual(parseCsv('\uFEFFone,two\r\n"a,b","quote ""inside"""\r\n"line\nnext",=1+1\r\n'),
    [['one','two'],['a,b','quote "inside"'],['line\nnext','=1+1']]);
  assert.deepEqual(parseCsv('a,b\nx,'), [['a','b'],['x','']]);
  assert.deepEqual(parseCsv('a\n""'), [['a'],['']]);
  const bom = fixture(); bom.manifest = '\uFEFF' + bom.manifest; bom.products = '\uFEFF' + bom.products;
  const result = planImport(bom, asOf), original = planImport(fixture(), asOf);
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.planFingerprint, original.planFingerprint);
  assert.notEqual(result.inputHashes['products.csv'], original.inputHashes['products.csv']);
});

test('malformed or unbounded CSV fails closed', () => {
  for (const csv of ['a\n"unclosed', 'a\na"b', 'a\n"ok"evil', 'a\rb']) assert.throws(() => parseCsv(csv));
  assert.throws(() => parseCsv('x'.repeat(LIMITS.bytesPerCsv + 1)), /CSV_SIZE/);
  assert.throws(() => parseCsv('a\n' + 'x'.repeat(LIMITS.fieldLength + 1)), /CSV_FIELD_SIZE/);
  assert.throws(() => parseCsv('a\n' + 'x\n'.repeat(LIMITS.rowsPerCsv + 1)), /CSV_ROWS/);
  assert.throws(() => parseCsv(Array(21).fill('x').join(',')), /CSV_COLUMNS/);
});

test('unknown headers, extra cells, empty batch and malformed manifest are rejected', () => {
  const unknown = fixture(); unknown.products = unknown.products.replace('sourceId,', 'unknown,');
  assert.ok(codes(planImport(unknown, asOf)).includes('INVALID_HEADER'));
  const extra = fixture(); extra.products = extra.products.trimEnd() + ',unexpected\n';
  assert.ok(codes(planImport(extra, asOf)).includes('COLUMN_COUNT'));
  const empty = fixture(); for (const kind of ['products','lots','patients'] as const) empty[kind] = HEADERS[kind].join(',') + '\n';
  assert.ok(codes(planImport(empty, asOf)).includes('EMPTY_BATCH'));
  for (const manifest of ['{}', '{', '{"schemaVersion":1,"synthetic":false,"sourceSystem":"TEST"}',
    '{"schemaVersion":1,"synthetic":true,"sourceSystem":"TEST","apiUrl":"https://example.invalid"}']) {
    const bundle = fixture(); bundle.manifest = manifest;
    assert.deepEqual(codes(planImport(bundle, asOf)), ['INVALID_MANIFEST']);
  }
});

test('synthetic declaration, source IDs and strict optional synthetic email are enforced', () => {
  for (const [kind, field, value, code] of [
    ['patients','synthetic','false','REAL_DATA_NOT_ALLOWED'],
    ['products','sourceId','../personal','INVALID_SOURCE_ID'],
    ['patients','email','person@example.com','SYNTHETIC_EMAIL_REQUIRED'],
    ['products','name','Name\nwith controls','INVALID_TEXT'],
  ] as const) {
    const bundle = fixture(); replaceCell(bundle, kind, 1, field, value);
    assert.ok(codes(planImport(bundle, asOf)).includes(code));
  }
});

test('identical source duplicates collapse and conflicting source values block the entire plan', () => {
  const duplicate = fixture(); duplicate.products += duplicate.products.split('\n')[1] + '\n';
  const result = planImport(duplicate, asOf);
  assert.equal(result.status, 'READY_FOR_REVIEW'); assert.equal(result.counts.duplicates, 1); assert.equal(result.counts.accepted, 6);
  assert.equal(result.duplicates[0].action, 'IGNORED_IDENTICAL_SOURCE');
  assert.equal(result.planFingerprint, planImport(fixture(), asOf).planFingerprint);
  const conflict = fixture(); conflict.products += conflict.products.split('\n')[1].replace(',pieza,5,', ',pieza,9,') + '\n';
  const blocked = planImport(conflict, asOf);
  assert.equal(blocked.status, 'BLOCKED'); assert.equal(blocked.executionAllowed, false);
  assert.ok(codes(blocked).includes('SOURCE_CONFLICT'));
});

test('same business key under distinct source IDs never silently merges', () => {
  const bundle = fixture(); bundle.products += bundle.products.split('\n')[1].replace('PROD-001,', 'PROD-OTHER,') + '\n';
  assert.ok(codes(planImport(bundle, asOf)).includes('BUSINESS_KEY_CONFLICT'));
  const patients = fixture(); replaceCell(patients, 'patients', 2, 'reference', 'syn-pilot-pac-001');
  assert.ok(codes(planImport(patients, asOf)).includes('BUSINESS_KEY_CONFLICT'));
});

test('homonyms and shared birth/phone require review but are never merged or auto-approved', () => {
  const names = fixture(); replaceCell(names, 'patients', 2, 'fullName', '  persona  fícticia ALBA  ');
  const homonyms = planImport(names, asOf);
  assert.ok(homonyms.warnings.some((warning: {code:string}) => warning.code === 'POSSIBLE_DUPLICATE'));
  assert.equal(homonyms.items.filter((item: {file:string}) => item.file === 'patients.csv').length, 2);
  assert.ok(homonyms.items.filter((item: {file:string}) => item.file === 'patients.csv').every((item: {data:{duplicateReviewed:boolean}}) => !item.data.duplicateReviewed));
  const phones = fixture();
  replaceCell(phones, 'patients', 1, 'phone', '+52 (722) 000 0000');
  replaceCell(phones, 'patients', 2, 'phone', '+527220000000');
  replaceCell(phones, 'patients', 2, 'birthDate', '1990-05-17');
  assert.ok(planImport(phones, asOf).warnings.some((warning: {code:string}) => warning.code === 'POSSIBLE_DUPLICATE'));
});

test('calendar validation, pharmacy expiry and expired positive count follow existing contracts', () => {
  assert.equal(calendarDate('2024-02-29'), true); assert.equal(calendarDate('2025-02-29'), false);
  assert.equal(calendarDate('0000-01-01'), false); assert.equal(calendarDate('2026-13-01'), false);
  const invalidBirth = fixture(); replaceCell(invalidBirth, 'patients', 1, 'birthDate', '2027-01-01');
  assert.ok(codes(planImport(invalidBirth, asOf)).includes('INVALID_BIRTH_DATE'));
  const oldBirth = fixture(); replaceCell(oldBirth, 'patients', 1, 'birthDate', '1800-01-01');
  assert.ok(codes(planImport(oldBirth, asOf)).includes('INVALID_BIRTH_DATE'));
  const missingExpiry = fixture(); replaceCell(missingExpiry, 'lots', 2, 'expiresOn', '');
  assert.ok(codes(planImport(missingExpiry, asOf)).includes('EXPIRY_REQUIRED'));
  const expired = fixture(); replaceCell(expired, 'lots', 2, 'expiresOn', '2026-09-27');
  assert.ok(codes(planImport(expired, asOf)).includes('EXPIRED_RECEIPT'));
});

test('relationships, counts, movement bounds and existing-lot identity are validated', () => {
  for (const [field, value, code] of [
    ['productSourceId','MISSING','PRODUCT_NOT_FOUND'], ['recordedQuantity','4','NEW_LOT_NOT_EMPTY'],
    ['countedQuantity','1.5','INVALID_INTEGER'], ['countedQuantity','1000001','MOVEMENT_LIMIT'],
    ['countedQuantity','-1','INVALID_INTEGER'], ['countedQuantity','1e3','INVALID_INTEGER'],
    ['countedQuantity','9007199254740993','INVALID_INTEGER'], ['targetLotId','not-an-id','INVALID_TARGET_ID'],
    ['quarantined','yes','INVALID_BOOLEAN'],
  ]) {
    const bundle = fixture(); replaceCell(bundle, 'lots', 1, field, value);
    assert.ok(codes(planImport(bundle, asOf)).includes(code), code);
  }
});

test('negative or unchanged count does not manufacture a movement or a return policy', () => {
  const bundle = fixture();
  replaceCell(bundle, 'lots', 1, 'targetLotId', '11111111-1111-4111-8111-111111111111');
  replaceCell(bundle, 'lots', 1, 'recordedQuantity', '13');
  const plan = planImport(bundle, asOf), item = plan.items.find((value: {file:string;record:number}) => value.file === 'lots.csv' && value.record === 2);
  assert.equal(plan.status, 'READY_FOR_REVIEW'); assert.equal(item.data.delta, -1);
  assert.ok(item.proposedSteps.includes('REVIEW_NEGATIVE_DIFFERENCE_NO_AUTOMATIC_MOVEMENT'));
  assert.ok(!item.proposedSteps.includes('DISPOSAL')); assert.ok(!item.proposedSteps.includes('ISSUE'));
  assert.ok(plan.warnings.some((warning: {code:string}) => warning.code === 'UNVERIFIED_SNAPSHOT'));
  replaceCell(bundle, 'lots', 1, 'recordedQuantity', '12');
  assert.ok(planImport(bundle, asOf).items.find((value: {file:string}) => value.file === 'lots.csv').proposedSteps.includes('NO_STOCK_CHANGE'));
});

test('CLI admits only dry-run input and explicit date, never output paths or execution flags', () => {
  assert.deepEqual(parseArguments(['--input','fixtures/import/v1','--as-of',asOf]), { input:'fixtures/import/v1', asOf });
  for (const args of [[], ['--execute'], ['--input','x','--as-of','bad'], ['--input','x','--as-of',asOf,'--apply'], ['--input','x','--output','report.json']])
    assert.throws(() => parseArguments(args));
  assert.equal(planImport(fixture(), '2026-02-30').status, 'BLOCKED');
});
