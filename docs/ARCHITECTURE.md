# Arquitectura y límites

## Tres superficies separadas

| Superficie | Código / salida | Datos y despliegue |
| --- | --- | --- |
| Sitio y demo | src/main.ts, src/app; dist/clinic/browser | Sitio propuesto y ejemplos en localStorage; solo esta salida se publica en Pages |
| Portal privado | src/portal-main.ts, src/app/portal; dist/portal/browser | Aplicación por rutas con API real, compilación independiente; servicio local4180 |
| API e identidad | backend; infra/dev | SpringBoot/PostgreSQL en8181 y Keycloak en8180, loopback; no producción |

El gateway local sirve la compilación privada y reenvía únicamente Bearer y cabeceras permitidas a /api/. No comparte cookies con la API ni convierte Pages en una aplicación privada. El repositorio, las capturas publicables y la demo no admiten información real.

## Frontend y diseño

Angular21.2.24, TypeScript5.9.3 y Node24; dependencias exactas y lockfile. El portal usa rutas lazy por módulo, componentes standalone, signals y formularios ajustados a su complejidad. Paper & Ink define tokens primitivos, semánticos y de componente. [Sistema visual](DESIGN_SYSTEM.md).

DataPage consulta páginas acotadas y descarta respuestas de consultas/identidades anteriores. Buscar la misma expresión permite reintentar un error. Las cifras de una página no se presentan como totales generales. El usuario solicita Actualizar para cambios de otras sesiones; no hay sincronización push.

Los CSV privados proyectan columnas permitidas de la página visible, con contador y nombre parcial. Usan BOM UTF-8, escape de celdas y neutralización explícita de prefijos interpretables como fórmulas. No exportan expedientes ni descargan páginas adicionales silenciosamente.

## Identidad, sesión y recuperación

Keycloak26.7.4 de desarrollo, Authorization Code + PKCE S256 y cliente público con retornos exactos. Los JWT se verifican en servidor (firma, emisor, audiencia, sujeto y vigencia). Roles: ADMIN, RECEPCION, FARMACIA, MEDICO y AUDITOR. Ocultar enlaces no constituye autorización.

Tokens solo en memoria; el estado transitorio OIDC y las solicitudes ya enviadas de resultado incierto se guardan en sessionStorage. Cada pendiente pertenece a un sujeto y mantiene UUID/cuerpo para reintentar exactamente la misma operación. La identidad de desarrollo usa un volumen persistente tras [mantenimiento verificado](IDENTITY_MAINTENANCE.md); no quedó un cliente administrativo temporal.

La [recuperación de sesión](SESSION_RECOVERY.md) intenta renovación antes de vencer. Ante fallo/401 bloquea la red y oculta el espacio, preservando formularios sin enviar solamente en memoria. El acceso explícito PKCE en popup recupera la misma identidad/roles; un cambio desmonta el contexto anterior. No se reenvían operaciones automáticamente. Su estado de validación se consulta en [VALIDATION](VALIDATION.md). Recargar/cerrar descarta borradores; las solicitudes inciertas tienen una política distinta y deben conciliarse.

## Servidor y consistencia

Java21, SpringBoot4.0.8, PostgreSQL17 y FlywayV1..V5. V1/V2 se conservan; V3 añade pacientes/agenda, V4 caja y V5 equipos. La base clinic_dev es persistente; clinic_test es exclusiva y desechable. Las pruebas que truncan tablas nunca apuntan al entorno operativo.

| Módulo | Invariantes implementadas |
| --- | --- |
| Inventario | Alta sin stock inventado; bloqueo de lote, disponibilidad/caducidad/cuarentena; movimiento/saldo/auditoría atómicos; historia protegida |
| Compras | Producto/unidad/costo histórico por partida; bloqueo orden→lote; recepción parcial sin sobreentrega; cancelación conserva lo recibido |
| Pacientes | Identificador propio, búsqueda/homónimos, confirmación de duplicados sin fusión automática, versión optimista; bandera synthetic obligatoria |
| Agenda | Hora México, estados/transiciones, conflicto de paciente/profesional/recurso, historial, versión; Doctoralia solo referencia manual |
| Caja | Un turno abierto, centavos enteros, folios únicos, cobro/reverso inmutable, cierre consistente concurrente; referencia operativa manual, no contabilidad/CFDI |
| Equipos | Activo distinto de consumible; estado/versiones, mantenimiento y próxima intervención; referencia normalizada enlaza disponibilidad con agenda |
| Auditoría | Actor derivado de JWT y registro transaccional; historial sin UPDATE/DELETE ordinarios |

Las escrituras usan claves de idempotencia y transacciones. Repetir la misma clave/cuerpo devuelve el resultado original; cambiar el contenido es conflicto. Las restricciones y locks de PostgreSQL protegen concurrencia, no el estado del navegador. Un propietario/administrador DDL de la base puede alterar triggers: esto no es inmutabilidad criptográfica.

Contratos: [inventario/API](../backend/README.md), [compras](../backend/docs/PURCHASING_API.md), [operaciones](../backend/docs/OPERATIONS_API.md), [caja](../backend/docs/CASH_API.md), [equipos](../backend/docs/EQUIPMENT_API.md), [búsquedas](../backend/docs/SEARCH_API.md).

## Recuperación y fronteras productivas

El [ensayo de respaldo](BACKUP_RESTORE.md) crea fuente/destino sintéticos propios, aplica Flyway, cifra pg_dump y restaura desde disco. Compara 18 tablas, huellas, esquema, relaciones, secuencia e historial. No accede a bases existentes y retira únicamente sus recursos. El resultado aprobado no cubre identidad, adjuntos, copias externas, retención, custodia independiente ni RPO/RTO de producción.

Siguen pendientes configuración y aprobación productivas: HTTPS, MFA, ciclo de personal, mínimos de BD separados del migrador, observabilidad, hosting/dominio/costos, recuperación integral y piloto supervisado. No desplegar infra/dev como producción.

## Expediente y dependencias externas

La [revisión clínica](CLINICAL_READINESS.md) documenta fuentes oficiales mexicanas y arquitectura propuesta para borradores, firma aplicable, cierre/adendas, acceso, retención y exportación. No implementa certificación, firma médica válida ni expediente oficial. Las notas de demo no son documentos clínicos.

Decisión del titular (28/09/2026): el portal es la agenda principal y Doctoralia solo un canal de exposición/captación, sin función clínica. Los contactos recibidos allí se registran manualmente tras confirmar aquí su disponibilidad; no existe conector Doctoralia/Docplanner. El enlace público remite al perfil profesional, no promete reservas ni sincronización. No se automatizan diagnósticos, prescripciones ni pagos. La marca/contenido del sitio requieren aprobación. [Backlog y decisiones por dependencia](BACKLOG.md).
