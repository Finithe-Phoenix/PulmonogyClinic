# Validación de la demo v0.1.1

Esta entrega es una demostración estática con datos ficticios. La validación de interfaz no acredita una aplicación multiusuario ni un sistema clínico apto para producción.

## Comprobaciones reproducibles

```bash
npm ci
npx playwright install chromium
npm run check
```

- 13 pruebas de dominio: cantidades y caducidades, cuarentena, FEFO, fechas reales del calendario, horarios duplicados, importes en centavos, referencias únicas, adendas y exportación CSV.
- 12 pruebas de navegador: seis recorridos en escritorio y seis con viewport/touch móvil de Chromium. Verifican navegación de los ocho módulos, recarga de rutas con prefijo de Pages, citas duplicadas, persistencia local de movimientos, bloqueo de caducados, nota cerrada con adenda, conciliación/reverso de caja y almacenamiento bloqueado.
- Compilación de producción con `base-href` igual al nombre real del repositorio.
- Revisión visual de sitio y panel en escritorio y pantalla móvil; corrección del contraste del texto en la tarjeta del encabezado.

Los contextos de navegador se aíslan por prueba. Nunca se envían reservas a Doctoralia, recetas, cobros o datos de pacientes a un servicio externo.

## Entorno de verificación local

La descarga estándar del navegador desde CDN devolvió HTML en este entorno. Se usó Chromium 153 del paquete público `@sparticuz/chromium` para ejecutar las mismas pruebas. El paquete auxiliar no forma parte de las dependencias de la aplicación. Playwright permite usar un ejecutable ya instalado mediante `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; el workflow de GitHub instala el navegador oficial de Playwright.

Esta emulación móvil no equivale a haber probado Safari ni un iPhone físico. Tampoco valida concurrencia, recuperación de una base de datos, autenticación ni cumplimiento clínico; esas pruebas corresponden al sistema privado posterior.

## Publicación

El primer workflow de `main` compiló y pasó sus pruebas, pero `Configure Pages` devolvió `Get Pages site failed / Not Found`. Es necesario activar **Settings → Pages → Source: GitHub Actions** y volver a ejecutar el workflow. La preparación del workflow por sí sola no demuestra que el sitio ya esté publicado.

El siguiente despliegue debe comprobarse en Actions y después abrirse en la URL devuelta por `Deploy demo`. El artefacto `demo-browser-report` contiene el reporte y capturas del CI por siete días.
