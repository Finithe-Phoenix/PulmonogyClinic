import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, csvDate, catalogCsv, lotsCsv, purchasesCsv, suppliersCsv,
  canExportPage, preparePageExport, type VisiblePage } from '../src/app/portal/csv-export.ts';

function page<T>(rows: readonly T[], override: Partial<VisiblePage<T>> = {}): VisiblePage<T> {
  return {items:()=>rows, loading:()=>false, failed:()=>false, offset:()=>0, size:25, ...override};
}

test('CSV usa BOM UTF-8, CRLF y escape RFC4180 sin perder comas, comillas o saltos', () => {
  const result=buildCsv([{value:'Espirometría, "equipo"\r\nLínea 2'}], [{heading:'Descripción',value:row=>row.value}]);
  assert.equal(result,'\uFEFF"Descripción"\r\n"Espirometría, ""equipo""\r\nLínea 2"\r\n');
  assert.deepEqual([...Buffer.from(result).subarray(0,3)],[0xef,0xbb,0xbf]);
});

test('CSV neutraliza fórmulas, controles iniciales y variantes de locale con marca visible', () => {
  for(const value of ['=1+1','+SUM(A1)','-42','@SUM(A1)','\t=1','\r=1','\n=1',
    '  =1','\u0000=1',' \ttexto','＝1','＋1','－1','＠SUM(A1)','\u00a0=1']) {
    assert.equal(buildCsv([value],[{heading:'Valor',value:row=>row}]),
      '\uFEFF"Valor"\r\n"Texto: '+value+'"\r\n',JSON.stringify(value));
  }
});

test('CSV impide romper una celda con separadores o comillas e inyectar otra fórmula', () => {
  const result=buildCsv(['ok",=1+1','ok;=1+1'],[{heading:'=cabecera',value:row=>row}]);
  assert.equal(result,'\uFEFF"Texto: =cabecera"\r\n"ok"",=1+1"\r\n"ok;=1+1"\r\n');
});

test('CSV conserva números enteros, incluido cero, sin división ni redondeo', () => {
  assert.equal(buildCsv([0,1,100000001,Number.MAX_SAFE_INTEGER,-42], [{heading:'Centavos',value:row=>row}]),
    '\uFEFF"Centavos"\r\n"0"\r\n"1"\r\n"100000001"\r\n"9007199254740991"\r\n"-42"\r\n');
  for(const value of [NaN,Infinity,1.2,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>buildCsv([value],[{heading:'Valor',value:row=>row}]),/enteros seguros/);
  }
});

test('CSV conserva texto benigno, acentos, campos vacíos y booleanos', () => {
  assert.equal(buildCsv(['  Dosificación',null,undefined,true,false],[{heading:'Valor',value:row=>row}]),
    '\uFEFF"Valor"\r\n"  Dosificación"\r\n""\r\n""\r\n"true"\r\n"false"\r\n');
  assert.throws(()=>buildCsv([],[]),/columnas explícitas/);
});

test('CSV conserva fechas ISO válidas sin depender de zona y rechaza fechas imposibles', () => {
  const previous=process.env.TZ;
  try {
    for(const zone of ['Asia/Tokyo','America/Mexico_City','America/Los_Angeles']) {
      process.env.TZ=zone;
      assert.equal(csvDate('2028-02-29'),'2028-02-29');
      assert.equal(csvDate(null),'');
    }
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  for(const value of ['2026-02-29','2026-04-31','28/09/2026','2026-9-1','2026-09-28T00:00:00Z','']) {
    assert.throws(()=>csvDate(value),/fecha/);
  }
});

test('proyecciones allowlist excluyen IDs de usuario, tokens y campos ajenos', () => {
  const extra={actor:'USER-PRIVATE',access_token:'TOKEN-PRIVATE',clinicalNote:'CLINICAL-PRIVATE'};
  const files=[
    catalogCsv([{...extra,id:'PRODUCT-PRIVATE',sku:'SYN-01',name:'Catálogo',category:'INSUMOS',unit:'pieza',minimumStock:1}]),
    lotsCsv([{...extra,id:'LOT-PRIVATE',productId:'PRODUCT-PRIVATE',productName:'Producto',batch:'L-01',expiresOn:'2028-02-29',quantity:12,quarantined:false}],()=> 'Disponible'),
    purchasesCsv([{...extra,id:'ORDER-PRIVATE',supplierId:'SUPPLIER-PRIVATE',reference:'OC-01',status:'PENDING',totalCents:1030,receivedCents:1,pendingCents:1029}],()=> 'Pendiente'),
    suppliersCsv([{...extra,id:'SUPPLIER-PRIVATE',name:'Proveedor',reference:'P-01'}]),
  ];
  for(const file of files)assert.doesNotMatch(file,/-PRIVATE/);
  assert.match(files[1],/2028-02-29/);
  assert.match(files[2],/"Recibido \(centavos MXN\)"/);
  assert.match(files[2],/"1","1029"/);
});

test('exportación rechaza sesión/rol no autorizado, carga, error, página vacía o sobrelímite', () => {
  assert.equal(canExportPage(page(['a']),false),false);
  for(const rows of [page([]),page(['a'],{loading:()=>true}),page(['a'],{failed:()=>true}),
    page(['a'],{offset:()=>-1}),page(['a','b'],{size:1}),page(['a'],{size:Infinity})]) {
    assert.equal(canExportPage(rows,true),false);
    assert.equal(preparePageExport(rows,true,'catalogo',()=>{throw Error('No debe serializar');}),null);
  }
  assert.equal(preparePageExport(page(['a']),false,'catalogo',()=>{throw Error('No debe serializar');}),null);
});

test('exportación toma solo la página visible y nombra alcance parcial sin filtros sensibles', () => {
  const visible=Array.from({length:25},(_,i)=>'VISIBLE-'+i);
  let received: readonly string[]=[];
  const result=preparePageExport(page(visible,{offset:()=>25}),true,'proveedores',rows=>{
    received=rows;return buildCsv(rows,[{heading:'Proveedor',value:row=>row}]);
  },new Date('2026-09-28T17:00:00Z'));
  assert.equal(result?.count,25);
  assert.equal(result?.filename,'pulmonogy-proveedores-parcial-pagina-2-25-registros-2026-09-28T17-00-00.000Z.csv');
  assert.deepEqual(received,visible);
  assert.notEqual(received,visible);
  assert.equal(result?.csv.split('\r\n').length,27);
});
