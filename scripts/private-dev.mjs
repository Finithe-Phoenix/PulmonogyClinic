import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
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
switch (process.argv[2]) {
  case 'up':
    run(['up', '-d', '--build', 'db', 'identity', 'api', 'portal']);
    console.log('Portal sintético: http://localhost:4180. Usuarios: admin, farmacia, auditor, recepcion. Contraseñas individuales en .local/private.env (no compartir).');
    break;
  case 'stop': run(['stop']); break;
  case 'test': run(['--profile', 'test', 'run', '--rm', 'api-test']); break;
  default: throw new Error('Use up, stop o test. Compile antes con npm run build:portal.');
}
