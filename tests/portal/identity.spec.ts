import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {readFileSync} from 'node:fs';

test('identidad en español, teclado, contraseña y errores accesibles',async({page},testInfo)=>{
  test.setTimeout(150000);
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Accede al consultorio',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Usuario',exact:true})).toBeVisible();
  await expect(page.getByLabel('Contraseña',{exact:true})).toBeVisible();
  const sizes=testInfo.project.name==='desktop'?[360,390,768,1280,1440]:[390];
  for(const width of sizes){
    await page.setViewportSize({width,height:1000});
    // The supported parent theme must not reintroduce its wide-screen container gutter.
    expect(await page.locator('#kc-header').evaluate(el=>Math.abs(el.getBoundingClientRect().left-el.parentElement!.getBoundingClientRect().left))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    expect(result.violations.map(v=>({width,id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    // Only an empty form, before any username/password entry. Never record authentication traces.
    await page.screenshot({path:'.local/previews/identity-empty-'+testInfo.project.name+'-'+width+'.png',fullPage:true});
  }
  await page.getByRole('textbox',{name:'Usuario',exact:true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#password')).toBeFocused();
  await page.getByRole('button',{name:'Mostrar contraseña',exact:true}).click();
  await expect(page.locator('#password')).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Ocultar contraseña',exact:true}).click();
  await expect(page.locator('#password')).toHaveAttribute('type','password');
  await page.locator('#username').fill('sin-cuenta-sintetica-'+Date.now());
  await page.locator('#password').fill('ejemplo-invalido-no-es-un-secreto');
  await page.getByRole('button',{name:'Entrar al portal',exact:true}).click();
  await expect(page.getByText('El usuario o la contraseña no son correctos. Revisa los datos e inténtalo de nuevo.',{exact:true})).toBeVisible();
  const errors=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(errors.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  const line=readFileSync('.local/private.env','utf8').split(/\r?\n/).find(line=>line.startsWith('DEV_ADMIN_PASSWORD='));
  if(!line)throw new Error('Falta la contraseña del usuario sintético.');
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(line.slice(line.indexOf('=')+1));
  await page.getByRole('button',{name:'Entrar al portal',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Todo en su lugar.',exact:true})).toBeVisible();
});
