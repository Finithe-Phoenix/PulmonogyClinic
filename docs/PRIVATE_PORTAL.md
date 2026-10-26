# Portal privado local · v0.6.0

El portal usa Angular → API Spring Boot → PostgreSQL, con Keycloak como identidad **exclusivamente de desarrollo**. Incluye compras/inventario, pacientes administrativos, agenda/recepción, caja y equipos, con rutas y permisos propios. El sitio y los nueve módulos de demo siguen siendo una compilación independiente, sin clientes de identidad ni acceso al servidor privado. Usar únicamente datos sintéticos. La marca y la preparación clínica productiva siguen pendientes.

## Reproducir en Windows, Linux o macOS

Requisitos: Node 24, npm y Docker con motor Linux funcionando. Java 21 y Maven están incluidos en los contenedores; el Java del host no se modifica. Desde la raíz:

```text
npm ci
npm run build:portal
npm run dev:private
node scripts/wait-private.mjs
```

Abrir **http://localhost:4180/** (usar `localhost`, porque la URI de retorno es exacta). Identidad: `http://localhost:8180/realms/clinic-dev`. API de diagnóstico: `http://localhost:8181/health`. Los puertos publicados se enlazan exclusivamente a `127.0.0.1`; PostgreSQL no publica un puerto al host. El gateway solo sirve el build del portal y `/api/` hacia la API configurada.

El primer arranque genera contraseñas aleatorias individuales en `.local/private.env`, excluido de Git. Abrir ese archivo localmente para iniciar sesión; no copiarlo en mensajes, capturas, commits ni artefactos. No hay contraseñas predeterminadas. Usuarios:

| Usuario sintético | Variable de contraseña | Permisos |
| --- | --- | --- |
| admin | DEV_ADMIN_PASSWORD | Administración de los módulos operativos, reversos de caja y auditoría |
| farmacia | DEV_PHARMACY_PASSWORD | Inventario/compras, órdenes, recepciones, movimientos permitidos y consulta de equipos |
| auditor | DEV_AUDITOR_PASSWORD | Consulta de los módulos y auditoría, sin escrituras |
| recepcion | DEV_RECEPTION_PASSWORD | Pacientes administrativos, reservas/llegadas, caja sin reversos y consulta de equipos |

Pulsa «Iniciar sesión» desde el portal y después «Entrar al portal» en la pantalla en español. No reutilices una URL antigua de `login-actions`. El rol MEDICO está definido para consulta administrativa, agenda/transiciones clínicas administrativas y consulta de equipos; aún no hay una cuenta de médico aprovisionada.

No queda una cuenta administrativa temporal habilitada en Keycloak. El mantenimiento local del 28/09/2026 preservó los cuatro usuarios, IDs, credenciales, clientes y claves, y migró la H2 a un volumen persistente. El respaldo privado se conserva fuera de Git. [Procedimiento y recuperación](IDENTITY_MAINTENANCE.md). Las instalaciones antiguas sin volumen deben usar ese procedimiento antes de recrear identidad. H2 y `start-dev` no son una instalación productiva.

Para detener conservando la base: `npm run dev:private:stop`. Para volver a iniciar, `npm run dev:private`. No ejecutar `down -v` ni borrar `.local/private.env`: el volumen de PostgreSQL conserva su contraseña inicial. Después de cambiar Angular, recompilar con `npm run build:portal` y recargar el navegador. Después de modificar el gateway, reiniciar su servicio. El arranque `up --build` reconstruye la API cuando corresponde.

## Recorrido de aceptación

1. Iniciar sesión como admin. Crear un producto de **Insumos** con SKU nuevo, nombre sintético y unidad `pieza`.
2. Crear un proveedor sintético con referencia única.
3. Crear una orden de 10 unidades a **10.00 pesos** cada una, con fecha esperada vigente. La interfaz convierte el precio a 1000 centavos exactamente; no pide escribir centavos. Es posible añadir más partidas. No aumenta el stock.
4. Abrir la orden y recibir 4 unidades con folio y lote nuevos. Para farmacia es obligatoria una caducidad vigente; un insumo puede omitirla.
5. Comprobar estado «Recepción parcial», recibido $40, saldo $60, 4 unidades en el lote y eventos en Auditoría. Recibir en cuarentena mantiene su condición.
6. Cerrar sesión, volver a entrar y abrir la misma orden. Los datos proceden del servidor. Una recarga elimina los tokens en memoria: pulsar Iniciar sesión para recuperar acceso mediante la sesión de Keycloak.
7. En otro contexto de navegador, entrar como farmacia y consultar la misma orden. Usar Actualizar para traer cambios de otro usuario; no hay actualización en tiempo real. Las recepciones concurrentes se serializan en PostgreSQL y no pueden superar el saldo.
8. Si se pierde una respuesta, la pantalla conserva la solicitud y el UUID en `sessionStorage`, ligados a la identidad original. Reintentar reutiliza cuerpo y clave; incluso después de recargar e iniciar sesión. Mientras exista una operación incierta se bloquean nuevas escrituras en esa pestaña. No borrar el almacenamiento ni cerrar esa pestaña antes de resolverla.

## Seguridad aplicada y límites

- Flujo Authorization Code + PKCE S256, cliente público con redirecciones exactas; sin password grant, implicit flow ni secreto embebido en Angular.
- Access token e ID token solo en memoria; el estado temporal de PKCE y una operación pendiente se conservan en almacenamiento de sesión. No se guardan tokens en localStorage ni se vuelcan a consola.
- La renovación usa el proveedor real antes de vencer. Ante 401/fallo, el portal oculta los datos y bloquea consultas/cambios sin destruir el formulario. «Reautenticar y recuperar formulario» abre un acceso PKCE: la misma cuenta/permisos recupera el borrador en memoria; otra identidad lo descarta. No cerrar/recargar esa pestaña si se necesita conservarlo. [Contrato y pruebas](SESSION_RECOVERY.md).
- La API conserva sus comprobaciones de firma, emisor, audiencia, expiración, sujeto y roles. El gateway reenvía únicamente Bearer explícito y cabeceras necesarias, sin cookies. Deniega origen ajeno, Host no permitido, métodos no usados y cuerpos de más de 64 KiB; no abre CORS en Spring.
- Respuestas sin caché, `nosniff`, `no-referrer`, política de contenido y prohibición de enmarcado. El CSS se enlaza sin manejadores inline de JavaScript.
- UI por rol como ayuda; las restricciones efectivas se aplican en servidor. La auditoría usa el `sub` del JWT, no un nombre enviado desde la interfaz.
- Los listados consultan páginas limitadas (generalmente 25 registros) y búsqueda/filtros en servidor; no descargan todo el historial al entrar. El rendimiento de volúmenes productivos sigue pendiente de medición.
- Keycloak `start-dev`, HTTP de loopback, usuarios sintéticos y usuario de BD propietario son solo desarrollo. Faltan selección de infraestructura, HTTPS, MFA obligatorio, provisión y baja de personal, roles mínimos de BD, gestión externa de secretos y restauración productiva.
- La operación pendiente sobrevive una recarga pero no el cierre definitivo de la pestaña. Ante esa pérdida, conciliar por folio/historia antes de registrar de nuevo. Las claves del servidor evitan duplicados solo cuando se conserva la misma clave; las referencias únicas también rechazan una segunda alta.

## Verificación

```text
npm test
npm run build:pages
npx playwright install chromium
npm run test:e2e
npm run test:api:local
npm run test:portal
```

`test:api:local` crea otro servicio PostgreSQL, `test-db`, con base `clinic_test` y disco temporal; sus 100 casos actuales truncan **esa base**, no `clinic_dev`. Las pruebas de portal no truncan: agregan registros sintéticos con referencias aleatorias a la base de desarrollo. Caja no cierra turnos ajenos a su propia prueba. No ejecutar ninguna de estas suites contra una clínica operativa.

La suite de portal recorre escritorio y móvil: acceso real, compras, pacientes/agenda, caja, equipos, persistencia, auditoría, recuperación con la misma clave, concurrencia y denegación por rol. Incluye recorridos de accesibilidad/anchura en cinco tamaños. No graba trazas, vídeo ni formularios con credenciales; las únicas capturas del acceso son formularios vacíos anteriores a escribir cualquier usuario o contraseña. El workflow `portal.yml` usa contraseñas efímeras; las nuevas pruebas requieren una nueva ejecución de Actions antes de atribuirles validación remota.

Fuentes consultadas: [Keycloak en Docker](https://www.keycloak.org/getting-started/getting-started-docker), [importación de realms](https://www.keycloak.org/server/importExport), [almacenamiento de oidc-client-ts](https://authts.github.io/oidc-client-ts/interfaces/UserManagerSettings.html). Keycloak fijado en 26.7.4 y oidc-client-ts en 3.5.0.
