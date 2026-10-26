import {existsSync,readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const listing=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',windowsHide:true});
if(listing.status!==0)throw new Error('No se pudieron enumerar los archivos versionables.');
const paths=[...new Set(listing.stdout.split('\0').filter(Boolean))];
const secretPath='.local/private.env';
const known=existsSync(secretPath)?readFileSync(secretPath,'utf8').split(/\r?\n/).filter(line=>!line.trimStart().startsWith('#')&&line.includes('='))
  .map(line=>line.slice(line.indexOf('=')+1).trim()).filter(value=>value.length>=12):[];
const forbiddenPaths=paths.filter(path=>/^(?:\.local\/|dist\/portal\/)|(?:^|\/)(?:private\.env|before\.json|after\.json)$/.test(path));
const leaked=[];
for(const path of paths){
  if(!existsSync(path)||!statSync(path).isFile())continue;
  const data=readFileSync(path);
  if(known.some(value=>data.includes(Buffer.from(value))))leaked.push(path);
}
if(forbiddenPaths.length||leaked.length){
  console.error('Bloqueado: hay rutas privadas o credenciales locales en archivos versionables.');
  for(const path of new Set([...forbiddenPaths,...leaked]))console.error(path);
  process.exitCode=1;
}else console.log(`Sin rutas privadas ni coincidencias con los secretos locales conocidos en ${paths.length} archivos versionables. ${known.length?'Verificación local realizada sin revelar valores.':'No hay archivo local de secretos; solo se verificaron rutas.'} Esto no sustituye un escáner general de secretos.`);
