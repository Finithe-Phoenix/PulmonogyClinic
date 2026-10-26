import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { compareManifests } from '../scripts/verify-backup-restore.mjs';

type Constraint = { table_name: string; name: string; type: string; validated: boolean; definition: string };
type Manifest = Record<string, any> & { constraints: Constraint[] };
type EnumSpec = { table: string; name: string; column: string; values: string[] };

// Completely synthetic, self-contained schema metadata. No .local evidence,
// filesystem fixture, credentials, Docker process or database is consulted.
const enums: EnumSpec[] = [
  { table: 'cash_payment', name: 'cash_payment_method_check', column: 'method', values: ['CASH', 'CARD', 'TRANSFER'] },
  { table: 'equipment_asset', name: 'equipment_asset_status_check', column: 'status', values: ['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'] },
  { table: 'inventory_movement', name: 'inventory_movement_kind_check', column: 'kind', values: ['RECEIPT', 'ISSUE', 'DISPOSAL'] },
  { table: 'inventory_product', name: 'inventory_product_category_check', column: 'category', values: ['FARMACIA', 'INSUMOS'] },
  { table: 'operation_appointment', name: 'operation_appointment_source_check', column: 'source', values: ['LOCAL', 'DOCTORALIA_MANUAL'] },
  { table: 'operation_appointment', name: 'operation_appointment_status_check', column: 'status', values: ['BOOKED', 'ARRIVED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED'] },
  { table: 'purchase_line', name: 'purchase_line_category_check', column: 'category', values: ['FARMACIA', 'INSUMOS'] },
];
const tableNames = [
  'audit_event', 'cash_payment', 'cash_reversal', 'cash_shift', 'equipment_asset', 'equipment_maintenance',
  'flyway_schema_history', 'inventory_command', 'inventory_lot', 'inventory_movement', 'inventory_product',
  'operation_appointment', 'operation_appointment_event', 'operation_patient', 'purchase_line',
  'purchase_order', 'purchase_receipt', 'purchase_supplier',
];
function enumDefinition(spec: EnumSpec, form: 'array' | 'elements') {
  const literals = spec.values.map(value => form === 'array'
    ? `'${value}'::character varying` : `('${value}'::character varying)::text`).join(', ');
  return `CHECK (((${spec.column})::text = ANY (${form === 'array' ? `(ARRAY[${literals}])::text[]` : `ARRAY[${literals}]`})))`;
}
function fixture(form: 'array' | 'elements'): Manifest {
  return {
    tables: tableNames.map(tablename => ({ tablename })),
    data: tableNames.map((name, index) => ({ name, count: index + 1, sha256: (index + 1).toString(16).padStart(64, '0') })),
    columns: [{ table_name: 'cash_payment', column_name: 'amount_cents', data_type: 'bigint', is_nullable: 'NO' }],
    constraints: [
      ...enums.map(spec => ({ table_name: spec.table, name: spec.name, type: 'c', validated: true, definition: enumDefinition(spec, form) })),
      { table_name: 'cash_payment', name: 'cash_payment_amount_cents_check', type: 'c', validated: true, definition: 'CHECK (((amount_cents >= 1) AND (amount_cents <= 9000000000000)))' },
      { table_name: 'purchase_receipt', name: 'purchase_receipt_line_id_order_id_fkey', type: 'f', validated: true, definition: 'FOREIGN KEY (line_id, order_id) REFERENCES purchase_line(id, order_id)' },
    ],
    indexes: [{ tablename: 'cash_shift', indexname: 'cash_single_open_shift', indexdef: 'CREATE UNIQUE INDEX cash_single_open_shift ON public.cash_shift USING btree ((true)) WHERE (closed_at IS NULL)' }],
    triggers: [{ table_name: 'cash_payment', name: 'immutable_cash_payment', enabled: 'O', definition: 'CREATE TRIGGER immutable_cash_payment BEFORE DELETE OR UPDATE ON public.cash_payment FOR EACH ROW EXECUTE FUNCTION protect_inventory_history()' }],
    functions: [{ name: 'protect_inventory_history', definition: "CREATE FUNCTION protect_inventory_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;" }],
    sequences: [{ name: 'audit_event_id_seq', last_value: 9, is_called: true }],
    flyway: [{ installed_rank: 1, version: '1', script: 'V1__inventory.sql', checksum: 123456789, success: true, type: 'SQL' }],
    foreignKeys: [{ name: 'purchase_receipt_line_id_order_id_fkey', child: 'purchase_receipt', parent: 'purchase_line', columns: [{ child: 'line_id', parent: 'id' }, { child: 'order_id', parent: 'order_id' }] }],
    relations: [{ name: 'purchase_receipt_line_id_order_id_fkey', violations: 0 }],
  };
}
const source = fixture('array');
const restored = fixture('elements');
function rejectsMutation(change: (manifest: Manifest) => void, section: string, side: 'source' | 'restored' = 'restored') {
  const left = structuredClone(source);
  const right = structuredClone(restored);
  change(side === 'source' ? left : right);
  assert.ok(compareManifests(left, right).mismatchedSections.includes(section), `${side}.${section} must differ`);
}

test('backup comparison: importing helper has no I/O, output, CLI validation or process launch', async context => {
  const argv = process.argv;
  try {
    process.argv = [process.execPath, 'unit-test-host.ts', '--unrelated-host-argument'];
    const forbidden = () => { assert.fail('Helper import performed an external side effect'); };
    for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'] as const)
      context.mock.method(childProcess, method, forbidden);
    for (const method of ['mkdir', 'readFile', 'writeFile', 'readdir', 'realpath', 'lstat', 'chmod', 'rename'] as const)
      context.mock.method(fileSystem, method, forbidden);
    context.mock.method(console, 'log', forbidden);
    context.mock.method(console, 'error', forbidden);
    context.mock.method(process, 'exit', forbidden);
    syncBuiltinESMExports();
    const imported = await import('../scripts/verify-backup-restore.mjs?side-effect-test');
    assert.equal(typeof imported.compareManifests, 'function');
  } finally {
    process.argv = argv;
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
test('backup comparison: equal manifests have no raw or semantic differences', () => {
  assert.deepEqual(compareManifests(source, structuredClone(source)), {
    mismatchedSections: [], rawMismatchedSections: [], constraintRepresentationDifferences: [],
  });
});
test('backup comparison: seven accepted representations remain explicit evidence without mutating inputs', () => {
  const before = JSON.stringify([source, restored]);
  const result = compareManifests(source, restored);
  assert.deepEqual(result.mismatchedSections, []);
  assert.deepEqual(result.rawMismatchedSections, ['constraints']);
  assert.deepEqual(result.constraintRepresentationDifferences, enums.map(spec => ({
    table: spec.table, name: spec.name, reason: 'PG17_VARCHAR_ARRAY_TO_TEXT_ARRAY_VS_ELEMENT_CASTS',
  })));
  assert.equal(JSON.stringify([source, restored]), before);
});
for (const [index, spec] of enums.entries()) {
  test(`backup enum accepts only the representation change: ${spec.name}`, () => {
    const right = structuredClone(source);
    right.constraints[index] = restored.constraints[index];
    const forward = compareManifests(source, right);
    const reverse = compareManifests(right, source);
    assert.deepEqual(forward.mismatchedSections, []);
    assert.deepEqual(reverse.mismatchedSections, []);
    assert.equal(forward.constraintRepresentationDifferences.length, 1);
    assert.equal(reverse.constraintRepresentationDifferences.length, 1);
  });
  const expressionMutations: Array<[string, (definition: string) => string]> = [
    ['literal changed', value => value.replace(/'[A-Z][A-Z0-9_]*'/, "'FORGED_VALUE'")],
    ['literal removed', value => value.replace(/, \('[A-Z][A-Z0-9_]*'::character varying\)::text|, '[A-Z][A-Z0-9_]*'::character varying/, '')],
    ['literal duplicated', value => value.replace(spec.values[1], spec.values[0])],
    ['literal order changed', value => value.replaceAll(spec.values[0], '__TEMP__').replaceAll(spec.values[1], spec.values[0]).replaceAll('__TEMP__', spec.values[1])],
    ['literal added', value => value.replace('ARRAY[', "ARRAY['EXTRA'::character varying, ")],
    ['varchar precision added', value => value.replace('::character varying', '::character varying(1)')],
    ['varchar replaced with char', value => value.replace('::character varying', '::character(1)')],
    ['element type changed', value => value.replace('::character varying', '::integer')],
    ['array or element target cast changed', value => value.replace(/::text(?=\[\]|,|\])/, '::varchar')],
    ['column cast changed', value => value.replace(')::text =', ')::varchar =')],
    ['column changed', value => value.replace(`((${spec.column})`, '((different_column)')],
    ['operator changed', value => value.replace(' = ANY ', ' <> ANY ')],
    ['ANY changed to ALL', value => value.replace(' = ANY ', ' = ALL ')],
    ['cast removed', value => value.replace('::character varying', '')],
    ['collation added', value => value.replace(' = ANY ', ' COLLATE "C" = ANY ')],
    ['additional condition', value => value + ' OR true'],
    ['trailing expression', value => value + ' AND false'],
    ['unrecognized literal syntax', value => value.replace(`'${spec.values[0]}'`, `E'${spec.values[0]}'`)],
    ['unrecognized whitespace is not broadly normalized', value => value.replace(' = ANY ', '  = ANY ')],
  ];
  for (const [description, change] of expressionMutations) {
    for (const side of ['source', 'restored'] as const) {
      test(`backup enum rejects ${description} in ${side}: ${spec.name}`, () => rejectsMutation(manifest => {
        const before = manifest.constraints[index].definition;
        const after = change(before);
        assert.notEqual(after, before, 'The test must actually mutate the fixture');
        manifest.constraints[index].definition = after;
      }, 'constraints', side));
    }
  }
  for (const field of ['table_name', 'name', 'type', 'validated'] as const) {
    test(`backup enum does not normalize outside exact allowlist (${field}): ${spec.name}`, () => {
      const left = structuredClone(source);
      const right = structuredClone(restored);
      for (const manifest of [left, right]) {
        const constraint = manifest.constraints[index];
        if (field === 'validated') constraint.validated = false;
        else constraint[field] = `unexpected_${constraint[field]}`;
      }
      const result = compareManifests(left, right);
      assert.ok(result.mismatchedSections.includes('constraints'));
      assert.ok(!result.constraintRepresentationDifferences.some(entry => entry.name === left.constraints[index].name && entry.table === left.constraints[index].table_name));
    });
  }
}
for (const [index, row] of restored.data.entries()) {
  test(`backup rejects changed checksum: ${row.name}`, () => rejectsMutation(manifest => { manifest.data[index].sha256 = 'f'.repeat(64); }, 'data'));
  test(`backup rejects changed count: ${row.name}`, () => rejectsMutation(manifest => { manifest.data[index].count++; }, 'data'));
}
for (const [index, constraint] of restored.constraints.entries()) {
  test(`backup rejects deleted constraint: ${constraint.name}`, () => rejectsMutation(manifest => { manifest.constraints.splice(index, 1); }, 'constraints'));
  test(`backup rejects unvalidated constraint: ${constraint.name}`, () => rejectsMutation(manifest => { manifest.constraints[index].validated = false; }, 'constraints'));
  test(`backup rejects changed constraint definition: ${constraint.name}`, () => rejectsMutation(manifest => { manifest.constraints[index].definition += ' AND false'; }, 'constraints'));
}
for (const section of Object.keys(source)) {
  test(`backup compares every field, including unknown fields: ${section}`, () => rejectsMutation(manifest => { manifest[section][0].unexpectedField = 'synthetic-change'; }, section));
  if (section !== 'constraints') {
    test(`backup rejects missing section: ${section}`, () => rejectsMutation(manifest => { delete manifest[section]; }, section));
    test(`backup rejects extra row in section: ${section}`, () => rejectsMutation(manifest => { manifest[section].push(structuredClone(manifest[section][0])); }, section));
  }
}
test('backup fails closed when constraints section is missing', () => {
  const invalid = structuredClone(restored);
  delete invalid.constraints;
  assert.throws(() => compareManifests(source, invalid));
});
test('backup compares a future manifest section without an allowlist gap', () => rejectsMutation(manifest => { manifest.futureSection = [{ synthetic: true }]; }, 'futureSection'));
test('backup compares a future section missing from restored manifest', () => rejectsMutation(manifest => { manifest.futureSection = [{ synthetic: true }]; }, 'futureSection', 'source'));
test('backup rejects duplicate enum constraint records', () => rejectsMutation(manifest => { manifest.constraints.push(structuredClone(manifest.constraints[0])); }, 'constraints'));
test('backup rejects changed numeric CHECK bound', () => rejectsMutation(manifest => { manifest.constraints[7].definition = manifest.constraints[7].definition.replace('9000000000000', '9000000000001'); }, 'constraints'));
test('backup rejects changed composite FK column order', () => rejectsMutation(manifest => { manifest.constraints[8].definition = manifest.constraints[8].definition.replace('(line_id, order_id)', '(order_id, line_id)'); }, 'constraints'));
test('backup rejects changed sequence last value', () => rejectsMutation(manifest => { manifest.sequences[0].last_value++; }, 'sequences'));
test('backup rejects changed sequence is_called', () => rejectsMutation(manifest => { manifest.sequences[0].is_called = false; }, 'sequences'));
test('backup rejects changed Flyway checksum', () => rejectsMutation(manifest => { manifest.flyway[0].checksum++; }, 'flyway'));
test('backup rejects failed Flyway migration', () => rejectsMutation(manifest => { manifest.flyway[0].success = false; }, 'flyway'));
test('backup rejects missing migration', () => rejectsMutation(manifest => { manifest.flyway.pop(); }, 'flyway'));
test('backup rejects disabled history trigger', () => rejectsMutation(manifest => { manifest.triggers[0].enabled = 'D'; }, 'triggers'));
test('backup rejects orphan relations', () => rejectsMutation(manifest => { manifest.relations[0].violations++; }, 'relations'));
test('backup rejects changed composite FK mapping', () => rejectsMutation(manifest => { manifest.foreignKeys[0].columns[1].parent = 'id'; }, 'foreignKeys'));
test('backup rejects changed history function body', () => rejectsMutation(manifest => { manifest.functions[0].definition = 'RETURN NEW;'; }, 'functions'));
