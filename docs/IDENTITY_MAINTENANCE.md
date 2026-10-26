# Conservación y mantenimiento de la identidad local

## Ejecución local verificada · 28/09/2026

La migración descrita se ejecutó con `--apply` en esta máquina. El manifest privado de la ejecución `2026-09-28T16-19-19-413Z-3af40c` confirmó `completed`, `preservationVerified` y retiro del cliente temporal. Se preservaron cuatro usuarios, credenciales, IDs, clientes y claves públicas; el volumen nuevo es persistente. El archivo de respaldo y los exports sensibles permanecen en `.local`, excluidos de Git y sin publicar.

Las dos pruebas `identity.spec.ts` pasaron con el tema español: escritorio incluyó 360/390/768/1280/1440 px y móvil 390 px, sin desbordamiento ni infracciones automáticas de las reglas axe seleccionadas; teclado, mostrar/ocultar contraseña, error genérico y acceso real con cuenta existente. Se inspeccionaron las capturas vacías de 1440 y 360 px. Esto no acredita MFA ni identidad productiva.

La guarda de `dev:private` también rechaza un bloqueo de mantenimiento o un manifest incompleto antes de abrir el volumen; no basta con que exista un montaje. No repetir esta migración inicial sobre el volumen ya migrado.

## Procedimiento conservado

Estado al preparar este procedimiento: el contenedor `pulmonogy-private-dev-identity-1` usa Keycloak 26.7.4, UID 1000 y una base H2 en su capa escribible. La inspección de sus montajes mostró únicamente el JSON de importación; no había volumen de datos. Recrearlo directamente con el Compose nuevo perdería ese estado. Se inspeccionaron nombres de variables, no sus valores; no había variables de bootstrap administrativo.

El script `scripts/configure-identity.mjs` está preparado para **esa migración inicial**. Su implementación no demuestra que ya se haya ejecutado. Por defecto solo inspecciona Docker/Compose, archivos y endpoints públicos. No inicia contenedores auxiliares durante el dry run. Requiere Docker accesible, la imagen exacta de Keycloak ya presente, `node:24.16.0-alpine` ya presente y `.local/private.env` existente.

```powershell
node scripts/configure-identity.mjs --dry-run
# Ejecutar solo al coordinar la breve ventana de mantenimiento local:
node scripts/configure-identity.mjs --apply
```

`npm run dev:private` ahora inspecciona únicamente los montajes del contenedor antes de su `compose up`. Rechaza una identidad existente sin el volumen previsto y señala este procedimiento, evitando recrear la H2 anterior. También bloquea el arranque si el contenedor usa un volumen distinto (posible recuperación), si existe el volumen destino sin contenedor (posible migración incompleta) o si Docker no permite comprobar su estado. Una instalación realmente nueva, sin contenedor ni volumen, puede arrancar normalmente. El uso directo de `docker compose up` sigue eludiendo esa guarda: no hacerlo antes de migrar.

El resto de servicios permanece independiente. El mantenimiento incluye dos paradas: respaldo inicial y exportación final consistente. Las sesiones del navegador pueden requerir iniciar sesión otra vez; se conservan usuarios, sus IDs, credenciales, clientes y claves de firma.

## Qué se aplica

1. Verificar una única instancia, imagen y UID previstos, ausencia de configuración de BD no contemplada y ausencia total del volumen de destino. Capturar la huella de las claves públicas del realm existente.
2. Adquirir un bloqueo local y parar la identidad limpiamente. Se rechaza OOM o terminación forzada. Copiar `/opt/keycloak/data/h2` mediante `docker cp` a `.local/identity-backups/<timestamp-aleatorio>/h2` y registrar tamaños/SHA-256. El script no borra respaldos.
3. Crear exclusivamente el volumen **nuevo** `pulmonogy-private-dev-identity-data`, etiquetado con el ID de esta ejecución. Un auxiliar Node sin red copia los archivos a un destino vacío, compara hashes y asigna UID 1000. `volume-nocopy` evita poblar el volumen con archivos de imagen. No se abre ningún volumen preexistente para reemplazarlo.
4. Ejecutar la exportación oficial offline en el volumen nuevo, conservando todos los realms en el respaldo privado. Confirmar que `clinic-dev` tiene ID, cliente `clinic-portal` y los cuatro usuarios aplicativos previstos con credenciales. No se importa este JSON ni se usa overwrite.
5. Ejecutar `bootstrap-admin service --client-id <nombre-aleatorio> --client-secret:env CLINIC_MAINTENANCE_SECRET --no-prompt --db=dev-file`, con todos los lectores/escritores del volumen detenidos. La contraseña aleatoria entra por stdin a un wrapper que la exporta exclusivamente al proceso: no aparece en argv, en `Config.Env` de Docker, en un archivo de entorno ni en logs. El contenedor auxiliar usa `--log-driver none` y se elimina al finalizar. Como cualquier credencial de un proceso activo, es visible a un administrador del host con capacidad de inspeccionar memoria/procesos.
6. Arrancar el servicio con volumen persistente y tema montado. Una pequeña configuración Compose privada fija el digest de imagen existente, sin actualizar Keycloak. `--import-realm` omite el realm ya existente. Verificar mismas claves públicas y mismo ID antes de modificar configuración.
7. Obtener un token `client_credentials` en memoria y enviar solo cuatro propiedades a `PUT /admin/realms/clinic-dev`: `loginTheme`, `internationalizationEnabled`, `supportedLocales`, `defaultLocale`. Leer el rol MEDICO y crearlo únicamente ante 404. No se asigna a nadie ni se cambian usuarios, passwords, clientes del portal, permisos existentes o flujos.
8. Verificar configuración, eliminar el cliente temporal por su UUID exacto y comprobar que ya no obtiene token (`invalid_client`). No se registran cuerpos REST sensibles.
9. Parar de nuevo, exportar todos los realms y comparar su contenido canónico con la línea base: solo se admiten los cuatro campos y la adición de MEDICO. Si MEDICO ya existía, también debe permanecer idéntico. Se comprueban usuarios, credenciales, clientes, roles existentes, claves y demás configuración. También se comprueba que cliente y usuario de servicio temporal ya no estén en master y que el backup H2 original conserve sus hashes.
10. Arrancar y comprobar otra vez las claves públicas. Solo entonces el manifest indica `completed: true` y `preservationVerified: true`.

El algoritmo canónico ordena claves de objetos y contenido de arrays para neutralizar orden de exportación. Verifica igualdad de los elementos, no que un export mantenga exactamente el orden textual. Los campos de orden explícitos que Keycloak exporta, como prioridades de ejecuciones, siguen formando parte de la comparación.

## Respaldo y evidencia privada

El directorio generado contiene `h2/`, `before.json`, `after.json`, `manifest.json` y el override de imagen. Las exportaciones offline y H2 contienen **credenciales cifradas/hasheadas, secretos de clientes y claves privadas**. `.local` está excluido de Git; no publicar, adjuntar a tickets ni imprimir estos archivos. El script restringe permisos de directorio; en Windows aplica ACL al usuario actual y SYSTEM antes de copiar. La ubicación está bajo el workspace del usuario: debe gestionarse con las políticas de protección y sincronización que ese equipo use para `.local`.

El manifest incluye estado de cada fase, hashes, imagen, identidad de realm, número de usuarios y resultado de limpieza; no guarda la contraseña temporal ni el token. Un manifest parcial o la existencia de archivos no prueban una ejecución completada.

## Fallos, repetición y rollback

La migración falla antes de detener servicios si el destino ya existe o la identidad ya monta datos. Esto evita que reintentar a ciegas sobrescriba un avance o una base operativa. Una actualización futura de tema sobre un volumen existente requiere un mantenimiento explícito distinto; no se recicla esta migración inicial.

Si falla **antes** de recrear la identidad, se intenta arrancar el contenedor original, cuya capa H2 no se modificó. El volumen preparado se conserva para inspección. Si falla **después**, se intenta limpiar el cliente temporal y se detiene la identidad nueva: el operador debe revisar la causa y decidir entre corregirla o restaurar. Si el proceso se mata, falta energía o Docker queda inaccesible, no puede garantizarse esa limpieza; el manifest y el bloqueo permiten reconocerlo. No borrar un bloqueo hasta confirmar que el proceso terminó y que ningún contenedor auxiliar está abriendo H2.

La restauración debe conservar el volumen fallido y usar **otro volumen vacío**, nunca sobrescribir uno existente:

1. Confirmar que identity y todos los auxiliares del mantenimiento están detenidos. Verificar los SHA-256 del directorio `h2/` contra el manifest y la imagen exacta original.
2. Crear un nombre nuevo de recuperación, por ejemplo `pulmonogy-private-dev-identity-recovery-<timestamp>`, y copiar únicamente el backup H2 verificado a `h2/` del volumen nuevo con UID 1000. Puede reutilizarse el bloque de copia del script tras revisión, cambiando solo el volumen destino; no ejecutar un `import --override`.
3. Preparar un override Compose privado que asigne ese nombre al volumen lógico `identity-data` y la imagen original, manteniendo el mismo servicio/puerto/red. Revisar `docker compose --env-file .local/private.env -f infra/dev/compose.yaml -f <override> config` **sin imprimir valores de entorno**. Antes de arrancar, exportar offline la copia recuperada y comparar la línea base original.
4. Arrancar solo `identity` con ese override y verificar issuer, JWKS y acceso aplicativo. La copia recuperada conservará el tema anterior porque proviene del backup previo al mantenimiento.
5. Mantener el override como configuración activa de arranque hasta que el coordinador ajuste deliberadamente Compose al volumen recuperado. Ejecutar el comando genérico de desarrollo sin ese ajuste volvería a elegir el volumen anterior. Conservar ambas copias hasta terminar la validación.

El script no automatiza un rollback sobre un volumen ya usado: la selección de una copia posterior o anterior podría descartar escrituras hechas después del respaldo. Esta limitación es un bloqueo explícito, no una autorización para resetear usuarios o crear un realm sustituto.

## Validación visual y acceso

Después de `completed: true`, iniciar un flujo nuevo desde `http://localhost:4180`, no reutilizar una URL vencida de `login-actions`. Verificar idioma español, CSS del tema con 200, error genérico de credenciales, acceso con usuarios existentes y regreso al portal. Revisar 360/390/768/1280/1440 px, teclado, foco y mostrar contraseña. El script no sustituye estas pruebas de navegador.

## Fuentes oficiales consultadas

- [Bootstrap y recuperación administrativa, versión 26.7.4](https://github.com/keycloak/keycloak/blob/26.7.4/docs/guides/server/bootstrap-admin-recovery.adoc): el comando dedicado funciona sobre master existente; exige detener los nodos y retirar después la cuenta temporal.
- [Exportación/importación Keycloak](https://www.keycloak.org/server/importExport): exportación offline, export a archivo y omisión de realms ya presentes en el arranque.
- [Implementación del export a archivo 26.7.4](https://github.com/keycloak/keycloak/blob/26.7.4/model/storage-services/src/main/java/org/keycloak/exportimport/singlefile/SingleFileExportProvider.java): representación exportada completa de realms y usuarios.
- [Admin REST API 26.7.4](https://www.keycloak.org/docs-api/26.7.4/rest-api/index.html): cambios de propiedades del realm, consulta/alta de roles y eliminación de clientes por UUID.
- [Docker cp](https://docs.docker.com/reference/cli/docker/container/cp/): copia de archivos desde contenedores detenidos.
- [Volúmenes Docker](https://docs.docker.com/engine/storage/volumes/): persistencia independiente del contenedor, destino vacío y `volume-nocopy`.
