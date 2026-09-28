# Validación de la demo v0.2.0

Esta entrega es una demostración estática con datos ficticios. La validación de interfaz no acredita una aplicación multiusuario ni un sistema clínico apto para producción.

## Comprobaciones reproducibles

```bash
npm ci
npx playwright install chromium
npm run check
```

- 22 pruebas de dominio: cantidades y caducidades, cuarentena, FEFO, fechas reales del calendario, horarios duplicados, importes en centavos, referencias únicas, adendas y exportación CSV; órdenes de compra, recepción parcial, referencias repetidas, cuarentena, cancelación del saldo y migración del estado v1.
- 18 pruebas de navegador: nueve recorridos en escritorio y nueve con viewport/touch móvil de Chromium. Verifican navegación de los nueve módulos, recarga de rutas con prefijo de Pages, citas duplicadas, persistencia local de movimientos, bloqueo de caducados, nota cerrada con adenda, conciliación/reverso de caja y almacenamiento bloqueado. Se agregan compras de varias partidas, recepciones parciales, cancelación y migración de ejemplos guardados.
- Compilación de producción con `base-href` igual al nombre real del repositorio.
- Revisión visual de sitio y panel en escritorio y pantalla móvil; corrección del contraste del texto en la tarjeta del encabezado.

Los contextos de navegador se aíslan por prueba. Nunca se envían reservas a Doctoralia, recetas, cobros o datos de pacientes a un servicio externo.

## Entorno de verificación local

En v0.1.1, la descarga estándar del navegador desde CDN devolvió HTML en el entorno local y se usó Chromium 153 del paquete público `@sparticuz/chromium`. Ese paquete auxiliar no forma parte de la aplicación. Para v0.2.0, las 22 pruebas de dominio y la compilación se ejecutaron localmente; las 18 pruebas de navegador se ejecutaron en GitHub Actions con el navegador oficial de Playwright. Las capturas del CI se revisaron y se ajustó la vista de compras en celular para mostrar fichas sin desplazamiento horizontal.

Esta emulación móvil no equivale a haber probado Safari ni un iPhone físico. Tampoco valida concurrencia, recuperación de una base de datos, autenticación ni cumplimiento clínico; esas pruebas corresponden al sistema privado posterior.

## Publicación

El workflow de la entrega anterior compiló y pasó sus pruebas, pero `Configure Pages` devolvió `Get Pages site failed / Not Found`. Es necesario activar **Settings → Pages → Source: GitHub Actions** y volver a ejecutar el workflow. La preparación del workflow por sí sola no demuestra que el sitio ya esté publicado.

El siguiente despliegue debe comprobarse en Actions y después abrirse en la URL devuelta por `Deploy demo`. El artefacto `demo-browser-report` contiene el reporte y capturas del CI por siete días.
