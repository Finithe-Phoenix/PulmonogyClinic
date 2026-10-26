import { test, expect, type Page, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Real Keycloak PKCE. Only failure responses and the browser clock are controlled.
// Do not record auth URLs, bodies, tokens, traces, screenshots or videos.
test.use({trace:'off', screenshot:'off', video:'off'});
test.describe.configure({timeout:120_000});
const tokenEndpoint='/realms/clinic-dev/protocol/openid-connect/token';

function password(username: 'admin' | 'recepcion') {
  const key=username==='admin' ? 'DEV_ADMIN_PASSWORD' : 'DEV_RECEPTION_PASSWORD';
  const row=readFileSync('.local/private.env','utf8').split(/\r?\n/).find(line=>line.startsWith(key+'='));
  const result=row?.slice(key.length+1).trim();
  if(!result)throw Error('Falta una credencial sintética de la prueba de sesión.');
  return result;
}
async function credentials(page: Page, username: 'admin' | 'recepcion') {
  await expect(page.locator('#password')).toBeVisible();
  // A prompt=login session may show a remembered account and only the password field.
  if(!await page.locator('#username').isVisible()) {
    await page.getByRole('button',{name:'Volver a iniciar el acceso',exact:true}).click();
  }
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password(username));
  await page.locator('#kc-login').click();
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await credentials(page,'admin');
  await expect(page.getByRole('heading',{name:'Todo en su lugar.',exact:true})).toBeVisible();
}
async function go(page: Page, label: string) {
  const link=page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:label,exact:true});
  if(!await link.isVisible())await page.getByRole('button',{name:'Abrir o cerrar navegación'}).click();
  await link.click();await expect(page.locator('main h1')).toHaveText(label);
}
async function draftPatient(page: Page) {
  await go(page,'Pacientes');
  await page.getByRole('button',{name:'Nuevo paciente',exact:true}).click();
  const marker='SESSION-'+randomUUID().slice(0,8).toUpperCase();
  await page.locator('clinic-dialog input[name="reference"]').fill(marker);
  await page.getByLabel('Nombre completo',{exact:true}).fill('Persona sintética '+marker);
  await page.getByLabel('Fecha de nacimiento',{exact:true}).fill('1990-01-02');
  return marker;
}
async function suspendOnRead(page: Page) {
  await page.route('**/api/v1/operations/patients/duplicates?**',route=>route.fulfill({
    status:401,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_SESSION_TEST',detail:'Sesión no vigente.'}),
  }),{times:1});
  await page.getByRole('button',{name:'Revisar coincidencias',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toBeVisible();
  await expect(page.locator('clinic-dialog dialog')).not.toBeVisible();
  await expect(page.locator('clinic-dialog dialog')).not.toHaveAttribute('open','');
  await expect(page.getByRole('navigation',{name:'Navegación principal'})).toBeHidden();
}
async function popupRecovery(page: Page, username: 'admin' | 'recepcion') {
  const authorization=page.context().waitForEvent('request',{predicate:request=>
    request.isNavigationRequest() && new URL(request.url()).pathname==='/realms/clinic-dev/protocol/openid-connect/auth'});
  const opened=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Reautenticar y recuperar formulario',exact:true}).click();
  const popup=await opened;
  // Read the initial authorization request, before Keycloak replaces its query with login actions.
  // Keep only nonsensitive facts; never print the URL, state, challenge, code or token.
  const query=new URL((await authorization).url()).searchParams;
  const protocol={pkce:query.get('code_challenge_method'),prompt:query.get('prompt'),type:query.get('response_type')};
  expect(protocol).toEqual({pkce:'S256',prompt:'login',type:'code'});
  const closed=popup.waitForEvent('close');
  await credentials(popup,username);await closed;
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toHaveCount(0);
}
async function expectNoDraftOrTokensInStorage(page: Page, marker: string) {
  const state=await page.evaluate(value=>{
    const entries=[...Object.values(localStorage),...Object.values(sessionStorage)];
    return {draft:entries.some(entry=>entry.includes(value)),tokens:entries.some(entry=>/"(?:access_token|refresh_token|id_token)"\s*:/.test(entry))};
  },marker);
  expect(state).toEqual({draft:false,tokens:false});
}
function isRefresh(response: Response) {
  return new URL(response.url()).pathname===tokenEndpoint &&
    new URLSearchParams(response.request().postData() || '').get('grant_type')==='refresh_token';
}

test('401 oculta un diálogo, bloquea la API y conserva borrador solo en memoria al recuperar misma identidad',async({page})=>{
  await login(page);const marker=await draftPatient(page);
  await expectNoDraftOrTokensInStorage(page,marker);
  await suspendOnRead(page);
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue(marker);
  await expect(page.locator('clinic-dialog input[name="reference"]')).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toBeFocused();
  const requests:string[]=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/v1/'))requests.push(path);});
  // Synthetic events prove the store gate, not only CSS/inert or disabled buttons.
  await page.locator('clinic-dialog button').filter({hasText:'Revisar coincidencias'}).dispatchEvent('click');
  await page.locator('clinic-dialog form').dispatchEvent('submit');
  await expect(page.locator('clinic-dialog input[name="reference"]')).toBeDisabled();
  expect(requests).toEqual([]);
  await expectNoDraftOrTokensInStorage(page,marker);
  await popupRecovery(page,'admin');
  await expect(page.getByRole('dialog',{name:'Nuevo paciente',exact:true})).toBeVisible();
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue(marker);
  await expect(page.getByLabel('Nombre completo',{exact:true})).toHaveValue('Persona sintética '+marker);
  await expect(page.getByRole('button',{name:'Revisar coincidencias',exact:true})).toBeFocused();
  await expectNoDraftOrTokensInStorage(page,marker);
  // Recovery refreshes reads but must never submit the retained form.
  await expect(page.getByRole('button',{name:'Registrar paciente',exact:true})).toBeDisabled();
});

test('cerrar popup mantiene bloqueo y el borrador; un segundo acceso explícito recupera el formulario',async({page})=>{
  await login(page);const marker=await draftPatient(page);await suspendOnRead(page);
  const opened=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Reautenticar y recuperar formulario',exact:true}).click();
  const popup=await opened;await expect(popup.locator('#password')).toBeVisible();await popup.close();
  await expect(page.getByRole('alert')).toContainText('Tu formulario sigue en memoria');
  await expect(page.getByRole('button',{name:'Reautenticar y recuperar formulario',exact:true})).toBeEnabled();
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue(marker);
  await popupRecovery(page,'admin');
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue(marker);
});

test('otra cuenta destruye formulario y no recibe ni reenvía el comando pendiente anterior',async({page})=>{
  await login(page);await go(page,'Proveedores');
  await page.getByRole('button',{name:'Nuevo proveedor',exact:true}).click();
  const marker='SESSION-'+randomUUID().slice(0,8).toUpperCase();
  await page.getByLabel('Referencia del proveedor',{exact:true}).fill(marker);
  await page.getByLabel('Nombre del proveedor',{exact:true}).fill('Proveedor sintético '+marker);
  let writes=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/purchasing/suppliers' && request.method()==='POST')writes++;});
  await page.route('**/api/v1/purchasing/suppliers',route=>route.fulfill({status:401,contentType:'application/json',body:'{"code":"SYNTHETIC_SESSION_TEST"}'}),{times:1});
  await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toBeVisible();
  expect(writes).toBe(1);
  await popupRecovery(page,'recepcion');
  await expect(page.getByRole('heading',{name:'Todo en su lugar.',exact:true})).toBeVisible();
  await expect(page.locator('clinic-dialog')).toHaveCount(0);
  await expect(page.getByText('La cuenta o sus permisos cambiaron.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reintentar operación',exact:true})).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Proveedores',exact:true})).toHaveCount(0);
  expect(writes).toBe(1);
  // The original submitted command may remain under its own account key; no draft is shown to this user.
  await go(page,'Pacientes');await page.getByRole('button',{name:'Nuevo paciente',exact:true}).click();
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue('');
});

test('renovación real antes del vencimiento conserva un comando enviado y su confirmación',async({page})=>{
  await page.clock.install({time:Date.now()});
  await login(page);await go(page,'Proveedores');
  // Approach renewal before submitting; a retained write must not cross its own network timeout.
  await page.clock.fastForward(230_000);
  await page.getByRole('button',{name:'Nuevo proveedor',exact:true}).click();
  const marker='SESSION-'+randomUUID().slice(0,8).toUpperCase();
  await page.getByLabel('Referencia del proveedor',{exact:true}).fill(marker);
  await page.getByLabel('Nombre del proveedor',{exact:true}).fill('Proveedor sintético '+marker);
  let release!:()=>void;let arrived!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const submitted=new Promise<void>(resolve=>arrived=resolve);
  const keys:string[]=[];
  await page.route('**/api/v1/purchasing/suppliers',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    keys.push(route.request().headers()['idempotency-key']);
    const response=await route.fetch();arrived();await gate;await route.fulfill({response});
  });
  try {
    await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();await submitted;
    const renewal=page.waitForResponse(isRefresh);
    // Browser timer only: no server TTL, JWT claims or identity fixture is modified.
    await page.clock.fastForward(11_000);
    expect((await renewal).status()).toBe(200);
  }finally{release();}
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Operación confirmada por el servidor.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reintentar operación',exact:true})).toHaveCount(0);
  expect(keys).toHaveLength(1);
});

test('un fallo de renovación bloquea sin borrar ni persistir el formulario',async({page})=>{
  await page.clock.install({time:Date.now()});
  await login(page);const marker=await draftPatient(page);
  await page.route('**'+tokenEndpoint,async route=>{
    if(new URLSearchParams(route.request().postData() || '').get('grant_type')!=='refresh_token'){await route.continue();return;}
    await route.fulfill({status:400,contentType:'application/json',body:'{"error":"invalid_grant"}'});
  });
  await page.clock.fastForward(241_000);
  await expect(page.getByRole('heading',{name:'Sesión bloqueada',exact:true})).toBeVisible();
  await expect(page.locator('clinic-dialog dialog')).not.toBeVisible();
  await expect(page.locator('clinic-dialog input[name="reference"]')).toHaveValue(marker);
  await expectNoDraftOrTokensInStorage(page,marker);
});
