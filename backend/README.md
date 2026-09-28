# API privada de inventario · v0.3.0

Primera parte del servidor del consultorio: catálogo, lotes, movimientos, cuarentena y auditoría en PostgreSQL. Java 21, Spring Boot 4.0.8, Spring Security y Flyway. **La demo Angular de Pages todavía usa sus ejemplos locales; no está conectada a esta API.**

El servidor inicia sin productos ni usuarios de ejemplo. No almacena pacientes ni notas clínicas. Su entrega es una base de desarrollo con pruebas de integración, no una autorización para utilizarla con datos reales.

## Arranque local

Requisitos: JDK 21, Maven 3.9 y PostgreSQL 17 (o Docker Compose para la base local).

1. Copiar `.env.example` a `.env` y definir una contraseña local. El archivo está excluido de Git. Compose lee `.env`; Java necesita que las variables estén exportadas en el proceso, IDE o gestor de secretos.
2. Iniciar PostgreSQL desde `backend`: `docker compose up -d db`. Solo publica el puerto en `127.0.0.1` y conserva la base en un volumen. No utilizar esta configuración como despliegue de producción.
3. Configurar `DB_URL`, `DB_USER`, `DB_PASSWORD`, `OIDC_ISSUER_URI`, `OIDC_JWK_SET_URI` y `OIDC_AUDIENCE` en el entorno de Java. Emisor y JWKS deben pertenecer al proveedor de identidad autorizado. No hay contraseña predeterminada, emisor de tokens propio ni modo de autenticación desactivada.
4. Ejecutar `mvn spring-boot:run`. Flyway crea el esquema. `GET http://localhost:8080/health` comprueba que el proceso responde; no es una comprobación completa de recuperación ni del proveedor de identidad.
5. Para empaquetar: `mvn -DskipTests package` y `java -jar target/clinic-api-0.3.0.jar` con las mismas variables. Para validar, ejecutar las pruebas de la sección siguiente.

En un entorno privado, configurar HTTPS, límite de cuerpo JSON en el proxy, identidad con MFA, gestión de secretos, base con acceso restringido y respaldo/restauración. El emisor de identidad debe asignar roles en servidor; nunca permitir que un usuario edite su propio claim `roles`.

## Identidad y permisos

Cada llamada privada lleva `Authorization: Bearer <access_token>` firmado por el proveedor. Se verifican firma, emisor, audiencia y vigencia; se exige identidad `sub` y fecha de vencimiento `exp`. El claim `roles` es una lista; la identidad de los movimientos proviene de `sub`, nunca del cuerpo enviado por el cliente.

| Rol | Leer inventario | Crear productos | Crear lotes / entradas / salidas | Liberar o poner en cuarentena / bajas | Leer auditoría |
| --- | --- | --- | --- | --- | --- |
| ADMIN | Sí | Sí | Sí | Sí | Sí |
| FARMACIA | Sí | No | Sí | No | No |
| AUDITOR | Sí | No | No | No | Sí |
| RECEPCION | No | No | No | No | No |

Permisos para una sola organización: no se implementa aislamiento de varias clínicas. El proveedor de identidad y MFA aún deben seleccionarse y configurarse. No hay inicio de sesión en Angular, tokens en localStorage, autenticación Basic, sesiones por cookie ni CORS abierto. CSRF está deshabilitado únicamente porque la API acepta Bearer explícito y no credenciales que el navegador envíe automáticamente. Si se introducen cookies, debe revisarse esta decisión.

## Contrato HTTP

Prefijo de inventario: `/api/v1/inventory`. Los listados devuelven `{items, limit, offset}`; límite predeterminado 50, máximo 100. Todas las escrituras requieren `Idempotency-Key`, un UUID nuevo por operación; un reintento conserva la misma clave y cuerpo.

| Método / ruta | Uso |
| --- | --- |
| GET /products | Catálogo ordenado por SKU |
| POST /products | `{sku, name, category, unit, minimumStock}`; category: FARMACIA o INSUMOS |
| GET /lots | Filtros `productId`, `availableOnly`; orden FEFO, sin caducidad al final |
| GET /lots/{id} | Estado actual de un lote |
| POST /lots | `{productId, batch, expiresOn, quarantined}`; crea lote con cero unidades |
| POST /lots/{id}/movements | `{kind, quantity, reason}`; kind: RECEIPT, ISSUE, DISPOSAL |
| POST /lots/{id}/quarantine | `{quarantined, reason}`; solo ADMIN |
| GET /movements | Historia, filtro opcional `lotId` |
| GET /api/v1/audit/events | Auditoría administrativa; ruta fuera del prefijo de inventario |

Ejemplo de cuerpo para crear un producto sintético:

```json
{"sku":"DEMO-001","name":"Producto de demostración","category":"FARMACIA","unit":"pieza","minimumStock":5}
```

Crear después un lote con el `productId` devuelto y registrar la entrada como movimiento. Las unidades son enteras de la unidad del catálogo; aún no hay conversiones caja/pieza. `quarantined` debe enviarse expresamente como `true` o `false`; omitirlo o enviar `null` se rechaza. Farmacia exige caducidad ISO `AAAA-MM-DD`; los insumos pueden no tenerla. Un lote se considera caducado después de su fecha según `America/Mexico_City`.

Respuesta: 201 en altas y movimientos, 200 en consultas/cuarentena. Los reintentos exitosos devuelven el mismo resultado y código original, incluso si el saldo actual cambió después; consultar el lote para el saldo vigente. Errores de dominio usan Problem Details con `code`: 400 datos inválidos, 401 autenticación, 403 permisos, 404 recurso inexistente, 409 conflicto de stock/duplicado/idempotencia. Los rechazos de autenticación/autorización provienen de Spring Security y pueden no incluir cuerpo Problem Details.

## Consistencia comprobable

- Cada operación reserva una clave única dentro de la misma transacción. Clave/cuerpo/usuario iguales devuelven la respuesta guardada; un cambio causa conflicto. Un fallo revierte también la clave, permitiendo corregir y reintentar.
- Las salidas, entradas, bajas y cuarentena bloquean el lote en PostgreSQL. El saldo, movimiento, respuesta de idempotencia y evento de auditoría se confirman juntos.
- Las salidas rechazan lotes caducados, en cuarentena o insuficientes. Las entradas a cuarentena conservan esa condición. Las bajas autorizadas descuentan unidades sin eliminarlas de la historia.
- Los triggers rechazan UPDATE/DELETE de movimientos y auditoría. Esto no es un registro criptográfico ni impide cambios de un administrador de base con privilegios para alterar el esquema; no se afirma inmutabilidad absoluta.
- La API no permite modificar caducidad/producto de un lote, borrar movimientos o escribir el saldo directamente. Debe diseñarse el flujo de corrección con el responsable antes del piloto.

## Pruebas contra PostgreSQL

Las pruebas son HTTP real con JWT firmados mediante una clave efímera y JWKS local de pruebas. La clave y el servidor de identidad de pruebas no se empaquetan. No se utiliza H2 ni se omiten pruebas si falta PostgreSQL.

**Usar una base exclusiva y desechable:** la suite trunca sus tablas entre casos. No apuntar nunca a la base de operación. Exportar `TEST_DB_URL`, `TEST_DB_USER`, `TEST_DB_PASSWORD` para esa base y ejecutar `mvn verify` desde `backend`. GitHub Actions crea un PostgreSQL 17 efímero para cada ejecución y conserva el reporte de pruebas.

Se ejercitan permisos, firmas/emisor/audiencia/vigencia incorrectos, validación de cantidades, duplicados, reintentos, rollback, última unidad concurrente, recepciones simultáneas con la misma clave, cuarentena, caducidad, baja autorizada, FEFO y protección de historia.

## Siguiente integración

Conectar Angular con el proveedor de identidad usando flujo de autorización apropiado; mantener separación entre demo y portal privado. Llevar compras/recepciones parciales, pacientes administrativos, recepción, caja y equipos a sus módulos persistentes. El flujo clínico requiere seleccionar/validar el sistema clínico y no se convierte en expediente oficial por añadir esta API. No hay integración con Doctoralia, recetas, firma, CFDI ni pagos reales.

Para producción, separar `MIGRATION_USER`/`MIGRATION_PASSWORD` del usuario de ejecución y conceder a este último permisos mínimos de lectura, inserción y actualizaciones necesarias, sin DDL ni DELETE/TRUNCATE. La migración inicial está incluida; la provisión de roles de base, el hosting privado y los respaldos son tareas pendientes.

Fuentes técnicas: [Spring Boot 4.0](https://docs.spring.io/spring-boot/4.0/system-requirements.html), [Spring Security JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html), [PostgreSQL: bloqueos explícitos](https://www.postgresql.org/docs/17/explicit-locking.html).
