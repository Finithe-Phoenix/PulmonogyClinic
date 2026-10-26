import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Real local identity/API; synthetic records only. Never persist credentials or request headers.
test.use({trace:'off', screenshot:'off', video:'off'});
test.describe.configure({timeout:120_000});

async function login(page: Page, username: 'admin' | 'auditor' | 'recepcion' = 'admin') {
  const keys={admin:'DEV_ADMIN_PASSWORD',auditor:'DEV_AUDITOR_PASSWORD',recepcion:'DEV_RECEPTION_PASSWORD'};
  const line=readFileSync('.local/private.env','utf8').split(/\r?\n/).find(row=>row.startsWith(keys[username]+'='));
  const password=line?.slice(keys[username].length+1).trim();
  if(!password)throw Error('Falta la credencial sintética requerida para la prueba de exportación.');
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Todo en su lugar.',exact:true})).toBeVisible();
}

function sessionApi(page: Page) {
  let authorization='';
  page.on('request',request=>{
    if(new URL(request.url()).pathname.startsWith('/api/v1/'))authorization=request.headers()['authorization'] || authorization;
  });
  return {
    async post(path: string, body: unknown): Promise<{id:string}> {
      await expect.poll(()=>Boolean(authorization)).toBe(true);
      const response=await page.request.post('/api/v1/'+path,{
        headers:{Authorization:authorization,'Idempotency-Key':randomUUID()},data:body,
      });
      expect(response.status(),'Preparación de registro sintético: '+path).toBe(201);
      return response.json();
    },
    async status(path: string) {
      await expect.poll(()=>Boolean(authorization)).toBe(true);
      const response=await page.request.get('/api/v1/'+path,{headers:{Authorization:authorization}});
      return response.status();
    },
  };
}

async function go(page: Page, label: string) {
  const link=page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:label,exact:true});
  if(!await link.isVisible())await page.getByRole('button',{name:'Abrir o cerrar navegación'}).click();
  await link.click();
  await expect(page.locator('main h1')).toHaveText(label);
}

async function startSearch(page: Page, field: string, value: string) {
  await page.getByRole('textbox',{name:field,exact:true}).fill(value);
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
}

async function visiblePage(page: Page, path: string, query: string, offset: number, action:()=>Promise<unknown>) {
  // A row count alone can match the preceding query. Bind this action to its exact server page,
  // then verify the rendered references before observing export's (lack of) network requests.
  const completed=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return response.request().method()==='GET' && url.pathname==='/api/v1/'+path &&
      url.searchParams.get('q')===query && url.searchParams.get('offset')===String(offset);
  });
  await action();
  const response=await completed;
  expect(response.status(),'La consulta explícita debe devolver la página solicitada').toBe(200);
  expect(await response.finished()).toBeNull();
  const body=await response.json() as {items:Array<{reference?:string;sku?:string;batch?:string}>};
  const visible=body.items.slice(0,25);
  const rows=page.locator('main tbody tr');
  await expect(rows).toHaveCount(visible.length || 1);
  for(let index=0;index<visible.length;index++) {
    const record=visible[index];
    const reference=record.reference || record.sku || record.batch;
    if(!reference)throw Error('La página de exportación no contiene una referencia verificable.');
    await expect(rows.nth(index)).toContainText(reference);
  }
  if(!visible.length)await expect(rows.first()).not.toContainText('Consultando');
}

async function search(page: Page, field: string, value: string, path: string) {
  await visiblePage(page,path,value,0,()=>startSearch(page,field,value));
}

async function download(page: Page, count: number) {
  const button=page.getByRole('button',{name:`Exportar página (${count})`,exact:true});
  await expect(button).toBeEnabled();
  const requested:string[]=[];
  const observe=(request: import('@playwright/test').Request)=>{
    const url=new URL(request.url());
    if(url.pathname.startsWith('/api/v1/'))requested.push(url.pathname+url.search);
  };
  page.on('request',observe);
  try {
    const pending=page.waitForEvent('download');
    await button.click();
    const file=await pending;
    expect(await file.failure()).toBeNull();
    const stream=await file.createReadStream();
    if(!stream)throw Error('No se pudo leer la descarga CSV de prueba.');
    const chunks:Buffer[]=[];
    for await(const chunk of stream)chunks.push(Buffer.from(chunk));
    const bytes=Buffer.concat(chunks);
    expect([...bytes.subarray(0,3)]).toEqual([0xef,0xbb,0xbf]);
    expect(requested,'Exportar no debe consultar otra página ni otra API').toEqual([]);
    expect(file.suggestedFilename()).toContain(`-${count}-registros-`);
    return {text:bytes.toString('utf8'),filename:file.suggestedFilename()};
  }finally{page.off('request',observe);}
}

test('proveedores exporta 25 filas visibles, no la fila de avance; cambia de página y bloquea carga/error/vacío', async({page})=>{
  const api=sessionApi(page);
  await login(page);
  const prefix='CSV-'+randomUUID().slice(0,8).toUpperCase();
  for(let i=1;i<=26;i++)await api.post('purchasing/suppliers',{
    reference:prefix+'-'+String(i).padStart(2,'0'),name:'Proveedor sintético CSV '+String(i).padStart(2,'0'),
  });
  await go(page,'Proveedores');
  await search(page,'Buscar proveedores',prefix,'purchasing/suppliers');
  await expect(page.locator('#proveedores tbody tr')).toHaveCount(25);
  await expect(page.locator('#suppliers-export-notice')).toBeVisible();
  await expect(page.locator('#suppliers-export-notice')).toContainText('CSV parcial');
  const first=await download(page,25);
  expect(first.filename).toContain('-pagina-1-');
  expect(first.text.split('\r\n')).toHaveLength(27);
  expect(first.text).toContain(prefix+'-25');
  expect(first.text).not.toContain(prefix+'-26');
  await visiblePage(page,'purchasing/suppliers',prefix,25,()=>page.getByRole('button',{name:'Siguiente',exact:true}).click());
  const second=await download(page,1);
  expect(second.filename).toContain('-pagina-2-');
  expect(second.text).toContain(prefix+'-26');
  expect(second.text).not.toContain(prefix+'-25');

  let release!:()=>void;
  let arrived!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const intercepted=new Promise<void>(resolve=>arrived=resolve);
  await page.route('**/api/v1/purchasing/suppliers?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('q')!==prefix+'-'){await route.continue();return;}
    arrived();await gate;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_EXPORT_TEST',detail:'Fallo sintético de consulta.'})});
  });
  try {
    await startSearch(page,'Buscar proveedores',prefix+'-');
    await intercepted;
    await expect(page.getByRole('button',{name:'Exportar página (0)',exact:true})).toBeDisabled();
  }finally{release();}
  await expect(page.locator('#proveedores tbody')).toContainText('No pudimos consultar');
  await expect(page.getByRole('button',{name:'Exportar página (0)',exact:true})).toBeDisabled();
  await page.unroute('**/api/v1/purchasing/suppliers?**');
  await page.getByRole('button',{name:'Cerrar aviso de error'}).click();
  // Retrying the identical failed query must issue a fresh read, not remain stuck.
  await visiblePage(page,'purchasing/suppliers',prefix+'-',0,()=>page.getByRole('button',{name:'Buscar',exact:true}).click());
  await expect(page.locator('#proveedores tbody tr')).toHaveCount(25);
  await expect(page.getByRole('button',{name:'Exportar página (25)',exact:true})).toBeEnabled();
  await search(page,'Buscar proveedores',prefix+'-NO-EXISTE','purchasing/suppliers');
  await expect(page.locator('#proveedores tbody')).toContainText('No hay proveedores');
  await expect(page.getByRole('button',{name:'Exportar página (0)',exact:true})).toBeDisabled();
});

test('catálogo, lotes y compras descargan campos explícitos, texto seguro, fecha ISO y centavos',async({page})=>{
  const api=sessionApi(page);
  await login(page);
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const name='=SUM(1,2) "sintético" '+suffix;
  const product=await api.post('inventory/products',{sku:'CSV-'+suffix,name,category:'INSUMOS',unit:'pieza',minimumStock:7});
  const lot=await api.post('inventory/lots',{productId:product.id,batch:'CSV-L-'+suffix,expiresOn:'2035-01-02',quarantined:false});
  const supplier=await api.post('purchasing/suppliers',{reference:'CSV-P-'+suffix,name:'Proveedor sintético '+suffix});
  const order=await api.post('purchasing/orders',{reference:'CSV-OC-'+suffix,supplierId:supplier.id,expectedOn:'2030-01-02',
    lines:[{productId:product.id,quantity:3,unitCostCents:1031}]});
  await go(page,'Inventario');
  await search(page,'Buscar inventario',suffix,'inventory/products');
  const catalog=await download(page,1);
  expect(catalog.text).toContain('"Texto: =SUM(1,2) ""sintético"" '+suffix+'"');
  expect(catalog.text).toContain('"7"');
  expect(catalog.text).not.toContain(product.id);
  await page.getByRole('button',{name:'Existencias por lote',exact:true}).click();
  await search(page,'Buscar inventario',suffix,'inventory/lots');
  const lots=await download(page,1);
  expect(lots.text).toContain('"2035-01-02"');
  expect(lots.text).toContain('"Sin existencias","0"');
  expect(lots.text).not.toContain(lot.id);
  await go(page,'Compras');
  await search(page,'Buscar compras',suffix,'purchasing/orders');
  const orders=await download(page,1);
  expect(orders.text).toContain('"Recibido (centavos MXN)","Pendiente (centavos MXN)"');
  expect(orders.text).toContain('"0","3093"');
  expect(orders.text).not.toContain(order.id);
  expect(orders.text).not.toContain(supplier.id);
  await page.getByRole('link',{name:'Abrir CSV-OC-'+suffix,exact:true}).click();
  await expect(page.getByRole('button',{name:/Exportar página/})).toHaveCount(0);
});

test('recepción no obtiene exportaciones de abastecimiento ni acceso a sus APIs',async({page})=>{
  const api=sessionApi(page);
  await login(page,'recepcion');
  const navigation=page.getByRole('navigation',{name:'Navegación principal'});
  for(const label of ['Inventario','Compras','Proveedores'])await expect(navigation.getByRole('link',{name:label,exact:true})).toHaveCount(0);
  for(const path of ['inventory/products','inventory/lots','purchasing/orders','purchasing/suppliers']) {
    expect(await api.status(path)).toBe(403);
  }
  await expect(page.getByRole('button',{name:/Exportar página/})).toHaveCount(0);
});
