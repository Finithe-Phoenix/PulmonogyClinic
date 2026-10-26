import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync('.local', { recursive: true });
const envFile = '.local/private.env';
if (!existsSync(envFile)) {
  const keys = ['DB_PASSWORD', 'TEST_DB_PASSWORD', 'DEV_ADMIN_PASSWORD', 'DEV_PHARMACY_PASSWORD', 'DEV_AUDITOR_PASSWORD', 'DEV_RECEPTION_PASSWORD'];
  writeFileSync(envFile, keys.map(k => `${k}=${randomBytes(24).toString('base64url')}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
}
const base = ['compose', '--env-file', envFile, '-f', 'infra/dev/compose.yaml'];
function run(args) {
  const result = spawnSync('docker', [...base, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
function guardIdentityStorage() {
  const container = 'pulmonogy-private-dev-identity-1';
  const volume = 'pulmonogy-private-dev-identity-data';
  if (existsSync('.local/identity-maintenance.lock')) throw new Error('Hay mantenimiento de identidad activo o interrumpido. Revisa su bloqueo antes de arrancar servicios.');
  const backupRoot = '.local/identity-backups';
  if (existsSync(backupRoot)) {
    for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = `${backupRoot}/${entry.name}/manifest.json`;
      if (!existsSync(path)) throw new Error('Hay un respaldo de identidad sin manifest. Revisa el mantenimiento antes de arrancar.');
      let manifest;
      try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('No se pudo verificar un manifest de identidad. Arranque bloqueado.'); }
      if (manifest.targetVolume === volume && !(manifest.completed === true && manifest.preservationVerified === true && manifest.temporaryClientDeleted === true))
        throw new Error('El volumen de identidad tiene un mantenimiento incompleto. No se abrirá hasta verificar preservación y retiro de la cuenta temporal; revisa docs/IDENTITY_MAINTENANCE.md.');
    }
  }
  const options = { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  const result = spawnSync('docker', ['inspect', '--format', '{{json .Mounts}}', container], options);
  if (result.status === 0) {
    let mounts;
    try { mounts = JSON.parse(result.stdout); } catch { throw new Error('No se pudo verificar el almacenamiento de identidad. No se recreará el servicio.'); }
    const data = mounts.find(mount => mount.Destination === '/opt/keycloak/data');
    if (data?.Type !== 'volume') throw new Error('La identidad existente conserva H2 en su contenedor o un montaje no migrado. Para preservar usuarios, ejecuta primero node scripts/configure-identity.mjs --apply. No se recreó ningún servicio.');
    if (data.Name !== volume) throw new Error('La identidad usa un volumen distinto al Compose base, posiblemente una recuperación. Conserva su override y revisa docs/IDENTITY_MAINTENANCE.md antes de arrancar.');
    return;
  }
  const listed = spawnSync('docker', ['container', 'ls', '-a', '--filter', `name=${container}`, '--format', '{{.Names}}'], options);
  if (listed.status !== 0 || listed.stdout.split(/\r?\n/).includes(container)) throw new Error('Docker no permitió verificar la identidad existente. No se recreará el servicio.');
  const volumes = spawnSync('docker', ['volume', 'ls', '--filter', `name=${volume}`, '--format', '{{.Name}}'], options);
  if (volumes.status !== 0) throw new Error('No se pudo comprobar el volumen de identidad.');
  if (volumes.stdout.split(/\r?\n/).includes(volume)) throw new Error('Existe un volumen de identidad sin contenedor. Puede pertenecer a una migración incompleta: revisa su manifest y docs/IDENTITY_MAINTENANCE.md antes de arrancarlo. No se sobrescribió ni abrió.');
}
switch (process.argv[2]) {
  case 'up':
    guardIdentityStorage();
    run(['up', '-d', '--build', 'db', 'identity', 'api', 'portal']);
    console.log('Portal sintético: http://localhost:4180. Usuarios: admin, farmacia, auditor, recepcion. Contraseñas individuales en .local/private.env (no compartir).');
    break;
  case 'stop': run(['stop']); break;
  case 'test': run(['--profile', 'test', 'run', '--rm', 'api-test']); break;
  default: throw new Error('Use up, stop o test. Compile antes con npm run build:portal.');
}
