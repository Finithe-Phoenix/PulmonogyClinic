# Validación de la entrega v0.4.0

La web y el panel de Pages contienen únicamente ejemplos. La API privada de inventario y compras todavía no está conectada a ese panel ni desplegada para uso del personal.

## Evidencia verificada

En el commit [`2596ce4`](https://github.com/Finithe-Phoenix/PulmonogyClinic/commit/2596ce40f574d2559fc7590aa4c0c9b4496cc71a) pasaron **86 casos**, verificados el 28 de septiembre de 2026 UTC:

| Componente | Casos | Evidencia |
| --- | ---: | --- |
| Reglas de la demo | 25 | [Web: ejecución 36374398392](https://github.com/Finithe-Phoenix/PulmonogyClinic/actions/runs/36374398392), job `validate` |
| Navegador | 22 | Mismo job: 11 recorridos en escritorio y 11 en pantalla móvil |
| API HTTP + PostgreSQL 17 | 38 | [API: ejecución 36374398409](https://github.com/Finithe-Phoenix/PulmonogyClinic/actions/runs/36374398409): 18 de inventario y 20 de compras |
| Migración V1 → V2 | 1 | Misma ejecución de API; esquema temporal con stock e historia previos |

Sin fallos, errores ni casos omitidos en las pruebas. La compilación Angular y el empaquetado Java también terminaron correctamente. Los reportes se conservan siete días en los artefactos de esas ejecuciones. El job de despliegue de Pages no pasó: sigue devolviendo `Get Pages site failed / Not Found` en la configuración inicial. La consulta del repositorio confirmó `has_pages: false`. Esta actualización documental no cambia el código probado.

## Qué cubren

- **Sitio:** cuatro servicios, preguntas desplegables, menú móvil, enlaces profesionales, anchura de pantalla, recorrido de los nueve módulos y recarga bajo `/PulmonogyClinic/`.
- **Operación ficticia:** recepción con rechazo de duplicados, notas cerradas y adendas, cobros/reversos, conservación local, aviso de almacenamiento bloqueado y migración desde v1.
- **Inventario y compras de demo:** nuevo producto, lotes posteriores, cero unidades al alta, entrada con motivo, persistencia, catálogo disponible en Compras, entregas parciales, cancelación del saldo, cuarentena, FEFO y exportación.
- **Servidor:** JWT con firma real de prueba, emisor/audiencia/vigencia, identidad y vencimiento obligatorios; denegación por rol, validación de cantidades y campos, SKUs/lotes únicos, idempotencia secuencial y concurrente, rollback completo y última unidad retirada por dos usuarios a la vez.
- **Compras privadas:** proveedores, referencias únicas normalizadas, órdenes de varias partidas, costo y producto conservados, centavos exactos y stock intacto al ordenar. Entregas parciales/completas, rechazo de sobreentrega y partida ajena, caducidad/cuarentena, costos tomados de la orden, folios duplicados con rollback y cancelación administrativa que conserva las entregas.
- **Concurrencia de compras:** dos entregas sobre la última unidad pendiente; reintentos simultáneos con una sola recepción; órdenes distintas que comparten un lote; cancelación simultánea con recepción, conservando una situación final consistente.
- **PostgreSQL:** migraciones Flyway, conservación de existencias/historia al actualizar desde V1, bloqueos de orden/lote, insumos sin caducidad, caducados/cuarentena excluidos de FEFO, bajas autorizadas y rechazo de UPDATE/DELETE de movimientos, recepciones de compra y auditoría.

En la v0.3.0, las capturas revelaron desplazamiento horizontal en Inventario móvil; la vista se ajustó a fichas y el recorrido verifica también la anchura interna de esa tabla. Las capturas de referencia guardadas en `docs/previews` corresponden a esa entrega y provienen del navegador de Actions, con datos ficticios. Los recorridos de la v0.4.0 volvieron a pasar en ambos tamaños.

## Reproducir la web

```bash
npm ci
npx playwright install chromium
npm run check
```

25 pruebas de dominio, compilación de producción y 22 recorridos de navegador. La fecha operativa de la demo es fija: 28/09/2026. Los contextos se aíslan por prueba. No se envían citas, recetas ni pagos a servicios externos.

Se ejecutaron localmente las pruebas de dominio y las compilaciones Angular/Java. Las pruebas de navegador y API se ejecutaron en GitHub Actions. El entorno local no proporcionó PostgreSQL operativo; no se declara una ejecución local de la integración.

## Reproducir la API

JDK 21, Maven y **una base PostgreSQL 17 exclusiva y desechable**. Exportar `TEST_DB_URL`, `TEST_DB_USER` y `TEST_DB_PASSWORD` para esa base y ejecutar:

```bash
mvn -B -ntp -f backend/pom.xml verify
```

La suite ejecuta 39 casos y trunca las tablas entre ellos. Nunca apuntarla a una base de operación. La prueba de actualización crea y elimina solo su esquema temporal aleatorio. Los tokens usan claves efímeras y un JWKS local dentro de las fuentes de prueba; esa identidad no se empaqueta en la aplicación. Se utiliza PostgreSQL real, sin H2 ni omisión silenciosa de integración.

## Límites de la evidencia

La emulación móvil es Chromium con viewport/touch de iPhone 13, no Safari ni un teléfono físico. Estas pruebas no acreditan certificación clínica, seguridad integral, recuperación ante desastre, aislamiento de varias clínicas, carga de producción ni integración con un proveedor real de identidad. El servidor necesita hosting privado, HTTPS, MFA, permisos de base mínimos, conexión del portal y pruebas de respaldo/restauración antes del piloto.

El sitio oficial requiere validación de marca, fotografías, servicios y contenidos por el consultorio. No se han cargado datos reales ni exportaciones de Doctoralia al repositorio.

## Publicación pendiente

Habilitar [Settings → Pages](https://github.com/Finithe-Phoenix/PulmonogyClinic/settings/pages), seleccionar **GitHub Actions** y volver a ejecutar el job fallido. La conexión de GitHub permite subir código y administrar ejecuciones, pero no ofrece la operación para cambiar esa configuración; el intento por navegador no respondió. No se declara una URL de demo funcionando hasta verificar el despliegue.
