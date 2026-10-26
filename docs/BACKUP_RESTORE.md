# Ensayo sintético de respaldo y restauración

## Alcance y estado

Ensayo ejecutado el **28/09/2026**, resultado `PASS_SYNTHETIC_ONLY`, código 0: `.local/backup-restore/f3d9d146-a02e-4015-8a80-73082876dab4/evidence.json`. Se restauraron las 18 tablas y V1..V5, con coincidencia de conteos y huellas, relaciones sin huérfanos y las siete equivalencias de representación descritas abajo. Los tres contenedores exclusivos del ensayo fueron retirados; respaldo cifrado, clave y evidencia permanecen locales y no versionados.

El intento previo `61b3cd8a-46dd-4571-8cab-f13feade042d` sigue registrado como `FAILED`: detectó esas siete diferencias de representación de PostgreSQL. No se cambió retroactivamente su resultado ni se alteraron sus artefactos. La nueva ejecución usa el comparador acotado, no una omisión general de restricciones.

`scripts/verify-backup-restore.mjs` ensaya un respaldo lógico de PostgreSQL 17 y su restauración en **otra base nueva**. La única fuente admitida es un fixture que crea el propio script; no acepta direcciones, nombres de contenedores, credenciales, dumps externos ni bases existentes. No accede a `clinic_dev`, `clinic_test`, `test-db`, Keycloak ni los volúmenes de Compose.

El código preparado no equivale a una prueba ejecutada. Solo una ejecución que finalice con `PASS_SYNTHETIC_ONLY`, código 0 y todos los recursos retirados constituye evidencia de este ensayo. Tampoco ese resultado acredita recuperación productiva ni cierra REC-01 del [backlog](BACKLOG.md). No incluye datos clínicos reales, roles globales, ACL de producción, identidad, archivos adjuntos, copias externas, retención, recuperación puntual WAL/PITR ni un RPO/RTO comprometido. Consultar también [despliegue](DEPLOYMENT.md).

## Antes de ejecutar

- Node.js 24 y Git accesibles; Docker Desktop con contenedores Linux.
- Las imágenes locales `postgres:17` y `pulmonogy-private-dev-api` deben existir. La API debe estar construida con las migraciones actuales V1..V5. El ensayo no descarga imágenes ni construye/reinicia servicios.
- Memoria libre para dos PostgreSQL pequeños y un migrador temporal; los límites son 512 MiB por PostgreSQL y 768 MiB para el migrador. Los datos de cada PostgreSQL viven en tmpfs de 256 MiB.
- Ejecutar desde un equipo y una copia del repositorio confiables. Docker equivale a privilegios elevados; estas medidas no aíslan de un administrador del host.
- `.local/` debe estar ignorado por Git y no ser un enlace/redirección. El script verifica la exclusión. En Windows restringe la carpeta nueva al SID del usuario y SYSTEM; en otros sistemas usa modo 0700 y archivos 0600. No modifica permisos de las carpetas existentes.
- Cerrar previamente cualquier ensayo interrumpido tras revisar sus IDs y etiquetas. No es necesario parar el portal; aun así, coordinar la ejecución para no competir por memoria con las suites.

## Uso deliberado

Plan de solo lectura: no contacta Docker, no crea carpetas, no genera credenciales ni modifica datos:

```powershell
node scripts/verify-backup-restore.mjs
```

Ejecutar el ensayo aislado:

```powershell
node scripts/verify-backup-restore.mjs --apply
```

`--help` muestra el mismo plan sin ejecutarlo. Cualquier argumento desconocido se rechaza. Cada invocación genera un UUID nuevo: el plan es una descripción del alcance, no una reserva reutilizable de nombres.

## Qué se verifica

1. Crea `pulmonogy-backup-<UUID>-source`, sin puertos publicados y con `--network none`. Su almacenamiento es tmpfs; no monta datos del proyecto ni usa un volumen existente.
2. Crea `pulmonogy-backup-<UUID>-migrate` con el ID inmutable de la imagen API local. Solo comparte la red aislada del contenedor fuente, usando su loopback. La API aplica Flyway real; no se fabrica `flyway_schema_history`. Las direcciones OIDC apuntan a un puerto local sin servicio; no se hacen logins ni llamadas a la identidad existente. El migrador se retira antes de sembrar datos.
3. Compara versiones, nombres, estado y CRC32 Flyway con los cinco archivos SQL locales. Si la imagen está desactualizada, aborta. La evidencia incluye también SHA-256 de esos archivos.
4. Siembra datos marcados como sintéticos que cubren las 18 tablas: inventario con entrada y salida; compra parcialmente recibida; paciente administrativo sin teléfono/correo; cita y evento; caja con pago en centavos, segundo método, reverso y cierre con diferencia; equipo y mantenimiento; comandos y auditoría.
5. Retira escritores, configura la base fuente para nuevas transacciones de solo lectura y exige cero otros clientes. Mantiene abierta una transacción `REPEATABLE READ READ ONLY` con `pg_export_snapshot()`. El manifest de origen y `pg_dump --snapshot` leen exactamente ese snapshot. No compara conteos de una base que sigue cambiando. Las secuencias no tienen semántica MVCC; aquí permanecen estables porque el fixture no tiene escritores.
6. Cifra el archivo custom de `pg_dump` con AES-256-GCM. El dump sin cifrar solo pasa por memoria/stdin. Conserva archivo, clave y evidencia dentro de la carpeta privada de esta ejecución.
7. Crea `pulmonogy-backup-<UUID>-restore`, también sin red, puertos ni volúmenes compartidos. Comprueba que no haya tablas antes de restaurar. Relee y autentica el archivo cifrado desde disco; ejecuta `pg_restore --single-transaction --exit-on-error`, **sin `--clean`, `--create` ni borrado de bases**.
8. Compara exactamente todas las tablas, conteos y SHA-256 de filas JSONB canónicas; columnas, restricciones validadas, índices, funciones y triggers activos; relaciones FK —incluidas compuestas— sin huérfanos; estado de secuencia de auditoría; e historial Flyway. La huella de datos incluye también todos los campos de `flyway_schema_history`. Única equivalencia de representación admitida: en las siete restricciones de enumeración conocidas, PostgreSQL 17 puede reconstruir el cast de un arreglo `varchar[]` a `text[]` como casts `varchar` a `text` por elemento. Se reconocen solamente esas dos expresiones completas con los mismos literales en el mismo orden, columna y operador; no se eliminan casts genéricamente ni se normalizan otras reglas. Los manifests crudos se conservan y la evidencia enumera cada equivalencia aceptada en `constraintRepresentationDifferences`, además de `rawMismatchedSections` y las diferencias reales en `mismatchedSections`.
9. Retira únicamente los contenedores creados por esa ejecución, por ID completo, después de comprobar nombre, etiqueta UUID, red y ausencia de montajes ajenos/puertos. Nunca utiliza `compose down`, `prune`, nombres de servicios existentes ni una lista global de contenedores. No borra respaldos ni claves.

La fuente es pequeña por diseño; el límite de salida es 32 MiB. Es un ensayo de preservación y relaciones, no una prueba de carga ni una validación completa de reglas clínicas o financieras. Las restricciones y triggers se comparan estructuralmente; los permisos de aplicación se validan en las suites de API/portal, no en este ensayo.

## Evidencia y custodia

Cada ejecución deliberada conserva en `.local/backup-restore/<UUID>/`:

| Archivo | Contenido | Compartir |
| --- | --- | --- |
| `evidence.json` | Estado, etapas, tiempos, IDs de imágenes/contenedores, snapshot, conteos y huellas, metadatos de esquema/Flyway y verificaciones | Revisar antes; no contiene credenciales ni valores de pacientes |
| `synthetic.dump.enc` | Archivo PostgreSQL custom cifrado y autenticado | Solo dentro del procedimiento autorizado |
| `backup.key` | Clave binaria AES de 256 bits | **No compartir, subir ni adjuntar al respaldo externo** |
| `source.env`, `restore.env`, `migrate.env` | Contraseña aleatoria exclusiva de estas bases efímeras | **No compartir** |

Las contraseñas existentes no se leen; las nuevas nunca se pasan como texto en argumentos de proceso ni se imprimen. Los procesos Docker reciben sus env files privados. Un administrador de Docker puede inspeccionar variables de sus contenedores mientras existen. La evidencia y la consola omiten stdout/stderr crudos de las herramientas para evitar filtraciones.

El cifrado usa un encabezado `PULMONOGY-BACKUP-V1\n`, nonce de 12 bytes, tag GCM de 16 bytes y ciphertext. La clave se guarda separada del archivo, pero **en el mismo equipo**: eso no constituye gestión productiva de llaves ni protección frente al compromiso del host. No hay promesa de borrado seguro de memoria. `.gitignore` tampoco evita sincronización de OneDrive; esta ubicación solo admite datos sintéticos. Una estrategia productiva necesita almacenamiento aprobado fuera del workspace sincronizado y custodia independiente de llaves.

No publicar estos artefactos en Pages ni adjuntarlos automáticamente a CI. No insertar datos reales en el fixture.

## Si falla o se interrumpe

El proceso marca `FAILED` con la etapa fallida e intenta retirar solo sus recursos verificados, conservando cualquier respaldo ya creado. Si la retirada falla, marca `FAILED_CLEANUP` y devuelve código distinto de cero. Si el proceso o el host mueren bruscamente puede quedar `PREPARING` o `VERIFIED_PENDING_CLEANUP` y contenedores vivos: **no interpretar esos estados como aprobación**. El manifest se reemplaza mediante un archivo intermedio para evitar JSON parcial; la recuperación tras pérdida abrupta de energía no está certificada.

Revisar los IDs completos y nombres de `evidence.json`. Para cada recurso residual, inspeccionar manualmente su etiqueta `mx.pulmonogy.backup-rehearsal`, que debe coincidir con el UUID, su nombre y sus montajes. No ejecutar borrados con comodines ni contra `pulmonogy-private-dev-*`. La herramienta no reanuda ni adopta recursos de otra ejecución. Si se requiere retirada manual, debe limitarse al ID inspeccionado del ensayo; sus bases son sintéticas y efímeras, mientras los archivos de respaldo permanecen en `.local`.

Los diagnósticos crudos se omiten deliberadamente: comprobar etapa, imágenes/migraciones actuales, espacio/memoria, permisos de carpeta y Docker. No pegar env files, claves ni dumps en una tarea. Corregir la causa y lanzar un ensayo nuevo deja evidencia independiente.

## Frontera para REC-01 y producción

Faltan el diseño y autorización del origen productivo, usuarios de respaldo de mínimo privilegio, manejo seguro de credenciales, copias cifradas externas con llaves separadas, políticas de retención e inmutabilidad, alarmas, RPO/RTO medidos con volumen real, recuperación de roles/identidad/archivos, continuidad de operación y una restauración supervisada en infraestructura aprobada. Este script no puede apuntarse a producción mediante una bandera; ese procedimiento debe diseñarse y revisarse por separado.

## Referencias técnicas

El archivo custom y la reutilización de snapshot siguen [pg_dump de PostgreSQL 17](https://www.postgresql.org/docs/17/app-pgdump.html); la restauración transaccional sigue [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html). La sesión compartida se basa en [sincronización de snapshots](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION). CRC32 sigue el [calculador oficial de Flyway](https://github.com/flyway/flyway/blob/main/flyway-core/src/main/java/org/flywaydb/core/internal/resolver/ChecksumCalculator.java), y la red/almacenamiento aislados usan [opciones oficiales de Docker](https://docs.docker.com/engine/containers/run/).

[`pg_get_constraintdef`](https://www.postgresql.org/docs/17/functions-info.html) devuelve una reconstrucción decompilada, no el texto original de creación. Por eso las dos representaciones acotadas de arrays se comparan sin borrar sus diferencias del registro de evidencia.
