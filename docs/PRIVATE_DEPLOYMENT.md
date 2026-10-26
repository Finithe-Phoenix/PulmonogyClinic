# Preparación del despliegue privado: roles y controles

## Estado y frontera

Estos archivos preparan un contrato de permisos PostgreSQL y un ensayo independiente. **No despliegan producción, no configuran infraestructura contratada y no autorizan datos clínicos reales.** `infra/dev` continúa siendo desarrollo sintético; no trasladar sus contraseñas, usuarios ni configuración Keycloak a producción. Ver [despliegue general](DEPLOYMENT.md), [restauración sintética](BACKUP_RESTORE.md) y [preparación clínica](CLINICAL_READINESS.md).

El ensayo nuevo debe ejecutarse y aprobarse explícitamente. No está incluido en la suite API normal de clases `*Test`: su nombre es `DatabasePrivilegesRehearsal` y solo se selecciona mediante `-Dtest=DatabasePrivilegesRehearsal`. No hay saltos silenciosos por falta de entorno; una invocación explícita sin `ROLE_TEST_ISOLATED=true` falla antes de conectarse. Una suite normal aprobada no demuestra la separación de roles.

### Resultado ejecutado el 28 de septiembre de 2026

El ensayo aislado con PostgreSQL 17.11, Maven 3.9.11 y Java 21 aprobó **7/7 casos, 0 fallos, 0 errores y 0 omitidos**, con salida Maven `0` y duración de 35.932 s en el segundo intento. Se aplicaron las cinco migraciones V1..V5 como propietario y se verificaron operaciones HTTP reales de todos los módulos como el login runtime limitado, sin bean Flyway. Esto demuestra el contrato sintético ensayado, no un despliegue productivo.

El primer intento terminó con salida `1`: seis casos aprobados y una prueba negativa intentó asignar `audit_event.id`, que es `GENERATED ALWAYS`. PostgreSQL devolvió `428C9` antes de comprobar el permiso esperado `42501`. Se corrigió únicamente la consulta de prueba para asignar la columna protegida ordinaria `command_id`; **no se ampliaron permisos ni se relajó la exigencia de denegación**. El segundo intento aprobó todas las denegaciones.

Se conservaron ambos reportes y sus códigos en `.local/role-rehearsal/pulmonogy-roles-3ad60d929376403c96097fa9c8959cab/evidence.json`, junto a `attempt-1/surefire-reports` y `attempt-2/surefire-reports`. Se retiraron los dos contenedores, dos redes y dos volúmenes propios después de verificar sus nombres, labels de proyecto y ausencia de miembros de red ajenos; salida de limpieza `0`. La base sintética y la caché temporal eliminadas no son recuperables; los reportes permanecen. No se conectó ni se modificó ninguna base de desarrollo, identidad o pruebas existente.

## Identidades separadas

| Identidad | Autoridad | Disponibilidad |
| --- | --- | --- |
| Administrador de plataforma | Provisionar base y roles; gestionar backups, certificados y llaves | Operación supervisada; nunca en la API |
| Migrador/propietario | Propietario de base, esquema `public` y objetos; ejecutar y validar Flyway | Solo trabajo de despliegue/actualización autorizado |
| Runtime de API | `CONNECT`, `USAGE` del esquema; `SELECT/INSERT` de las 17 tablas funcionales; `UPDATE` de columnas específicas; `USAGE` de la secuencia de auditoría | Proceso normal con `FLYWAY_ENABLED=false` |

El runtime debe ser un login `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, sin pertenencia a otros roles y sin objetos propios. No recibe privilegios de otorgamiento. No puede crear objetos persistentes o temporales, alterar/eliminar tablas, borrar/truncar filas, modificar historial, reiniciar secuencias, asumir al propietario ni leer/escribir `flyway_schema_history`. Las funciones propias del esquema no tienen `EXECUTE` público; los triggers existentes siguen protegiendo el historial y son instalados por el propietario.

El migrador de referencia es también propietario; por eso conserva autoridad DDL y privilegios sobre sus objetos. Esta separación protege frente al uso indebido de la cuenta **runtime**, no frente a un administrador/propietario comprometido. Tampoco añade RLS, aislamiento por consultorio o inmutabilidad frente al superusuario. El runtime puede insertar nuevos eventos porque lo exige el servicio; la auditoría no es un registro externo inviolable.

## Matriz de actualizaciones permitidas

La política [database-access.sql](../infra/prod/database-access.sql) parte del SQL actual de los servicios V1..V5. No cambia las migraciones existentes.

| Tabla | Columnas con `UPDATE` |
| --- | --- |
| `inventory_command` | `result` |
| `inventory_lot` | `quantity`, `quarantined` |
| `purchase_order` | `cancelled`, `cancellation_reason` |
| `purchase_line` | `received` |
| `operation_patient` | `reference`, `full_name`, `normalized_name`, `birth_date`, `phone`, `email`, `version`, `updated_at` |
| `operation_appointment` | `starts_at`, `ends_at`, `duration_minutes`, `service`, `practitioner`, `resource`, `source`, `external_reference`, `status`, `cancellation_reason`, `version`, `updated_at` |
| `cash_shift` | `closing_command_id`, `closed_by`, `closed_at`, `counted_cash_cents`, `expected_cash_cents`, `closure_reason` |
| `equipment_asset` | `status`, `version`, `updated_at` |

No hay `UPDATE` sobre `inventory_movement`, `audit_event`, `purchase_receipt`, `operation_appointment_event`, `cash_payment`, `cash_reversal` ni `equipment_maintenance`. Catálogo de productos y proveedores tampoco requiere edición en el servicio actual. No hay `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN` de tablas para runtime; `audit_event_id_seq` concede únicamente `USAGE`, no `SELECT/UPDATE` ni `setval`.

Los bloqueos actuales `SELECT FOR UPDATE` recaen en lotes, órdenes, pacientes, citas, turnos y equipos, que sí tienen alguna columna actualizable. Caja lee el pago original sin bloquearlo y serializa cobro/reverso/cierre mediante el turno. No se agrega `UPDATE` al historial para permitir bloqueos: PostgreSQL requiere permiso de actualización de al menos una columna para usar estas cláusulas. Si cambia ese diseño, deben revisarse conjuntamente consultas, permisos y pruebas de concurrencia.

La política revoca permisos previos de tabla **y también de columna**, evitando que un permiso antiguo quede vigente al reaplicarla. Retira accesos de `PUBLIC` y defaults de tablas/secuencias/funciones; las tablas nuevas de futuras migraciones no se exponen automáticamente al runtime. Un cambio de esquema requiere una revisión explícita de esta matriz.

## Aplicación futura en infraestructura aprobada

No ejecutar este procedimiento contra `clinic_dev`, `clinic_test` ni una base compartida con otros sistemas. Revocar permisos de `PUBLIC` afecta a todas las conexiones de la base elegida. La política requiere una base dedicada, esquema `public` explícitamente propiedad del migrador y objetos propiedad de ese mismo rol; aborta ante un runtime privilegiado, miembro de otros roles, propietario de objetos o un destino/usuario incorrecto.

1. El responsable de infraestructura provisiona una base dedicada y los dos logins diferenciados, con contraseñas generadas y custodiadas fuera del repositorio. Asigna base y esquema al migrador. El proveedor debe permitir este modelo; si impone otros propietarios o esquemas, adaptar y revisar el contrato antes de aplicarlo.
2. Ejecuta Flyway con credencial de migración mediante un job protegido. No montar esa credencial en el proceso que atiende peticiones. `clean` permanece desactivado. Revisar versión/checksum de migraciones y conservar evidencia antes de avanzar.
3. Desde la sesión del migrador, contra la base ya migrada, ejecutar el archivo de política con nombres explícitos y `ON_ERROR_STOP`. Ejemplo **no runnable** hasta reemplazar nombres y configurar un servicio PostgreSQL aprobado sin contraseña en la línea de comandos:

```text
psql service=REPLACE_APPROVED_MIGRATION_SERVICE -X -v ON_ERROR_STOP=1 \
  -v database_name=REPLACE_DATABASE \
  -v migration_role=REPLACE_MIGRATION_ROLE \
  -v application_role=REPLACE_RUNTIME_ROLE \
  -f infra/prod/database-access.sql
```

4. Validar accesos positivos y denegaciones como el login runtime real, no como un superusuario que solo cambia de nombre. Para una nueva versión, ensayar previamente con una copia autorizada y aislada.
5. Arrancar la API con la [plantilla runtime](../infra/prod/runtime.env.example) completada a través del gestor de secretos: `FLYWAY_ENABLED=false`, usuario limitado y conexión PostgreSQL con `sslmode=verify-full`/CA aprobada. No incluir `MIGRATION_USER`, `MIGRATION_PASSWORD` ni credenciales de propietario. La plantilla contiene solo placeholders deliberadamente inválidos.

`application.yml` conserva `FLYWAY_ENABLED=true` por defecto para no alterar desarrollo ni las pruebas existentes. **Ese default no es una configuración productiva segura**: el despliegue privado debe establecer explícitamente `false`. La variable también permite arrancar una API sin permisos sobre Flyway después de migrar por separado. Mantener HTTPS y MFA sigue siendo responsabilidad del despliegue, no de este interruptor.

## Ensayo aislado reproducible

El runner [compose.roles-test.yaml](../infra/prod/compose.roles-test.yaml) no es un Compose productivo. Crea su propio PostgreSQL 17 en tmpfs, sin puertos publicados ni volúmenes existentes. Maven usa una caché y un `target` nuevos del proyecto Docker del ensayo; el backend y la política se montan de solo lectura. La red PostgreSQL es interna; el contenedor Maven dispone de una segunda red solo para descargar dependencias. No comparte red ni datos con `infra/dev`.

El administrador `roles_test_admin` existe solo en ese contenedor. Java exige el nombre de bootstrap `clinic_roles_fixture`, genera una base y dos roles con UUID, aplica Flyway como propietario y usa la política SQL original. Cada caso prepara filas sintéticas, limpiando **solo esa base UUID** como propietario y luego sembrando como runtime. No usa `TEST_DB_*`, no altera los usuarios de la suite API ni trunca bases existentes.

Preparación desde la raíz del proyecto en PowerShell, una vez libres los recursos de las otras suites. Estas instrucciones no han de ejecutarse por inercia durante operación productiva:

```powershell
$taskRoleProject = 'pulmonogy-roles-' + [Guid]::NewGuid().ToString('N')
$env:ROLE_TEST_ADMIN_PASSWORD = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
docker compose --project-name $taskRoleProject -f infra/prod/compose.roles-test.yaml up --pull never --abort-on-container-exit --exit-code-from roles-test
$taskRoleExit = $LASTEXITCODE
```

La contraseña efímera se pasa por entorno, no se imprime ni se escribe en el repositorio. Las imágenes PostgreSQL/Maven deben existir localmente (`--pull never`); Maven puede descargar dependencias a su caché exclusiva. No ejecutar `docker compose config` ni volcar el entorno porque expanden secretos. Conservar el código de salida; solo cero con siete casos aprobados y sin errores de teardown es aprobación de este ensayo.

Antes de retirar sus recursos, copiar los reportes sintéticos de Surefire y revisar que no incluyan datos sensibles. El directorio `target` es un volumen propio del ensayo, no el `backend/target` del workspace:

```powershell
$taskRoleEvidence = Join-Path (Get-Location) ('.local/role-rehearsal/' + $taskRoleProject)
New-Item -ItemType Directory -Path $taskRoleEvidence -Force | Out-Null
docker compose --project-name $taskRoleProject -f infra/prod/compose.roles-test.yaml cp roles-test:/app/target/surefire-reports $taskRoleEvidence
if ($LASTEXITCODE -ne 0) { throw 'No retirar recursos: falta copiar la evidencia' }
if ($taskRoleProject -notmatch '^pulmonogy-roles-[a-f0-9]{32}$') { throw 'Nombre de ensayo inesperado; no retirar recursos' }
docker compose --project-name $taskRoleProject -f infra/prod/compose.roles-test.yaml down --volumes
Remove-Item Env:\ROLE_TEST_ADMIN_PASSWORD
```

La retirada elimina únicamente contenedores, redes, caché y `target` de ese proyecto nuevo; no es recuperable salvo los reportes copiados. Nunca sustituir el nombre por un proyecto existente ni usar `prune`. Si se interrumpe Java, el contenedor completo sigue siendo el destino aislado de prueba; no adoptar ni borrar roles ajenos en otros servidores. No ejecutar comandos globales `DROP OWNED`, terminaciones forzadas ni limpiezas por comodines.

Los siete casos comprueban:

- Privilegios exactos de tablas/columnas y ausencia de acceso a Flyway.
- Login runtime real, lectura y bloqueos de filas de tablas mutables.
- Denegación SQLSTATE `42501` de borrados, truncados, edición del historial/columnas protegidas.
- Denegación de DDL, tablas temporales, escalamiento de rol y reinicio/lectura directa de secuencia.
- Validación/migración como propietario y ausencia de permisos automáticos en objetos nuevos.
- Revocación efectiva de permisos antiguos de tabla y columna al reaplicar el contrato.
- Arranque Spring Boot sin bean Flyway, usando solo credencial runtime, más HTTP autenticado real de inventario —entradas/salidas/cuarentena—, compras —recepción parcial/cancelación—, pacientes/agenda —edición/reprogramación/transiciones/historial—, caja —pagos/reverso/cierre—, equipos —estado/mantenimiento— y auditoría. JWT y JWKS son fixtures efímeros locales, no Keycloak de desarrollo.

Esto no sustituye las pruebas negativas RBAC ni de concurrencia existentes; evita dar por válida una política solo porque `has_table_privilege` devuelve lo esperado.

## HTTPS, identidad, registros y actualización

Antes de datos reales hacen falta aprobación técnica/operativa y evidencia del despliegue:

- HTTPS en portal e identidad, certificado válido y renovación comprobada; API solo detrás de ingress privado de confianza, sin publicar su puerto interno. HSTS después de comprobar todos los hosts/subdominios. Restringir cabeceras forwarded al proxy autorizado; no confiar ciegamente en entradas del cliente.
- TLS PostgreSQL verificado, segmentación de red y credenciales de runtime exclusivas por ambiente. Restringir mediante `pg_hba.conf` o el control equivalente del proveedor la combinación usuario/base/red del runtime: esta política solo modifica la base dedicada y no revoca accesos por `PUBLIC` en otras bases del clúster. Secretos fuera del workspace/OneDrive, repositorio, Pages, capturas y reportes. Rotación y revocación ensayadas.
- Identidad productiva separada, redirect URIs/origins exactos, registro público desactivado, usuarios nominativos y MFA requerido para accesos operativos/privilegiados. Ensayar enrolamiento, pérdida del segundo factor, baja de personal, cierre de sesiones y acceso de emergencia auditado. El JWT/RBAC existente no demuestra por sí solo que se exigió MFA.
- Logs operativos con identificador de correlación, ruta sin parámetros sensibles, resultado y tiempo; no registrar tokens, cookies, contraseñas, cuerpos, nombres, teléfonos ni contenido clínico. No habilitar depuración SQL/JWT/HTTP; revisar también proxy, APM, errores y trazas. Separar el historial de auditoría de negocio, definir acceso/retención y no exportarlo en bruto a soporte.
- Actualización: respaldo y restauración aprobados; imagen identificada por digest; ensayo en staging; revisión de nuevas migraciones y permisos; ventana de mantenimiento; job migrador con credencial temporal; política de permisos; runtime con Flyway apagado; smoke de todos los módulos/RBAC; revisión de alarmas y evidencia. No ejecutar `Flyway clean` ni asumir que una migración permite downgrade. Planear rollback de aplicación compatible o recuperación controlada antes de publicar.

Siguen pendientes la infraestructura/dominio/IdP productivos, gestión real de llaves y backups, monitorización/alertas, RPO/RTO, aceptación humana y los límites clínicos/legal-operativos. No se afirman certificaciones ni disponibilidad productiva con estas plantillas.

## Fuentes técnicas

El contrato sigue los [privilegios PostgreSQL 17](https://www.postgresql.org/docs/17/sql-grant.html), los [defaults de privilegios](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html) y los [requisitos de permisos de SELECT con bloqueos](https://www.postgresql.org/docs/17/sql-select.html). La habilitación independiente de Flyway corresponde a las [propiedades oficiales de Spring Boot](https://docs.spring.io/spring-boot/appendix/application-properties/index.html).
