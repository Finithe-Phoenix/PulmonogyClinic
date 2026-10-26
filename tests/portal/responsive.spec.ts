import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {readFileSync,writeFileSync} from 'node:fs';
const secrets=Object.fromEntries(readFileSync('.local/private.env','utf8').trim().split(/\r?\n/).map(line=>line.split('=')));
for(const width of [360,390,768,1280,1440]){
  test('navegación y accesibilidad a '+width+'px',async({page},testInfo)=>{
    test.setTimeout(180000);
    const routeHeadings:Array<{module:string;milliseconds:number}>=[];
    const apiReads:number[]=[];
    // Timing only: never retain headers, URLs, payloads, token responses or identity traffic.
    page.on('requestfinished',request=>{
      if(request.method()!=='GET'||!new URL(request.url()).pathname.startsWith('/api/v1/'))return;
      const timing=request.timing();
      if(timing.responseEnd>=0)apiReads.push(timing.responseEnd);
    });
    await page.setViewportSize({width,height:1000});
    await page.goto('/');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const access=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    expect(access.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await page.locator('#username').fill('admin');await page.locator('#password').fill(secrets.DEV_ADMIN_PASSWORD);await page.locator('#kc-login').click();
    await expect(page.getByRole('heading',{name:'Todo en su lugar.'})).toBeVisible();
    for(const module of ['Inicio','Agenda','Pacientes','Inventario','Compras','Proveedores','Equipos','Caja','Auditoría']){
      const link=page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:module,exact:true});
      if(!await link.isVisible())await page.getByRole('button',{name:'Abrir o cerrar navegación'}).click();
      const routeStart=performance.now();
      await link.click();
      const titles:Record<string,string>={Inicio:'Todo en su lugar.',Agenda:'Agenda y recepción',Auditoría:'Auditoría del servidor'};
      await expect(page.locator('main h1')).toHaveText(titles[module]||module);
      routeHeadings.push({module,milliseconds:Math.round(performance.now()-routeStart)});
      await page.screenshot({path:'.local/previews/portal-'+module.toLowerCase()+'-'+width+'.png',fullPage:true});
      const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,outside:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth && !el.closest('.table-scroll')).map(el=>({tag:el.tagName,classes:el.className,right:el.getBoundingClientRect().right})).slice(0,12)}));
      expect(overflow.document,JSON.stringify({module,...overflow})).toBeLessThanOrEqual(overflow.width);
      const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
      expect(result.violations.map(v=>({module,id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
      // Deliberate synthetic screenshots after authentication; never capture credentials or tokens.
      if(module==='Inicio'||module==='Inventario')await page.screenshot({path:'.local/previews/portal-'+module.toLowerCase()+'-'+width+'.png',fullPage:true});
    }
    const sorted=apiReads.toSorted((a,b)=>a-b);
    const percentile=(p:number)=>sorted.length?Math.round(sorted[Math.ceil(sorted.length*p)-1]):null;
    const timingPath=testInfo.outputPath('render-and-api-timing-'+width+'.json');
    writeFileSync(timingPath,JSON.stringify({
        scope:'LOCAL_SYNTHETIC_OBSERVATION_NOT_LOAD_TEST',width,routeHeadings,
        apiReads:{count:sorted.length,p50Milliseconds:percentile(.5),p95Milliseconds:percentile(.95)},
        limits:['One fresh Chromium context at this width; warm local services; no throttling',
          'Click-to-heading includes Playwright waiting; not full list readiness or field Core Web Vitals',
          'GET timings include local gateway/API only; not authentication or production latency'],
      },null,2));
    await testInfo.attach('render-and-api-timing-'+width+'.json',{contentType:'application/json',path:timingPath});
  });
}
