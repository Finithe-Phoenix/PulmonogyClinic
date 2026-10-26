import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This script is intentionally dry-run by default. It only handles the verified legacy
// single-container H2 layout; an existing target volume is never opened for migration.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const project = 'pulmonogy-private-dev';
const identityName = `${project}-identity-1`;
const volume = `${project}-identity-data`;
const imageTag = 'quay.io/keycloak/keycloak:26.7.4';
const helperTag = 'node:24.16.0-alpine';
const origin = 'http://localhost:8180';
const realm = 'clinic-dev';
const backupRoot = join(root, '.local', 'identity-backups');
const envFile = join(root, '.local', 'private.env');
const composeFile = join(root, 'infra', 'dev', 'compose.yaml');
const composeBase = ['compose', '--env-file', envFile, '-f', composeFile];
const changes = { loginTheme: 'pulmonogy', internationalizationEnabled: true, supportedLocales: ['es'], defaultLocale: 'es' };
const requested = process.argv.slice(2);
if (requested.some(argument => !['--dry-run', '--apply'].includes(argument)) || requested.length > 1) {
  console.error('Uso: node scripts/configure-identity.mjs [--dry-run | --apply]'); process.exit(2);
}
const apply = requested.includes('--apply');
process.chdir(root);

class MaintenanceError extends Error {}
function fail(message) { throw new MaintenanceError(message); }
function command(executable, args, { input, allowFailure = false, timeout = 240000 } = {}) {
  const result = spawnSync(executable, args, { cwd: root, input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  if (!allowFailure && (result.error || result.status !== 0)) fail(`Falló ${executable} (${result.error?.code || result.status}). Se omite su salida para no revelar información sensible.`);
  return result;
}
function docker(args, options) { return command('docker', args, options).stdout.trim(); }
function inspect(target, template) { return docker(['inspect', '--format', template, target]); }
function mountedData(target) { return JSON.parse(inspect(target, '{{json .Mounts}}')).find(mount => mount.Destination === '/opt/keycloak/data'); }
function state(target) { return JSON.parse(inspect(target, '{{json .State}}')); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(value) { return hash(JSON.stringify(canonical(value))); }
function inside(parent, child) {
  const rel = relative(parent, resolve(child));
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || resolve(child) === resolve(parent)) fail('Ruta de respaldo no válida.');
  return resolve(child);
}
function writePrivate(path, value, flag = 'wx') { writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag }); }
function secureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const account = command('whoami', []).stdout.trim();
    if (!account || /[\r\n]/.test(account)) fail('No se pudo determinar el propietario del respaldo.');
    command('icacls', [path, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
  }
}
function inventoryFiles(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), stat = lstatSync(path), relativeName = prefix + name;
    if (stat.isSymbolicLink()) fail('No se admiten enlaces simbólicos en el respaldo H2.');
    if (stat.isDirectory()) return inventoryFiles(path, relativeName + '/');
    if (!stat.isFile()) fail('El respaldo H2 contiene un tipo de archivo inesperado.');
    return [{ path: relativeName, bytes: stat.size, sha256: hash(readFileSync(path)) }];
  });
}
async function request(path, options = {}) {
  return fetch(origin + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
}
async function publicIdentity() {
  const discovery = await request(`/realms/${realm}/.well-known/openid-configuration`);
  if (!discovery.ok || (await discovery.json()).issuer !== `${origin}/realms/${realm}`) fail('La identidad publicada no corresponde al realm esperado.');
  const response = await request(`/realms/${realm}/protocol/openid-connect/certs`);
  if (!response.ok) fail('No se pudo leer la identidad pública del realm.');
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys) || !jwks.keys.length) fail('El realm no publica claves verificables.');
  return fingerprint(jwks);
}
async function waitForIdentity() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try { return await publicIdentity(); } catch { /* A starting container can temporarily refuse connections. */ }
    if (!state(identityName).Running) fail('El servicio de identidad dejó de ejecutarse durante su inicio.');
    await new Promise(resolveWait => setTimeout(resolveWait, 1500));
  }
  fail('La identidad no estuvo disponible en el plazo esperado. No se repite la migración.');
}
function stopConsistently(target) {
  docker(['stop', '--time', '60', target]);
  const stopped = state(target);
  if (stopped.Running || stopped.OOMKilled || ![0, 143].includes(stopped.ExitCode)) fail('El contenedor no confirmó una parada limpia; no se copiará su base H2.');
}
function noVolumeWriters() {
  if (docker(['ps', '--filter', `volume=${volume}`, '--format', '{{.ID}}'])) fail('Hay otro proceso utilizando el volumen; la operación offline está bloqueada.');
}

async function preflight() {
  if (!existsSync(envFile)) fail('Falta .local/private.env; no se generan ni reemplazan contraseñas durante el mantenimiento.');
  for (const directory of [join(root,'.local'), backupRoot]) {
    if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || relative(root,realpathSync(directory)).startsWith('..'))) fail('La ruta privada debe permanecer dentro del workspace y sin enlaces simbólicos.');
  }
  if (!existsSync(join(root, 'infra/dev/themes/pulmonogy/login/theme.properties'))) fail('Falta el tema pulmonogy.');
  const ids = docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=identity', '--format', '{{.ID}}']).split('\n').filter(Boolean);
  const sourceId = inspect(identityName, '{{.Id}}');
  if (ids.length !== 1 || !sourceId.startsWith(ids[0])) fail('Se esperaba exactamente una instancia de identidad local.');
  if (inspect(sourceId, '{{.Config.Image}}') !== imageTag || inspect(sourceId, '{{.Config.User}}') !== '1000') fail('Versión/usuario de la identidad distintos del layout revisado.');
  const running = state(sourceId);
  if (!running.Running) fail('La identidad debe estar disponible para establecer la línea base pública antes de migrar.');
  const mounts = JSON.parse(inspect(sourceId, '{{json .Mounts}}'));
  if (mounts.some(mount => mount.Destination === '/opt/keycloak/data' || mount.Destination === '/opt/keycloak/data/h2')) fail('La identidad ya tiene datos montados. No se migra ni sobrescribe un volumen existente.');
  const envNames = inspect(sourceId, '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}').split(/\r?\n/);
  if (envNames.some(name => /^KC_DB|^KC_BOOTSTRAP|^KEYCLOAK_ADMIN/.test(name))) fail('Hay configuración de base/admin no contemplada; revisar antes de continuar.');
  if (command('docker', ['volume', 'inspect', volume], { allowFailure: true }).status === 0) fail('El volumen de destino ya existe. Se conserva intacto; revisar el mantenimiento previo.');
  const image = inspect(sourceId, '{{.Image}}');
  if (docker(['image', 'inspect', '--format', '{{.Id}}', imageTag]) !== image) fail('La etiqueta de Keycloak difiere del contenedor actual. No se actualizará versión durante esta operación.');
  const helperImage = docker(['image', 'inspect', '--format', '{{.Id}}', helperTag]);
  const config = JSON.parse(docker([...composeBase, 'config', '--format', 'json']));
  const identity = config.services?.identity;
  if (config.name !== project || identity?.image !== imageTag || config.volumes?.['identity-data']?.name !== volume) fail('Compose no coincide con el destino esperado.');
  if (!identity.volumes?.some(mount => mount.type === 'volume' && mount.source === 'identity-data' && mount.target === '/opt/keycloak/data')) fail('Falta el montaje persistente de identidad en Compose.');
  if (!identity.volumes?.some(mount => mount.target === '/opt/keycloak/themes/pulmonogy' && mount.read_only)) fail('Falta el montaje de solo lectura del tema.');
  const jwks = await publicIdentity();
  return { sourceId, image, helperImage, jwks };
}

async function migrate(baseline) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const backup = inside(backupRoot, join(backupRoot, runId));
  const lockPath = join(root, '.local', 'identity-maintenance.lock');
  const lockValue = randomUUID();
  const lock = openSync(lockPath, 'wx', 0o600); writeFileSync(lock, lockValue); closeSync(lock);
  let phase = 'preflight', recreated = false, stopped = false, token = '', temporaryClientId = '', temporarySecret = '';
  let temporaryCreated = false, temporaryDeleted = false;
  const manifest = { version: 1, runId, createdAt: new Date().toISOString(), sourceId: baseline.sourceId, image: baseline.image, targetVolume: volume, phase, completed: false };
  function checkpoint(next) { phase = next; manifest.phase = next; writePrivate(join(backup, 'manifest.json'), manifest, 'w'); console.log(next); }
  function helperArgs(name) { return ['run', '--pull', 'never', '--name', name, '--network', 'none', '--log-driver', 'none', '--mount', `type=volume,src=${volume},dst=/opt/keycloak/data,volume-nocopy`]; }
  function offlineExport(label) {
    noVolumeWriters();
    const name = `${project}-export-${runId}-${label}`;
    // The child file includes credentials/private keys and is copied only into the restricted backup directory.
    // No import command is ever used. All realms allow verification that bootstrap touched only its own account.
    try {
      docker([...helperArgs(name), baseline.image, 'export', '--db=dev-file', '--file=/tmp/identity-realms.json']);
      docker(['cp', `${name}:/tmp/identity-realms.json`, join(backup, `${label}.json`)]);
      const result = JSON.parse(readFileSync(join(backup, `${label}.json`), 'utf8'));
      const realms = Array.isArray(result) ? result : [result];
      if (!realms.some(item => item.realm === realm) || !realms.some(item => item.realm === 'master')) fail('El export no contiene los realms existentes esperados.');
      return realms;
    } finally {
      const result = command('docker', ['inspect', '--format', '{{.State.Running}}', name], { allowFailure: true });
      if (result.status === 0 && result.stdout.trim() === 'false') docker(['rm', name]);
    }
  }
  async function admin(path, method = 'GET', body) {
    const response = await request('/admin/realms/' + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) fail(`Admin REST ${method} devolvió ${response.status}; el cuerpo se mantiene privado.`);
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  }
  async function getToken() {
    return request('/realms/master/protocol/openid-connect/token', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ grant_type:'client_credentials', client_id:temporaryClientId, client_secret:temporarySecret }) });
  }
  async function deleteTemporaryClient() {
    if (!temporaryCreated || temporaryDeleted) return;
    if (!token) { const response = await getToken(); if (!response.ok) fail('No se pudo autenticar la limpieza de la cuenta temporal.'); token = (await response.json()).access_token; }
    const clients = await admin('master/clients?clientId=' + encodeURIComponent(temporaryClientId));
    const matching = clients.filter(client => client.clientId === temporaryClientId);
    if (matching.length !== 1) fail('No se identificó inequívocamente el cliente temporal para eliminarlo.');
    await admin('master/clients/' + encodeURIComponent(matching[0].id), 'DELETE');
    const revoked = await getToken();
    if (![400,401].includes(revoked.status) || (await revoked.json()).error !== 'invalid_client') fail('La eliminación no quedó confirmada por rechazo del cliente.');
    temporaryDeleted = true; token = ''; temporarySecret = '';
  }
  try {
    secureDirectory(backup);
    manifest.publicKeysBefore = baseline.jwks;
    checkpoint('Respaldo: detener identidad de forma limpia');
    stopped = true; stopConsistently(baseline.sourceId);
    docker(['cp', `${baseline.sourceId}:/opt/keycloak/data/h2`, join(backup, 'h2')]);
    const files = inventoryFiles(join(backup, 'h2'));
    if (!files.some(file => file.path === 'keycloakdb.mv.db' && file.bytes > 0)) fail('El respaldo no contiene la base H2 esperada.');
    manifest.h2Files = files; checkpoint('Respaldo H2 consistente conservado con huellas SHA-256');
    if (command('docker', ['volume', 'inspect', volume], { allowFailure: true }).status === 0) fail('El destino apareció durante el respaldo; no se sobrescribirá.');
    docker(['volume', 'create', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.volume=identity-data', '--label', `clinic.identity.migration=${runId}`, volume]);
    const volumeLabels = JSON.parse(docker(['volume','inspect','--format','{{json .Labels}}',volume]));
    if (volumeLabels['clinic.identity.migration'] !== runId) fail('El volumen no pertenece a esta ejecución.');
    const copyScript = `
      import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
      if (fs.readdirSync('/opt/keycloak/data').length) throw new Error('Destination must be empty');
      const expected = ${JSON.stringify(files)};
      fs.mkdirSync('/opt/keycloak/data/h2', {mode:0o700});
      for (const item of expected) {
        if (item.path.includes('..') || path.isAbsolute(item.path)) throw new Error('Invalid relative path');
        const source = path.join('/source', item.path), destination = path.join('/opt/keycloak/data/h2', item.path);
        if (!fs.lstatSync(source).isFile()) throw new Error('Expected regular file');
        const data=fs.readFileSync(source);
        if(data.length!==item.bytes || crypto.createHash('sha256').update(data).digest('hex')!==item.sha256) throw new Error('Backup hash mismatch');
        fs.mkdirSync(path.dirname(destination), {recursive:true,mode:0o700}); fs.writeFileSync(destination,data,{flag:'wx',mode:0o600});
        if(crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==item.sha256) throw new Error('Copy hash mismatch');
        fs.chownSync(destination,1000,0);
      }
      function own(directory) {fs.chownSync(directory,1000,0);for(const entry of fs.readdirSync(directory,{withFileTypes:true}))if(entry.isDirectory())own(path.join(directory,entry.name));}
      own('/opt/keycloak/data');
    `;
    docker([...helperArgs(`${project}-copy-${runId}`), '--rm', '-i', '--user', '0:0', '--mount', `type=bind,src=${join(backup,'h2')},dst=/source,readonly`, baseline.helperImage, 'node', '--input-type=module', '-'], { input: copyScript });
    checkpoint('Volumen nuevo: copia H2 validada byte por byte');
    const before = offlineExport('before');
    const clinicBefore = before.find(item => item.realm === realm);
    const users = clinicBefore.users || [];
    for (const username of ['admin','farmacia','auditor','recepcion']) if (!users.some(user => user.username === username && user.id && user.credentials?.length)) fail('La línea base no contiene una identidad aplicativa esperada con credenciales.');
    if (!clinicBefore.id || !(clinicBefore.clients || []).some(client => client.clientId === 'clinic-portal')) fail('Falta identidad de realm o cliente de portal en la copia.');
    manifest.realmId = clinicBefore.id; manifest.userCount = users.length; manifest.beforeFingerprint = fingerprint(before);
    checkpoint('Export offline: identidad, usuarios, credenciales y clientes registrados como línea base');
    noVolumeWriters(); temporaryClientId = `clinic-maintenance-${randomBytes(12).toString('hex')}`; temporarySecret = randomBytes(48).toString('base64url');
    manifest.temporaryClientId = temporaryClientId;
    checkpoint('Bootstrap offline de cliente temporal');
    const bootstrapShell = 'IFS= read -r CLINIC_MAINTENANCE_SECRET; export CLINIC_MAINTENANCE_SECRET; exec /opt/keycloak/bin/kc.sh bootstrap-admin service --client-id "$1" --client-secret:env CLINIC_MAINTENANCE_SECRET --no-prompt --db=dev-file';
    // Treat an uncertain exit as potentially created too: the staged volume must remain offline.
    temporaryCreated = true;
    docker([...helperArgs(`${project}-bootstrap-${runId}`), '--rm', '-i', '--entrypoint', '/bin/bash', baseline.image, '-c', bootstrapShell, 'maintenance', temporaryClientId], { input: temporarySecret + '\n' });
    const override = join(backup, 'image.override.json');
    writePrivate(override, {services:{identity:{image:baseline.image}}});
    checkpoint('Arranque de identidad con volumen y tema; import existente se omite');
    // From here on the legacy container can be replaced; its complete H2 backup is retained.
    recreated = true;
    docker([...composeBase, '-f', override, 'up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'identity']);
    const mounted = mountedData(identityName);
    if (mounted?.Name !== volume || !mounted.RW) fail('La identidad no montó el volumen previsto.');
    if (await waitForIdentity() !== baseline.jwks) fail('Las claves públicas cambiaron; se bloquea el mantenimiento.');
    const authenticated = await getToken();
    if (!authenticated.ok) fail('El cliente temporal no pudo autenticarse.');
    token = (await authenticated.json()).access_token;
    if (typeof token !== 'string' || !token) fail('La respuesta no contiene un token válido.');
    const liveRealm = await admin(realm);
    if (liveRealm.id !== clinicBefore.id) fail('Cambió el identificador del realm; se bloquea el mantenimiento.');
    await admin(realm, 'PUT', changes);
    const role = await request(`/admin/realms/${realm}/roles/MEDICO`, { headers:{Authorization:'Bearer '+token} });
    if (role.status === 404) await admin(`${realm}/roles`, 'POST', {name:'MEDICO'});
    else if (!role.ok) fail('No se pudo verificar el rol MEDICO.');
    const afterSettings = await admin(realm);
    if (Object.keys(changes).some(key => fingerprint(afterSettings[key]) !== fingerprint(changes[key]))) fail('El tema o la localización no quedaron aplicados.');
    const physicianRole = await admin(`${realm}/roles/MEDICO`);
    if (physicianRole.name !== 'MEDICO') fail('No se confirmó el rol MEDICO.');
    checkpoint('Tema español verificado por Admin REST; retiro de cliente temporal');
    await deleteTemporaryClient(); manifest.temporaryClientDeleted = true;
    checkpoint('Verificación offline final de preservación');
    stopConsistently(identityName);
    const after = offlineExport('after');
    const withoutAllowedChanges = snapshots => snapshots.map(snapshot => {
      const value = structuredClone(snapshot);
      if (value.realm === realm) {
        for (const key of Object.keys(changes)) delete value[key];
        if (!(clinicBefore.roles?.realm || []).some(role => role.name === 'MEDICO') && value.roles?.realm)
          value.roles.realm = value.roles.realm.filter(role => role.name !== 'MEDICO');
      }
      return value;
    });
    if (fingerprint(withoutAllowedChanges(before)) !== fingerprint(withoutAllowedChanges(after))) fail('El export final difiere fuera del tema, localización o rol nuevo. Mantener identidad detenida y revisar antes de restaurar.');
    const masterAfter = after.find(item => item.realm === 'master');
    if ((masterAfter.clients || []).some(client => client.clientId === temporaryClientId) || (masterAfter.users || []).some(user => user.serviceAccountClientId === temporaryClientId)) fail('El cliente temporal o su usuario persisten.');
    if (fingerprint(files) !== fingerprint(inventoryFiles(join(backup,'h2')))) fail('El respaldo original cambió durante el mantenimiento.');
    manifest.afterFingerprint = fingerprint(after); manifest.preservationVerified = true;
    checkpoint('Identidad preservada; reinicio final');
    docker(['start', identityName]);
    if (await waitForIdentity() !== baseline.jwks) fail('El inicio final no conserva la identidad pública.');
    manifest.completed = true; manifest.finishedAt = new Date().toISOString(); checkpoint('Mantenimiento completado; respaldo retenido');
    console.log(`Realm ${realm}: ${users.length} usuarios preservados; cliente temporal eliminado. Respaldo privado: ${backup}`);
    console.log('Pendiente de validación visual: iniciar flujo OIDC/PKCE desde http://localhost:4180.');
  } catch (error) {
    let cleanupConfirmed = !temporaryCreated || temporaryDeleted;
    if (temporaryCreated && !temporaryDeleted && recreated) {
      try { if (state(identityName).Running) { await deleteTemporaryClient(); cleanupConfirmed = true; } } catch { /* Fail closed below. */ }
    }
    manifest.failedAt = new Date().toISOString(); manifest.failedPhase = phase; manifest.temporaryClientDeleted = temporaryDeleted;
    if (recreated) {
      try { if (state(identityName).Running) docker(['stop','--time','60',identityName]); } catch { manifest.stopUnconfirmed = true; }
    } else if (stopped) {
      // The source layer is untouched. It can be restarted without opening the staged volume.
      try { docker(['start',baseline.sourceId]); manifest.originalRestarted = true; } catch { manifest.originalRestarted = false; }
    }
    if (existsSync(backup)) writePrivate(join(backup,'manifest.json'),manifest,'w');
    console.error(`Mantenimiento incompleto en fase: ${phase}. Respaldos y volumen se conservaron. ${cleanupConfirmed ? '' : 'La eliminación del cliente temporal no quedó verificada; su volumen debe permanecer offline.'}`);
    console.error('Revisar docs/IDENTITY_MAINTENANCE.md y el manifest privado antes de cualquier nuevo arranque.');
    throw error;
  } finally {
    temporarySecret = ''; token = '';
    if (existsSync(lockPath) && readFileSync(lockPath,'utf8') === lockValue) unlinkSync(lockPath);
  }
}

try {
  const baseline = await preflight();
  console.log('Preflight verificado: Keycloak 26.7.4, H2 en capa del contenedor, destino nuevo, claves públicas presentes.');
  if (!apply) {
    console.log('DRY RUN: ningún servicio detenido, volumen creado, usuario modificado ni secreto temporal generado.');
    console.log('Plan: parada limpia → backup H2 + hashes → volumen nuevo → export baseline → bootstrap offline → tema/idioma + rol MEDICO → retiro temporal → export comparación → reinicio.');
    console.log('Aplicar deliberadamente: node scripts/configure-identity.mjs --apply');
  } else await migrate(baseline);
} catch (error) {
  // Raw Docker output, access tokens, bootstrap secret and realm exports never enter stdout/stderr.
  console.error(error instanceof MaintenanceError ? error.message : 'Falló una comprobación local. Los detalles se omiten para no revelar datos sensibles.'); process.exitCode = 1;
}
