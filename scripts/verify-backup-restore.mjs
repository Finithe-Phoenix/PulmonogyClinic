#!/usr/bin/env node
// Synthetic-only rehearsal. This program has no option for an existing database or dump.
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, realpath, lstat, chmod, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const isMain = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
const arguments_ = process.argv.slice(2);
if (isMain && (arguments_.some(value => !['--apply', '--help'].includes(value)) || new Set(arguments_).size !== arguments_.length)) {
  console.error('Solo se admite --apply o --help. No se aceptan bases, contenedores ni archivos externos.');
  process.exit(2);
}
const apply = arguments_.includes('--apply') && !arguments_.includes('--help');
const runId = randomUUID();
const prefix = `pulmonogy-backup-${runId}`;
const relativeDirectory = `.local/backup-restore/${runId}`;
const directory = path.join(root, relativeDirectory);
const label = 'mx.pulmonogy.backup-rehearsal';
const user = 'rehearsal';
const sourceDatabase = 'clinic_fixture';
const targetDatabase = 'clinic_restore';
const postgresImage = 'postgres:17';
const apiImage = 'pulmonogy-private-dev-api';
const tables = [
  'audit_event', 'cash_payment', 'cash_reversal', 'cash_shift', 'equipment_asset',
  'equipment_maintenance', 'flyway_schema_history', 'inventory_command', 'inventory_lot',
  'inventory_movement', 'inventory_product', 'operation_appointment', 'operation_appointment_event',
  'operation_patient', 'purchase_line', 'purchase_order', 'purchase_receipt', 'purchase_supplier',
];
const resources = [];
const evidence = {
  format: 1, scope: 'SYNTHETIC_FIXTURE_ONLY', runId, status: 'PREPARING',
  startedAt: new Date().toISOString(), resources, checks: {},
  limits: ['Not production recovery', 'No real clinic or test database accessed',
    'Local encryption key is not independent key custody', 'No roles, Keycloak, WAL/PITR or attachments backed up'],
};
let stage = 'preflight';
let evidenceReady = false;
let holder;
const sha = value => createHash('sha256').update(value).digest('hex');
const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Identificador SQL fuera de la lista segura.');
  return `"${value}"`;
};

function execute(command, args, input, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error(`Tiempo excedido en ${stage}; salida omitida por seguridad.`)); }, timeout);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(Buffer.concat(chunks));
    };
    child.on('error', () => finish(new Error(`No se pudo iniciar ${command} durante ${stage}.`)));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { child.kill(); finish(new Error('Salida excede el límite de 32 MiB del fixture.')); }
      else chunks.push(chunk);
    });
    // SQL errors, startup logs and Docker inspection can contain values; never echo them.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', code => finish(code === 0 ? null : new Error(`${command} falló en ${stage} (código ${code ?? 'desconocido'}); salida omitida.`)));
    child.stdin.end(input);
  });
}
const docker = async (args, input) => execute('docker', args, input);
const text = async (args, input) => (await docker(args, input)).toString('utf8').trim();
async function saveEvidence() {
  if (!evidenceReady) return;
  await writeFile(path.join(directory, 'evidence.next.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  await rename(path.join(directory, 'evidence.next.json'), path.join(directory, 'evidence.json'));
}
async function privateDirectory(target) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const actual = await realpath(target);
  if (actual.toLowerCase() !== path.resolve(target).toLowerCase() || (await lstat(target)).isSymbolicLink())
    throw new Error('Se rechazó una ruta redirigida para los artefactos.');
  if (process.platform === 'win32') {
    const identity = (await execute('whoami', ['/user', '/fo', 'csv', '/nh'])).toString('utf8').match(/S-1-5-(?:\d+-)*\d+/)?.[0];
    if (!identity) throw new Error('No se pudo determinar el SID para proteger la carpeta.');
    await execute('icacls', [target, '/inheritance:r', '/grant:r', `*${identity}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
  } else await chmod(target, 0o700);
}
async function secretFile(name, value) {
  await writeFile(path.join(directory, name), value, { mode: 0o600, flag: 'wx' });
}
function flywayChecksum(content) {
  // Flyway CRC32 over UTF-8 lines, without BOM or line terminators (signed Java int).
  let crc = 0xffffffff;
  for (const byte of Buffer.from(content.replace(/^\uFEFF/, '').replace(/\r\n|\r|\n/g, ''), 'utf8')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) | 0;
}
async function migrationManifest() {
  const migrationDirectory = path.join(root, 'backend/src/main/resources/db/migration');
  const names = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
  const expected = ['V1__inventory.sql', 'V2__purchasing.sql', 'V3__operations.sql', 'V4__cash.sql', 'V5__equipment.sql'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('El ensayo debe revisarse si cambia el conjunto de migraciones V1..V5.');
  return Promise.all(names.map(async name => {
    const bytes = await readFile(path.join(migrationDirectory, name));
    return { script: name, version: name[1], checksum: flywayChecksum(bytes.toString('utf8')), sha256: sha(bytes) };
  }));
}
async function imageId(name) {
  const id = await text(['image', 'inspect', '--format', '{{.Id}}', name]);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('No se verificó la imagen local requerida. No se descargan imágenes automáticamente.');
  return id;
}
async function createContainer(role, image, args, network = 'none') {
  const name = `${prefix}-${role}`;
  const id = await text(['create', '--name', name, '--label', `${label}=${runId}`,
    '--label', 'mx.pulmonogy.purpose=synthetic-backup-rehearsal', '--network', network,
    '--pids-limit', '256', '--cpus', '1', '--memory', role === 'migrate' ? '768m' : '512m',
    ...args, image]);
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Docker no devolvió un ID completo; revise el nombre exacto del plan.');
  const resource = { role, id, name, image, network, removed: false };
  resources.push(resource);
  await saveEvidence();
  await assertOwned(resource);
  await docker(['start', id]);
  return resource;
}
async function assertOwned(resource) {
  if (!resources.includes(resource) || !/^[a-f0-9]{64}$/.test(resource.id)) throw new Error('Recurso no registrado en esta ejecución.');
  const info = JSON.parse(await text(['inspect', '--format',
    '{{json .Name}}|{{json .Config.Labels}}|{{json .HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .Mounts}}|{{json .Image}}', resource.id])
    .then(value => '[' + value.split('|').join(',') + ']'));
  if (info[0] !== `/${resource.name}` || info[1]?.[label] !== runId
    || info[1]?.['mx.pulmonogy.purpose'] !== 'synthetic-backup-rehearsal' || info[2] !== resource.network
    || Object.keys(info[3] ?? {}).length || info[4].some(mount => mount.Type !== 'tmpfs') || info[5] !== resource.image)
    throw new Error('Propiedad o aislamiento inesperado. No se modificará ni retirará este contenedor.');
}
async function removeOwned(resource) {
  if (resource.removed) return;
  await assertOwned(resource);
  // No volumes, existing names, Compose commands, pruning, or database deletion.
  await docker(['rm', '--force', resource.id]);
  resource.removed = true;
  await saveEvidence();
}
function sqlArguments(resource, database) {
  if (!resources.includes(resource) || !['source', 'restore'].includes(resource.role)
    || database !== (resource.role === 'source' ? sourceDatabase : targetDatabase)) throw new Error('Destino SQL fuera del fixture.');
  return ['exec', '-i', resource.id, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database];
}
async function sql(resource, database, query) {
  return text(sqlArguments(resource, database), `SET TIME ZONE 'UTC'; SET statement_timeout='25s';\n${query}\n`);
}
async function waitDatabase(resource, database) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const version = Number(await sql(resource, database, 'SHOW server_version_num;'));
      if (version < 170000 || version >= 180000) throw new Error('El servidor no es PostgreSQL 17.');
      return version;
    } catch { await delay(1000); }
  }
  throw new Error('El PostgreSQL sintético no quedó disponible en el plazo esperado.');
}
async function exportSnapshot(resource) {
  const child = spawn('docker', sqlArguments(resource, sourceDatabase), { cwd: root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let snapshot;
  let closed = false;
  let failed = false;
  let output = '';
  child.on('error', () => { failed = true; });
  child.on('close', () => { closed = true; });
  child.stderr.resume();
  child.stdin.on('error', () => { failed = true; });
  child.stdout.on('data', data => {
    output += data.toString('utf8');
    snapshot = output.match(/(?:^|\n)([0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+)(?:\r?\n|$)/)?.[1];
  });
  child.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n");
  const session = {
    get id() { return snapshot; },
    healthy() { if (!snapshot || closed || failed) throw new Error('Se perdió la sesión del snapshot; no se aceptará la comparación.'); },
    async end() {
      if (!closed) child.stdin.end('ROLLBACK;\n');
      for (let attempt = 0; attempt < 20 && !closed; attempt++) await delay(100);
      if (!closed) child.kill();
    },
  };
  holder = session;
  for (let attempt = 0; attempt < 100 && !snapshot && !closed && !failed; attempt++) await delay(100);
  session.healthy();
  return session;
}
const aggregate = query => `(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), '[]'::jsonb) FROM (${query}) x)`;
async function manifest(resource, database, snapshot) {
  const begin = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ${snapshot ? `SET TRANSACTION SNAPSHOT '${snapshot}';` : ''}`;
  if (snapshot && !/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+$/.test(snapshot)) throw new Error('Snapshot inválido.');
  const data = tables.map(table => `SELECT '${table}' AS name, count(*) AS count,
    encode(sha256(convert_to(coalesce(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
    FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS row_hash FROM public.${identifier(table)} t) row_digests`).join('\nUNION ALL\n');
  const query = `${begin}
    SELECT jsonb_build_object(
      'tables', ${aggregate("SELECT tablename FROM pg_tables WHERE schemaname='public'")},
      'data', ${aggregate(data)},
      'columns', ${aggregate("SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, is_identity, identity_generation FROM information_schema.columns WHERE table_schema='public'")},
      'constraints', ${aggregate("SELECT r.relname AS table_name, c.conname AS name, c.contype AS type, c.convalidated AS validated, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'")},
      'indexes', ${aggregate("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'")},
      'triggers', ${aggregate("SELECT r.relname AS table_name, t.tgname AS name, t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")},
      'functions', ${aggregate("SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")},
      'sequences', ${aggregate("SELECT 'audit_event_id_seq' AS name, last_value, is_called FROM public.audit_event_id_seq")},
      'flyway', ${aggregate('SELECT installed_rank, version, description, type, script, checksum, success FROM public.flyway_schema_history')},
      'foreignKeys', ${aggregate(`SELECT c.conname AS name, child.relname AS child, parent.relname AS parent,
        (SELECT jsonb_agg(jsonb_build_object('child', ca.attname, 'parent', pa.attname) ORDER BY k.n)
          FROM unnest(c.conkey, c.confkey) WITH ORDINALITY k(child_num, parent_num, n)
          JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.child_num
          JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parent_num) AS columns
        FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
        JOIN pg_namespace n ON n.oid=child.relnamespace WHERE n.nspname='public' AND c.contype='f'`)});
    ROLLBACK;`;
  const result = JSON.parse(await sql(resource, database, query));
  if (JSON.stringify(result.tables.map(row => row.tablename).sort()) !== JSON.stringify(tables)) throw new Error('Tablas inesperadas en la base sintética.');
  if (result.constraints.some(row => !row.validated) || result.triggers.some(row => row.enabled !== 'O'))
    throw new Error('Hay restricciones sin validar o triggers deshabilitados.');
  const checks = result.foreignKeys.map(fk => {
    if (!tables.includes(fk.child) || !tables.includes(fk.parent)) throw new Error('Relación fuera del esquema esperado.');
    identifier(fk.name);
    const present = fk.columns.map(column => `c.${identifier(column.child)} IS NOT NULL`).join(' AND ');
    const joined = fk.columns.map(column => `c.${identifier(column.child)} = p.${identifier(column.parent)}`).join(' AND ');
    return `SELECT '${fk.name}' AS name, count(*) AS violations FROM public.${identifier(fk.child)} c WHERE ${present}
      AND NOT EXISTS (SELECT 1 FROM public.${identifier(fk.parent)} p WHERE ${joined})`;
  });
  result.relations = JSON.parse(await sql(resource, database, `${begin} SELECT ${aggregate(checks.join(' UNION ALL '))}; ROLLBACK;`));
  if (result.relations.some(row => row.violations !== 0)) throw new Error('Se encontraron relaciones huérfanas.');
  return result;
}
function checkFlyway(actual, expected) {
  if (actual.length !== expected.length || expected.some(wanted => !actual.some(found =>
    found.script === wanted.script && found.version === wanted.version && found.checksum === wanted.checksum && found.success === true && found.type === 'SQL')))
    throw new Error('Flyway no coincide con V1..V5 locales. Reconstruye la imagen API fuera del ensayo y revisa migraciones.');
}
const enumChecks = new Map([
  ['cash_payment.cash_payment_method_check', 'method'],
  ['equipment_asset.equipment_asset_status_check', 'status'],
  ['inventory_movement.inventory_movement_kind_check', 'kind'],
  ['inventory_product.inventory_product_category_check', 'category'],
  ['operation_appointment.operation_appointment_source_check', 'source'],
  ['operation_appointment.operation_appointment_status_check', 'status'],
  ['purchase_line.purchase_line_category_check', 'category'],
]);
function canonicalEnumCheck(constraint) {
  const column = enumChecks.get(`${constraint.table_name}.${constraint.name}`);
  if (!column || constraint.type !== 'c' || constraint.validated !== true) return constraint;
  const prefix_ = `CHECK (((${column})::text = ANY (`;
  const suffix_ = ')))';
  const definition = constraint.definition;
  if (!definition.startsWith(prefix_) || !definition.endsWith(suffix_)) return constraint;
  const array = definition.slice(prefix_.length, -suffix_.length);
  // pg_get_constraintdef decompiles SQL, not the original command. On PG17 a
  // restore may distribute varchar[] -> text[] over each literal element.
  // Recognize only these two complete forms for the seven known enum checks.
  // Never remove arbitrary casts, reorder literals or normalize other SQL.
  let literals;
  if (array.startsWith('(ARRAY[') && array.endsWith('])::text[]')) {
    const list = array.slice('(ARRAY['.length, -'])::text[]'.length);
    if (!/^'[A-Z][A-Z0-9_]*'::character varying(?:, '[A-Z][A-Z0-9_]*'::character varying)*$/.test(list)) return constraint;
    literals = [...list.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(match => match[1]);
  } else if (array.startsWith('ARRAY[') && array.endsWith(']')) {
    const list = array.slice('ARRAY['.length, -1);
    if (!/^\('[A-Z][A-Z0-9_]*'::character varying\)::text(?:, \('[A-Z][A-Z0-9_]*'::character varying\)::text)*$/.test(list)) return constraint;
    literals = [...list.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(match => match[1]);
  } else return constraint;
  return { ...constraint, definition: `${prefix_}(ARRAY[${literals.map(value => `'${value}'::character varying`).join(', ')}])::text[]${suffix_}` };
}
export function compareManifests(source, restored) {
  // Preserve both raw manifests. Canonicalization changes only the comparison
  // representation, and any accepted raw difference remains explicit evidence.
  const canonical = manifest_ => ({ ...manifest_, constraints: manifest_.constraints.map(canonicalEnumCheck) });
  const left = canonical(source);
  const right = canonical(restored);
  const sections = [...new Set([...Object.keys(source), ...Object.keys(restored)])];
  const mismatchedSections = sections.filter(key_ => JSON.stringify(left[key_]) !== JSON.stringify(right[key_]));
  const rawMismatchedSections = sections.filter(key_ => JSON.stringify(source[key_]) !== JSON.stringify(restored[key_]));
  const constraintRepresentationDifferences = source.constraints.flatMap(original => {
    const matches = restored.constraints.filter(candidate => candidate.name === original.name && candidate.table_name === original.table_name);
    if (matches.length !== 1 || JSON.stringify(original) === JSON.stringify(matches[0])
      || JSON.stringify(canonicalEnumCheck(original)) !== JSON.stringify(canonicalEnumCheck(matches[0]))) return [];
    return [{ table: original.table_name, name: original.name, reason: 'PG17_VARCHAR_ARRAY_TO_TEXT_ARRAY_VS_ELEMENT_CASTS' }];
  });
  return { mismatchedSections, rawMismatchedSections, constraintRepresentationDifferences };
}
function uuid(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`; }
function fixtureSql() {
  const id = number => `'${uuid(number)}'`;
  return `BEGIN;
    INSERT INTO inventory_command(id,request_hash,actor,result)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, repeat('a',64), 'SYNTHETIC-REHEARSAL', '{"synthetic":true}'::jsonb FROM generate_series(1,9) n;
    INSERT INTO inventory_product VALUES(${id(101)},'SYNTHETIC-PRODUCT','Producto sintético de ensayo','INSUMOS','pieza',2);
    INSERT INTO inventory_lot VALUES(${id(102)},${id(101)},'SYNTHETIC-LOT','2030-12-31',7,false);
    INSERT INTO inventory_movement(id,command_id,lot_id,kind,quantity,balance_after,reason,actor) VALUES
      (${id(103)},${id(1)},${id(102)},'RECEIPT',10,10,'Recepción sintética','SYNTHETIC-REHEARSAL'),
      (${id(104)},${id(2)},${id(102)},'ISSUE',3,7,'Salida sintética','SYNTHETIC-REHEARSAL');
    INSERT INTO purchase_supplier VALUES(${id(201)},'SYNTHETIC-SUPPLIER','Proveedor sintético');
    INSERT INTO purchase_order(id,reference,supplier_id,order_date,expected_on) VALUES(${id(202)},'SYNTHETIC-ORDER',${id(201)},'2026-01-01','2026-01-02');
    INSERT INTO purchase_line VALUES(${id(203)},${id(202)},${id(101)},0,'SYNTHETIC-PRODUCT','Producto sintético de ensayo','INSUMOS','pieza',12,10,12345);
    INSERT INTO purchase_receipt(id,reference,command_id,order_id,line_id,lot_id,movement_id,batch,expires_on,quarantined,quantity,unit_cost_cents,actor)
      VALUES(${id(204)},'SYNTHETIC-RECEIPT',${id(1)},${id(202)},${id(203)},${id(102)},${id(103)},'SYNTHETIC-LOT','2030-12-31',false,10,12345,'SYNTHETIC-REHEARSAL');
    INSERT INTO operation_patient(id,reference,full_name,normalized_name,birth_date,synthetic)
      VALUES(${id(301)},'SYNTHETIC-PATIENT','Paciente sintético de restauración','paciente sintetico de restauracion','2000-01-01',true);
    INSERT INTO operation_appointment(id,patient_id,starts_at,ends_at,duration_minutes,service,practitioner,resource,source,status,version)
      VALUES(${id(302)},${id(301)},'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z',30,'Servicio sintético','SYNTHETIC-PRACTITIONER','SYNTHETIC-EQUIPMENT','LOCAL','ARRIVED',1);
    INSERT INTO operation_appointment_event(id,appointment_id,command_id,action,from_status,to_status,version,starts_at,ends_at,practitioner,resource,reason,actor)
      VALUES(${id(303)},${id(302)},${id(3)},'STATUS_CHANGED','BOOKED','ARRIVED',1,'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z','SYNTHETIC-PRACTITIONER','SYNTHETIC-EQUIPMENT','Llegada sintética','SYNTHETIC-REHEARSAL');
    INSERT INTO cash_shift(id,reference,opening_command_id,opening_float_cents,opened_by)
      VALUES(${id(401)},'SYNTHETIC-SHIFT',${id(4)},10000,'SYNTHETIC-REHEARSAL');
    INSERT INTO cash_payment(id,shift_id,command_id,reference,amount_cents,method,operation_reference,actor) VALUES
      (${id(402)},${id(401)},${id(5)},'SYNTHETIC-CASH',12345,'CASH','SYNTHETIC-PATIENT','SYNTHETIC-REHEARSAL'),
      (${id(403)},${id(401)},${id(6)},'SYNTHETIC-CARD',5010,'CARD',null,'SYNTHETIC-REHEARSAL');
    INSERT INTO cash_reversal(id,payment_id,command_id,reason,actor) VALUES(${id(404)},${id(403)},${id(7)},'Reverso sintético','SYNTHETIC-REHEARSAL');
    UPDATE cash_shift SET closing_command_id=${id(8)},closed_by='SYNTHETIC-REHEARSAL',closed_at=clock_timestamp(),
      counted_cash_cents=22000,expected_cash_cents=22345,closure_reason='Diferencia sintética -345 centavos' WHERE id=${id(401)};
    INSERT INTO equipment_asset(id,reference,name,location,serial_number,status,version)
      VALUES(${id(501)},'SYNTHETIC-EQUIPMENT','Equipo sintético','Sala sintética','SYNTHETIC-SERIAL','MAINTENANCE',1);
    INSERT INTO equipment_maintenance(id,asset_id,command_id,performed_on,next_due_on,description,technician,actor,asset_version)
      VALUES(${id(502)},${id(501)},${id(9)},'2026-01-01','2026-07-01','Mantenimiento sintético','Técnico sintético','SYNTHETIC-REHEARSAL',1);
    INSERT INTO audit_event(command_id,action,entity_id,actor,reason) SELECT id,'SYNTHETIC_FIXTURE',id,actor,'Solo ensayo sintético' FROM inventory_command;
    DO $$ BEGIN
      IF (SELECT quantity FROM inventory_lot WHERE id=${id(102)}) <> 7
        OR (SELECT sum(CASE WHEN kind='RECEIPT' THEN quantity ELSE -quantity END) FROM inventory_movement) <> 7
        OR (SELECT received FROM purchase_line WHERE id=${id(203)}) <> (SELECT sum(quantity) FROM purchase_receipt)
        OR (SELECT counted_cash_cents-expected_cash_cents FROM cash_shift) <> -345
        OR (SELECT sum(amount_cents) FROM cash_payment p WHERE NOT EXISTS(SELECT 1 FROM cash_reversal r WHERE r.payment_id=p.id)) <> 12345
        OR (SELECT count(*) FROM operation_patient WHERE synthetic) <> 1
      THEN RAISE EXCEPTION 'Synthetic fixture invariant failed'; END IF;
    END $$;
    COMMIT;`;
}

async function main() {
  const migrations = await migrationManifest();
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', scope: 'SYNTHETIC_FIXTURE_ONLY',
    runId, artifacts: relativeDirectory, names: ['source', 'migrate', 'restore'].map(role => `${prefix}-${role}`),
    requiredLocalImages: [postgresImage, apiImage], databaseNames: [sourceDatabase, targetDatabase],
    tables: tables.length, migrations: migrations.map(row => row.script),
    safety: 'No Compose, no existing database, no ports, no pulls, no backup deletion. --apply is deliberate.' }, null, 2));
  if (!apply) return;
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 como el proyecto.');
  await execute('git', ['check-ignore', '-q', '--', `${relativeDirectory}/evidence.json`]);
  const localDirectory = path.join(root, '.local');
  await mkdir(localDirectory, { recursive: true });
  if ((await realpath(localDirectory)).toLowerCase() !== localDirectory.toLowerCase()) throw new Error('.local está redirigido.');
  // A fresh UUID directory must not already exist; no pre-existing ACLs or files are changed.
  await mkdir(path.join(root, '.local/backup-restore'), { recursive: true });
  if ((await realpath(path.dirname(directory))).toLowerCase() !== path.dirname(directory).toLowerCase()) throw new Error('El directorio de respaldos está redirigido.');
  await mkdir(directory, { mode: 0o700 });
  await privateDirectory(directory);
  evidenceReady = true;
  evidence.migrations = migrations;
  await saveEvidence();
  const pgId = await imageId(postgresImage);
  const appId = await imageId(apiImage);
  evidence.images = { postgres: pgId, api: appId };
  const password = randomBytes(32).toString('base64url');
  await secretFile('source.env', `POSTGRES_USER=${user}\nPOSTGRES_DB=${sourceDatabase}\nPOSTGRES_PASSWORD=${password}\n`);
  await secretFile('restore.env', `POSTGRES_USER=${user}\nPOSTGRES_DB=${targetDatabase}\nPOSTGRES_PASSWORD=${password}\n`);
  await secretFile('migrate.env', `DB_URL=jdbc:postgresql://127.0.0.1:5432/${sourceDatabase}\nDB_USER=${user}\nDB_PASSWORD=${password}\nOIDC_ISSUER_URI=http://127.0.0.1:9/fixture\nOIDC_JWK_SET_URI=http://127.0.0.1:9/fixture/jwks\n`);
  stage = 'crear fuente sintética';
  const source = await createContainer('source', pgId, ['--tmpfs', '/var/lib/postgresql/data:rw,nosuid,noexec,size=268435456', '--env-file', path.join(directory, 'source.env')]);
  evidence.postgresVersion = await waitDatabase(source, sourceDatabase);
  stage = 'migraciones Flyway reales';
  const migrator = await createContainer('migrate', appId, ['--env-file', path.join(directory, 'migrate.env')], `container:${source.id}`);
  let migrated = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { migrated = Number(await sql(source, sourceDatabase, 'SELECT count(*) FROM flyway_schema_history WHERE success;')) === 5; } catch { /* Startup may still be migrating. */ }
    if (migrated) break;
    await delay(1000);
  }
  if (!migrated) throw new Error('Flyway no aplicó las cinco migraciones dentro del plazo.');
  await removeOwned(migrator);
  const versions = JSON.parse(await sql(source, sourceDatabase, `SELECT ${aggregate('SELECT version,script,checksum,success,type FROM flyway_schema_history')};`));
  checkFlyway(versions, migrations);
  stage = 'sembrar y congelar fixture';
  await sql(source, sourceDatabase, fixtureSql());
  await sql(source, sourceDatabase, `ALTER DATABASE ${identifier(sourceDatabase)} SET default_transaction_read_only = on;`);
  if (Number(await sql(source, sourceDatabase, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';")) !== 0)
    throw new Error('La fuente no está libre de otros clientes.');
  const snapshot = await exportSnapshot(source);
  stage = 'manifest y pg_dump del mismo snapshot';
  const original = await manifest(source, sourceDatabase, snapshot.id);
  if (original.data.some(row => row.count < 1)) throw new Error('El fixture debe cubrir todas las tablas.');
  checkFlyway(original.flyway, migrations);
  snapshot.healthy();
  const dump = await docker(['exec', source.id, 'pg_dump', '-U', user, '-d', sourceDatabase,
    '--format=custom', '--no-owner', '--no-acl', '--lock-wait-timeout=10s', `--snapshot=${snapshot.id}`]);
  snapshot.healthy();
  if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('El respaldo no es un archivo PostgreSQL custom válido.');
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
  const archive = Buffer.concat([Buffer.from('PULMONOGY-BACKUP-V1\n'), iv, cipher.getAuthTag(), ciphertext]);
  await secretFile('backup.key', key);
  await secretFile('synthetic.dump.enc', archive);
  evidence.archive = { file: 'synthetic.dump.enc', bytes: archive.length, sha256: sha(archive), plaintextSha256: sha(dump), encryption: 'AES-256-GCM', keyFile: 'backup.key' };
  evidence.snapshot = snapshot.id;
  evidence.source = original;
  evidence.checks.sameSnapshot = true;
  await saveEvidence();
  await snapshot.end();
  holder = undefined;
  stage = 'crear destino nuevo';
  const restored = await createContainer('restore', pgId, ['--tmpfs', '/var/lib/postgresql/data:rw,nosuid,noexec,size=268435456', '--env-file', path.join(directory, 'restore.env')]);
  await waitDatabase(restored, targetDatabase);
  if (Number(await sql(restored, targetDatabase, "SELECT count(*) FROM pg_tables WHERE schemaname='public';")) !== 0)
    throw new Error('El destino no está vacío. No se limpiará ni reemplazará.');
  stage = 'restaurar archivo cifrado';
  // Re-read both artifacts from disk; the restoration does not silently use the in-memory dump.
  const stored = await readFile(path.join(directory, 'synthetic.dump.enc'));
  if (sha(stored) !== evidence.archive.sha256) throw new Error('La huella del respaldo cambió.');
  const header = Buffer.from('PULMONOGY-BACKUP-V1\n');
  if (!stored.subarray(0, header.length).equals(header)) throw new Error('Cabecera cifrada inválida.');
  const decipher = createDecipheriv('aes-256-gcm', await readFile(path.join(directory, 'backup.key')), stored.subarray(header.length, header.length + 12));
  decipher.setAuthTag(stored.subarray(header.length + 12, header.length + 28));
  const plaintext = Buffer.concat([decipher.update(stored.subarray(header.length + 28)), decipher.final()]);
  if (sha(plaintext) !== evidence.archive.plaintextSha256) throw new Error('La huella del archivo descifrado no coincide.');
  await docker(['exec', '-i', restored.id, 'pg_restore', '-U', user, '-d', targetDatabase,
    '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl'], plaintext);
  stage = 'comparar restauración';
  const destination = await manifest(restored, targetDatabase);
  evidence.restored = destination;
  checkFlyway(destination.flyway, migrations);
  Object.assign(evidence, compareManifests(original, destination));
  if (evidence.mismatchedSections.length) throw new Error('La restauración difiere del snapshot; la evidencia no se marcará aprobada.');
  evidence.checks = { sameSnapshot: true, encryptedArchiveAuthenticated: true, allTablesCountsAndSha256: true,
    constraintsIndexesTriggersFunctions: true, foreignKeysNoOrphans: true, sequenceState: true, flywayLocalChecksums: true };
  evidence.status = 'VERIFIED_PENDING_CLEANUP';
  await saveEvidence();
}

// Importing the pure comparison helper must not run Docker or create artifacts.
if (isMain) {
try { await main(); }
catch {
  // Never include raw driver errors, SQL, credentials, stdout or subprocess stderr in evidence.
  evidence.status = 'FAILED';
  evidence.failedStage = stage;
  process.exitCode = 1;
  console.error(`Ensayo no aprobado. Etapa: ${stage}. Revise requisitos y evidence.json; no se tocaron bases existentes.`);
} finally {
  if (apply) {
    await holder?.end().catch(() => {});
    for (const resource of [...resources].reverse()) {
      try { await removeOwned(resource); }
      catch { evidence.status = 'FAILED_CLEANUP'; evidence.cleanupRequired = true; process.exitCode = 1; }
    }
    if (evidence.status === 'VERIFIED_PENDING_CLEANUP' && resources.every(resource => resource.removed)) evidence.status = 'PASS_SYNTHETIC_ONLY';
    evidence.finishedAt = new Date().toISOString();
    try { await saveEvidence(); } catch { process.exitCode = 1; console.error('No se pudo guardar la evidencia final; no considerar el ensayo aprobado.'); }
    console.log(JSON.stringify({ status: evidence.status, evidence: evidenceReady ? `${relativeDirectory}/evidence.json` : null,
      preserved: evidence.archive ? ['synthetic.dump.enc', 'backup.key', 'evidence.json'] : [],
      resources: resources.map(({ id, name, removed }) => ({ id, name, removed })) }, null, 2));
  }
}
}
