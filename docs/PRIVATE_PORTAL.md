# Portal privado local · v0.5.0

La primera operación conectada usa Angular → API Spring Boot → PostgreSQL, con Keycloak como identidad **exclusivamente de desarrollo**. El sitio y los nueve módulos de demo siguen siendo una compilación independiente, sin clientes de identidad ni acceso al servidor privado. Usar únicamente datos sintéticos.

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
| admin | DEV_ADMIN_PASSWORD | Catálogo, proveedores, compras, cancelaciones, inventario y auditoría |
| farmacia | DEV_PHARMACY_PASSWORD | Lectura de inventario/compras, creación de órdenes y recepciones |
| auditor | DEV_AUDITOR_PASSWORD | Consulta de inventario/compras y auditoría |
| recepcion | DEV_RECEPTION_PASSWORD | Sin acceso a los módulos de esta entrega |

No existe usuario administrador de Keycloak habilitado por este script. Los roles se importan en servidor. Los IDs de los usuarios sintéticos son estables para conservar trazabilidad si se recrea la identidad. El servidor de identidad usa su almacenamiento de desarrollo dentro del contenedor; no es una instalación productiva ni un respaldo de identidades.

Para detener conservando la base: `npm run dev:private:stop`. Para volver a iniciar, `npm run dev:private`. No ejecutar `down -v` ni borrar `.local/private.env`: el volumen de PostgreSQL conserva su contraseña inicial. Después de cambiar Angular, recompilar con `npm run build:portal` y recargar el navegador. Después de modificar el gateway, reiniciar su servicio. El arranque `up --build` reconstruye la API cuando corresponde.

## Recorrido de aceptación

1. Iniciar sesión como admin. Crear un producto de **Insumos** con SKU nuevo, nombre sintético y unidad `pieza`.
2. Crear un proveedor sintético con referencia única.
3. Crear una orden de 10 unidades a 1000 centavos ($10 MXN) cada una, con fecha esperada vigente. Es posible añadir más partidas. No aumenta el stock.
4. Abrir la orden y recibir 4 unidades con folio y lote nuevos. Para farmacia es obligatoria una caducidad vigente; un insumo puede omitirla.
5. Comprobar estado PARTIAL, recibido $40, saldo $60, 4 unidades en el lote y eventos en Auditoría. Recibir en cuarentena mantiene su condición.
6. Cerrar sesión, volver a entrar y abrir la misma orden. Los datos proceden del servidor. Una recarga elimina los tokens en memoria: pulsar Iniciar sesión para recuperar acceso mediante la sesión de Keycloak.
7. En otro contexto de navegador, entrar como farmacia y consultar la misma orden. Usar Actualizar para traer cambios de otro usuario; no hay actualización en tiempo real. Las recepciones concurrentes se serializan en PostgreSQL y no pueden superar el saldo.
8. Si se pierde una respuesta, la pantalla conserva la solicitud y el UUID en `sessionStorage`, ligados a la identidad original. Reintentar reutiliza cuerpo y clave; incluso después de recargar e iniciar sesión. Mientras exista una operación incierta se bloquean nuevas escrituras en esa pestaña. No borrar el almacenamiento ni cerrar esa pestaña antes de resolverla.

## Seguridad aplicada y límites

- Flujo Authorization Code + PKCE S256, cliente público con redirecciones exactas; sin password grant, implicit flow ni secreto embebido en Angular.
- Access token e ID token solo en memoria; el estado temporal de PKCE y una operación pendiente se conservan en almacenamiento de sesión. No se guardan tokens en localStorage ni se vuelcan a consola.
- La API conserva sus comprobaciones de firma, emisor, audiencia, expiración, sujeto y roles. El gateway reenvía únicamente Bearer explícito y cabeceras necesarias, sin cookies. Deniega origen ajeno, Host no permitido, métodos no usados y cuerpos de más de 64 KiB; no abre CORS en Spring.
- Respuestas sin caché, `nosniff`, `no-referrer`, política de contenido y prohibición de enmarcado. El CSS se enlaza sin manejadores inline de JavaScript.
- UI por rol como ayuda; las restricciones efectivas se aplican en servidor. La auditoría usa el `sub` del JWT, no un nombre enviado desde la interfaz.
- Pagina los listados de API hasta su final. Es una primera interfaz administrativa: el rendimiento con grandes volúmenes y filtros por servidor necesita trabajo antes del piloto.
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

`test:api:local` crea otro servicio PostgreSQL, `test-db`, con base `clinic_test` y disco temporal; sus 39 casos truncan **esa base**, no `clinic_dev`. Las pruebas de portal no truncan: agregan registros sintéticos con referencias aleatorias a la base de desarrollo. No ejecutar ninguna de estas suites contra una clínica operativa.

La suite de portal recorre escritorio y móvil: acceso real, persistencia entre sesiones, auditoría, pérdida de respuesta con reintento tras recarga, concurrencia admin/farmacia sobre la última unidad, rechazo de escritura del auditor y acceso anónimo/restringido. No graba trazas, vídeo ni capturas del inicio de sesión, porque podrían contener credenciales. El workflow `portal.yml` repite el recorrido con contraseñas efímeras generadas durante su ejecución.

Fuentes consultadas: [Keycloak en Docker](https://www.keycloak.org/getting-started/getting-started-docker), [importación de realms](https://www.keycloak.org/server/importExport), [almacenamiento de oidc-client-ts](https://authts.github.io/oidc-client-ts/interfaces/UserManagerSettings.html). Keycloak fijado en 26.7.4 y oidc-client-ts en 3.5.0.
