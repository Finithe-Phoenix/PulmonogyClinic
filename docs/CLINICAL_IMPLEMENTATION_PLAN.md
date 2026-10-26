# Plan técnico del expediente propio · V7

**Pendiente de implementación y validación.** Diseño del 28/09/2026, `America/Mexico_City`. Este documento es la única entrega de esta tarea: no añade tablas, endpoints ni pantallas. V6 está reservada para vínculos de caja; V7 será una migración nueva, sin modificar V1–V6.

Construir una vertical privada exclusivamente sintética, con documentos de autor médico, revisiones, cierre técnico, adendas, lecturas/exportación auditadas y recuperación sin persistir contenido en el navegador. La decisión de expediente propio ya está confirmada en [PRODUCT_DECISIONS](PRODUCT_DECISIONS.md); no depende de Doctoralia ni de contratar un expediente externo. La agenda principal es el portal. Los cobros por cita o independientes no otorgan acceso clínico ni cierran documentos.

## Alcance

- **Dentro:** una nota narrativa ficticia con plantilla técnica `SYNTHETIC_NOTE_V1`; paciente administrativo existente; cita opcional; autoría exclusiva; borradores guardados explícitamente en servidor; historial de revisiones; cierre `CLOSED_TECHNICAL`; adendas propias; exportación JSON explícita de un original cerrado y sus adendas cerradas, sin descarga masiva.
- **Fuera:** datos reales, recetas/prescripciones válidas, recomendaciones automáticas, firma médica, certificados, adjuntos, FHIR/HL7, intercambio entre profesionales, acceso de emergencia, portal del paciente, resúmenes clínicos oficiales, proveedor de firma, PDF con apariencia de documento firmado, borrado/retención productivos. No se habilitará producción cambiando una casilla `synthetic`.
- **Límite clínico-jurídico:** este es un diseño de software sintético. Las fuentes y pendientes humanos están en [CLINICAL_READINESS](CLINICAL_READINESS.md); aquí no se hace una nueva comprobación normativa ni se declara cumplimiento. `CLOSED_TECHNICAL` no implementa los estados futuros de firma descritos allí.

## 1. Hechos comprobados en el código actual

| Punto inspeccionado | Consecuencia para V7 |
| --- | --- |
| `inventory/CommandService.execute` calcula una huella del input y guarda el objeto de respuesta completo en `inventory_command.result`; la clave es global y se verifica actor. | No pasar un documento clínico como resultado. Elegir un ledger clínico propio con columnas de confirmación mínimas, no reutilizar ese caché compartido. |
| `ClinicStore.submit` serializa `subject`, `path`, cuerpo y UUID en `sessionStorage`; `retry` usa ese pendiente administrativo. | Prohibir su uso para notas, adendas, cierres y exports. Crear un store clínico de memoria; no añadir contenido a los pendientes administrativos. |
| `ClinicStore.api.request` ya bloquea sesión vencida, captura credenciales por solicitud y descarta respuestas de un contexto anterior. | Reutilizar esa compuerta, sin copiar tokens ni llamar directamente a `fetch` desde clínica. Separar mecanismo de sesión de mecanismo de persistencia. |
| V3 exige `operation_patient.synthetic=true`. Las citas tienen `patient_id` FK; `practitioner` es texto libre, no identidad OIDC. | Validar paciente/cita en servidor. No equiparar `practitioner`, nombre del usuario o rol ADMIN con el autor clínico. |
| Los GET de `/operations/**` permiten ADMIN/RECEPCION/MEDICO/AUDITOR; no existe clínica privada. | Crear `/api/v1/clinical/**` separado, restringido a MEDICO y además al propietario en cada consulta. No introducir contenido en respuestas administrativas. |
| `audit_event` exige FK a `inventory_command` y se expone a ADMIN/AUDITOR. | Crear auditoría clínica separada. No insertar allí texto, motivos clínicos, nombres, identificadores de paciente/documento ni huellas de contenido. |
| El gateway admite GET/POST, máximo 64 KiB y `no-store`; solo reenvía Content-Type de respuesta. | Diseñar DTO pequeños y descarga JSON recibida mediante la compuerta de sesión. No depender todavía de Content-Disposition, enlaces firmados o un método HTTP no permitido. |
| El entorno comparte una base y un proceso API. La configuración de privilegios BD está evolucionando en otra tarea. | V7 debe ampliar privilegios por tabla explícitamente, sin grants globales a futuras tablas. La separación de roles de aplicación no protege frente al propietario/administrador de la BD. |

## 2. Acceso propuesto: MEDICO y autor, ambos obligatorios

La identidad del autor es `(issuer, subject)` tomada del JWT validado, nunca del body. Los nombres visibles son etiquetas, no claves de autorización. El servicio recibe un contexto de identidad tipado y comprueba el rol y el propietario antes de leer contenido, ejecutar, reproducir un comando idempotente o descargar.

| Actor | Listado, contenido, revisiones, historial y export | Escritura |
| --- | --- | --- |
| MEDICO autor de ese documento | Sí, solo propios | Borrador propio; cierre técnico propio; adenda de original propio cerrado |
| Otro MEDICO | No; detalle/UUID ajeno devuelve el mismo 404 que inexistente | No |
| ADMIN/RECEPCION/AUDITOR/FARMACIA sin MEDICO | 403, incluso con UUID conocido | No |
| Cuenta ADMIN + MEDICO | Solo sus documentos por su rol MEDICO explícito | Igual que otro autor, sin facultad sobre los demás |
| Sin token/vencido | 401 | No |

El listado de notas de un paciente devuelve únicamente las del autor actual; una lista vacía no indica si otro profesional tiene documentos. No se aceptará `authorSubject` como filtro manipulable ni un flag `includeAll`. La búsqueda se limita a identificadores exactos y estados; no habrá búsqueda de texto clínico ni autocompletado de notas.

En esta V7 sintética un MEDICO puede iniciar su propia nota para un paciente sintético visible administrativamente. Eso **no implementa** una relación asistencial acreditada ni autorización multi-organización. No habrá asignación/reasignación automática ni lectura de notas ajenas por compartir cita. La relación asistencial, delegación y organizaciones requieren otra vertical antes de datos reales.

## 3. Modelo persistente e invariantes

Nombres propuestos para `V7__clinical_records.sql`:

| Tabla | Campos/invariantes principales |
| --- | --- |
| `clinical_document` | `id UUID`, `patient_id` FK RESTRICT, `appointment_id` FK nullable, `owner_issuer`, `owner_subject`, `kind NOTE\|ADDENDUM`, `original_document_id` FK nullable, `synthetic=true`, `state DRAFT\|CLOSED_TECHNICAL`, `version bigint >=0`, `current_revision`, `closed_revision` nullable, `created_at`, `updated_at`, `closed_at` nullable. Paciente, cita, autor, tipo y original no cambian tras alta. |
| `clinical_revision` | `(document_id, revision)` única; versión de plantilla, `encounter_at` con zona/Instant, `content_text`, `addendum_reason` cuando corresponda, actor derivado y timestamp de servidor. Append-only. Cada guardado agrega una revisión; ninguna actualización sustituye texto histórico. |
| `clinical_command` | UUID de comando, actor `(iss, sub)`, operación, huella de solicitud canónica, timestamp y ACK tipado: identificador de resultado, versión, revisión y estado. Sin body, contenido, motivo, paciente ni caché arbitrario de JSON clínico. Reserva/finalización dentro de una transacción; una reserva incompleta nunca se entrega como confirmación. |
| `clinical_audit_event` | ID, actor `(iss, sub)`, acción/código de resultado, documento/command/export opcionales, revisión, timestamp, identificador de petición y finalidad enumerada. Sin texto libre, tokens, cuerpo, nombres ni hash del contenido. Append-only y no expuesta por `/audit/events`. |
| `clinical_export` | ID, autor, original, manifiesto de IDs/revisiones cerradas exactas, versión de esquema, creado/vence, finalidad enumerada. No almacena una segunda copia del texto; su acceso permite reproducir solo esas revisiones inmutables. |

Al cerrar, `clinical_document` conserva también una instantánea administrativa mínima del paciente (`reference`, `fullName`, `birthDate`, versión) obtenida por servidor y, si procede, identificación/versionado de la cita. Así una corrección administrativa posterior no reescribe la representación del documento ya cerrado. No se copia esa instantánea a auditoría o command. Su necesidad no autoriza importar datos reales.

Invariantes adicionales:

1. Body y paciente requieren `synthetic === true`; ausente/false se rechaza. `patient_id` debe existir. Si hay cita, debe existir y pertenecer al mismo paciente. No inferir paciente desde texto o crear uno automáticamente.
2. Proponer en V7 `UNIQUE(id, patient_id)` adicional sobre `operation_appointment` y FK compuesta `(appointment_id, patient_id)` desde clínica, sin modificar V3. La validación de servicio da un error legible y la FK mantiene coherencia. Revalidar compatibilidad con V6 antes de escribir la migración.
3. `NOTE` tiene original null. `ADDENDUM` apunta directamente a una `NOTE` propia ya cerrada, nunca a otra adenda, y hereda paciente/cita; el body no puede reasignarlos. Cada adenda tiene su borrador, revisiones y cierre. Puede haber varias; se ordenan por fecha servidor e ID, no se reescribe la nota original para agregarlas.
4. Bloquear UPDATE/DELETE de revisiones/auditoría y cualquier mutación de un documento cerrado. Conservar FKs RESTRICT y no crear endpoints DELETE. El runtime no recibe DELETE/TRUNCATE/DDL sobre clínica. Estos controles no son inmutabilidad criptográfica frente al propietario de la BD.
5. Versiones del agregado y números de revisión son distintos: alta `version=0, revision=1`; guardar crea `revision+1, version+1`; cerrar conserva revisión y aumenta versión. Dos guardados/cierres con la misma versión no se sobrescriben.
6. Guardar/cerrar serializa el documento mediante lock y verifica `expectedVersion`. Cierre bloquea también el paciente y verifica `expectedPatientVersion`; congelar la identidad que el autor acaba de revisar. Definir y probar orden de locks único para no invertirlo en adendas/export.
7. Una cita CANCELLED puede conservar documentos históricos; su estado no autoriza borrar ni cerrar. Crear/guardar/cerrar no inicia/finaliza citas, no cobra y no modifica stock. Una fecha de atención es un dato ficticio explícito, distinto de los timestamps de registro/cierre del servidor.
8. Conservar todo en esta vertical sintética: sin purga automática ni supuesta política legal de cinco años. Respaldos/restauración deberán incorporar las nuevas tablas y referencias. Retención, borrado y habilitación clínica requieren decisiones externas documentadas.

## 4. Contratos HTTP propuestos

Todos los paths bajo `/api/v1/clinical`, solo JSON, `Cache-Control: no-store, private`, sin contenido en query/URL. Los POST de escritura llevan `Idempotency-Key: UUID`; límites validados en backend, paginación `limit 1..50`, `offset >=0`. Las respuestas de error usan códigos/texto fijo, no valores rechazados ni contenidos de otro autor.

| Método/path | Entrada | Salida/condición |
| --- | --- | --- |
| GET `/patients/{patientId}/documents?limit=25&offset=0` | Paciente exacto | Página de metadatos propios: id, kind, state, version, revision, appointmentId, fechas; no extracto de texto. Lectura auditada. |
| GET `/documents/{id}` | UUID | Metadatos, revisión actual propia y representación administrativa autorizada. Auditoría antes de entrega. |
| GET `/documents/{id}/revisions?limit=25&offset=0` | Documento propio | Índice de revisiones sin texto. |
| GET `/documents/{id}/revisions/{revision}` | Revisión exacta propia | Texto de esa revisión; acceso auditado. |
| POST `/documents` | `id` UUID generado una vez por cliente, `patientId`, `appointmentId|null`, `synthetic:true`, `templateCode:"SYNTHETIC_NOTE_V1"`, `encounterAt` ISO Instant, `content:{text}` | 201 + ACK, no documento completo. `kind=NOTE` y autor derivados del servidor. |
| POST `/documents/{id}/draft` | `expectedVersion`, `synthetic:true`, `encounterAt`, `content:{text}`; en adenda también `reason` | 200 + ACK. Solo DRAFT propio. No modificar vínculos ni plantilla. |
| POST `/documents/{id}/close` | `expectedVersion`, `expectedPatientVersion`, `synthetic:true`, `acknowledgeTechnicalClosure:true` | 200 + ACK `state=CLOSED_TECHNICAL`. No acepta texto adicional: cierra exactamente la revisión guardada y revisada. |
| POST `/documents/{id}/addenda` | Nuevo `id`, `synthetic:true`, `encounterAt`, `reason`, `content:{text}` | 201 + ACK de adenda DRAFT. Original propio cerrado, paciente/cita heredados. No muta el original. |
| GET `/commands/{commandId}` | UUID de operación | 200 + ACK solo si confirmado y del actor actual. Ausente/no confirmado/ajeno: 404 indistinguible; **no significa que una transacción en vuelo haya fallado**. |
| GET `/commands?limit=25&offset=0` | Sin filtro de otro actor | Confirmaciones mínimas propias más recientes; permite conciliar tras recarga sin recuperar un body del navegador. No consulta automática de todas las páginas. |
| POST `/documents/{id}/exports` | `expectedVersion`, `synthetic:true`, `purpose:"SYNTHETIC_REVIEW"`, `acknowledgeLocalDownload:true` | 201 + ACK de exportId; original propio cerrado. Manifiesto consistente del original y adendas cerradas visibles a ese autor. |
| GET `/exports/{exportId}/content` | Export propio vigente | JSON `schemaVersion`, `synthetic:true`, `signatureStatus:"NOT_SIGNED"`, original y adendas del manifiesto; cada entrega auditada. No incluye ledger, tokens ni otros expedientes. |

ACK de documento: `{commandId, operation, documentId, version, revision, state, committedAt}`. ACK de export: `{commandId, operation, exportId, expiresAt, committedAt}`. Son DTO distintos; no usar un genérico que accidentalmente admita `content`. El body de nota se limita inicialmente a 8 000 caracteres y 32 KiB UTF-8 de texto, sin HTML/Markdown activo; razón de adenda 1..500 caracteres. Son límites de implementación, no contenido clínico normativamente suficiente. La representación Angular usa texto escapado, nunca `innerHTML`.

Códigos mínimos: 400 `INVALID_REQUEST`/`SYNTHETIC_REQUIRED`; 401; 403 `CLINICAL_ROLE_REQUIRED`; 404 `NOT_FOUND` o respuesta equivalente para ledger; 409 `VERSION_CONFLICT`, `PATIENT_VERSION_CONFLICT`, `DOCUMENT_CLOSED`, `ORIGINAL_NOT_CLOSED`, `APPOINTMENT_PATIENT_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `DOCUMENT_ID_CONFLICT`; 410 `EXPORT_EXPIRED` únicamente después de comprobar autor. Un conflicto devuelve como máximo versión actual propia, no el texto: comparar requiere una lectura autorizada y auditada aparte.

## 5. Idempotencia y reconciliación sin fuga

**Backend:** crear `ClinicalCommandService`, no envolver clínica en `CommandService.execute`. La clave serializa reintentos concurrentes; normalizar un DTO estable antes de calcular la huella de operación + recurso + entrada. Reserva, revisión/cierre, evento clínico y ACK se confirman en una transacción. Si falla, todo hace rollback. Un replay comprueba permisos actuales y propietario antes de devolver el ACK; un rol retirado nunca conserva acceso por conocer la clave. Distinto body u operación con la misma clave produce conflicto, no una segunda escritura. La huella queda solo en la tabla privada; no es anonimización ni firma.

**Frontend:** `ClinicalCommandStore` asociado al contexto clínico conserva solo en memoria `{issuer,subject,roleContext,key,operation,resourceId,immutableBody,state}`. Debe usar la compuerta de `ClinicStore.api.request` o una fachada de transporte que la preserve, **nunca `ClinicStore.submit/retry`**. Introducir además una prohibición explícita en `ClinicStore.submit` para paths `clinical/` antes de serializar, como defensa contra uso accidental. No escribir borrador, body enviado, token ni clave clínica en sessionStorage/localStorage/IndexedDB/Cache API/service worker, logs o herramientas de telemetría.

Secuencia propuesta:

1. El usuario pulsa Guardar/Cerrar. Capturar body inmutable y un UUID; bloquear nuevas mutaciones sobre ese documento mientras el resultado sea incierto. No autosave en esta primera vertical.
2. ACK confirmado: marcar esa revisión como guardada; leer el documento solo si se necesita mostrarlo, con auditoría. Si esa lectura falla, conservar la confirmación: no repetir la escritura por un fallo de refresco.
3. Timeout/502/401 o respuesta descartada por bloqueo de sesión: conservar el mismo body y UUID en memoria; mostrar «Resultado pendiente de confirmar», nunca «No se guardó». No crear una clave nueva ni reenviar automáticamente.
4. Tras recuperar exactamente la misma identidad/permisos, ofrecer **Consultar estado**. Un ACK permite reconciliar. Un 404 significa «Aún no confirmado»; la primera transacción podría seguir abierta. Permitir otra consulta o **Reintentar la misma operación** de manera explícita, con idénticos UUID/body. El ledger garantiza una sola escritura aunque compitan.
5. Para editar un contenido incierto, primero resolver el resultado. No cambiar silenciosamente el body asociado a su UUID. Si el servidor rechaza de manera definitiva, conservar el borrador editable y generar otra clave solo para una nueva decisión de guardado.
6. Cambio de sujeto/emisor/roles o logout: destruir borradores, referencias al body, pendientes, blobs y callbacks clínicos antes de mostrar otra cuenta. Una respuesta tardía no puede poblar el nuevo contexto. Renovación ordinaria de la misma cuenta no invalida una escritura en vuelo. Una pérdida de permiso da bloqueo/descarte seguro, no acceso de ADMIN como fallback.
7. Recarga/cierre de pestaña pierde lo no guardado y el body incierto; advertirlo sin prometer recuperación persistente. Tras nuevo login, listar confirmaciones/documentos propios recientes permite localizar lo que sí llegó al servidor. No reconstruir ni reenviar contenido perdido. Un alta usa además un documentId fijo para la misma intención; no deduplicar por nombre, texto o fecha ni crear automáticamente otro documento.

La recuperación administrativa existente puede coexistir, pero sus stores/avisos/reintentos no deben recibir cuerpos clínicos. Un diálogo clínico tampoco debe invocar el botón de reintento administrativo proyectado por `Dialog`; necesita una estrategia explícita de recuperación propia. La sesión bloqueada conserva el componente oculto e inert como hoy, pero su store se destruye en cambio de identidad/roles. Destrucción lógica no equivale a borrado forense de memoria del motor JS.

## 6. Auditoría, exportación y riesgos de transporte

- Auditar creación/revisión/cierre/adenda/replay/lectura/listado/reconciliación/preparación y acceso a export con códigos enumerados. Las operaciones confirmadas se auditan en su misma transacción. Las lecturas deben confirmar su evento antes de devolver contenido; si no se puede auditar, no entregar. Registrar intentos denegados en un canal clínico separado que no desaparezca por rollback, sin revelar si existe el UUID ni capturar contenido.
- No habilitar un endpoint general de auditoría clínica a AUDITOR. Para V7, los metadatos de historia propia bastan en el recorrido del autor; una auditoría clínica independiente y su finalidad requieren un rol/asignación distinta futura. El administrador operativo no verá ni títulos, conteos por paciente ni enlaces a notas en su auditoría.
- Export es una excepción explícita a «sin contenido persistido en navegador»: el usuario solicita guardar un archivo sintético local. Requiere confirmación con alcance/conteo, watermark lógico `NOT_SIGNED`, filename opaco sin nombre de paciente y advertencia sobre custodia. No autosave, descarga al abrir una ficha, share URL, export masivo, CSV clínico ni incorporación al backup del navegador.
- Preparar un manifiesto con snapshot consistente, no consultas que mezclen revisiones durante escrituras concurrentes. Un export ya preparado no incorpora adendas futuras: la UI muestra su alcance y ofrece preparar otro. La vigencia técnica inicial propuesta es 15 minutos de servidor; no amplía la vida de la sesión.
- Cada GET de contenido revalida rol, propietario, manifiesto y vigencia; no bastan UUID o una preparación anterior. Revocar la URL Blob al terminar/destruir contexto; no registrar tokens en URL. Si la sesión se bloquea mientras llega el JSON, la compuerta descarta la respuesta y no inicia descarga.
- Registrar «acceso/entrega intentada», no afirmar que el usuario recibió o abrió el archivo: una conexión puede cortarse después del evento. Una repetición manual de GET genera nuevo evento, pero devuelve la misma versión del paquete preparado.
- Probar ausencia de texto sintético marcador en `inventory_command`, `audit_event`, sessionStorage/localStorage, errores y logs HTTP. El contenido estará deliberadamente en `clinical_revision` y en la descarga solicitada; no prometer cifrado en reposo o aislamiento físico que el entorno actual no tiene.

## 7. Archivos previstos; no modificados por este plan

| Área | Archivos propuestos / integración futura |
| --- | --- |
| Persistencia | `backend/src/main/resources/db/migration/V7__clinical_records.sql`; privilegios explícitos del runtime y validación de backup/restauración en coordinación con sus responsables |
| Dominio | `backend/src/main/java/mx/denova/clinic/clinical/ClinicalModels.java`, `ClinicalService.java`, `ClinicalCommandService.java`, `ClinicalAuditService.java` |
| API/seguridad | `backend/src/main/java/mx/denova/clinic/api/ClinicalController.java`; matchers específicos en `security/SecurityConfiguration.java`; contexto JWT completo y DTOs sin autor manipulable; límites/errores sin contenido |
| Portal | `src/app/portal/clinical-api.ts`, `clinical-command-store.ts`, componentes clínicos nuevos mediante Angular CLI; integración mínima en rutas/menú para MEDICO, compuerta preventiva en `clinic-store.ts`, estrategia de diálogo sin reintento administrativo |
| Tests | `backend/src/test/java/mx/denova/clinic/ClinicalApiTest.java`; pruebas puras de estado/serialización; `tests/portal/clinical.spec.ts` con proveedor real y casos sintéticos |
| Contrato/evidencia | `backend/docs/CLINICAL_API.md`, actualización de `docs/VALIDATION.md`, `CLINICAL_READINESS.md`, arquitectura/backlog y recuperación; distinguir diseño/implementación/ejecución/aceptación |

No reutilizar las notas de `src/app` de la demo pública ni migrar su localStorage a clínica privada. No incluir fixtures con contenido real, passwords o tokens; los tests de seguridad necesitan dos médicos sintéticos distintos, además de los otros roles.

## 8. Plan de ejecución pendiente

- [ ] Acordar contratos anteriores y revisar la integración con V6 y privilegios BD; mantener todos los bloqueos de datos reales.
- [ ] Añadir V7, constraints, índices por autor/paciente/fecha, ledger clínico y protecciones append-only; ensayar upgrade sin destruir datos V1–V6.
- [ ] Implementar autorización por `(iss,sub)` en cada lectura/comando/replay y DTOs minimizados; añadir auditoría clínica fail-closed.
- [ ] Implementar guardado versionado, cierre técnico de revisión exacta e instantánea administrativa, y adendas sin mutación del original.
- [ ] Implementar ledger de ACK/reconciliación y manifestación/export explícito con límites, sin caché compartido ni claims de firma.
- [ ] Construir UI del médico, estado de guardado/pendiente/conflicto, comparación de versiones y store solo memoria; impedir envíos clínicos por persistencia administrativa.
- [ ] Ejecutar pruebas PostgreSQL en schema exclusivo de `clinic_test`: roles, otro autor, claves concurrentes, versiones, cita/paciente incoherentes, false/ausente synthetic, rollback, cierre repetido, updates/deletes de cerrado, adendas, auditoría y export consistente.
- [ ] Ejecutar navegador real en escritorio/móvil: pérdida de respuesta después de commit, consultar UUID, reintento idéntico sin duplicación, sesión/roles/cuenta cambiantes, contenido fuera de storage/cachés, XSS como texto, foco, cierre de pestaña y descarga explícita sin envío automático.
- [ ] Actualizar y ejecutar respaldo/restauración con nuevas tablas, FKs e historial; revisar diferencias de esquema/grants. No truncar `clinic_dev` ni usar `CASCADE` sobre recursos compartidos de pruebas.
- [ ] Documentar resultados por suite y límites; entregar un piloto sintético para revisión humana. No convertir suite verde, autor JWT, hash o botón de cierre en aprobación clínica o jurídica.

## 9. Decisiones y riesgos aún abiertos

1. **No bloquea el prototipo sintético:** aprobar texto/estructura definitiva de plantillas y flujo de revisión del médico. La propuesta narrativa mínima no pretende suficiencia clínica.
2. **Bloquea datos reales:** identidad profesional/relación asistencial, privacidad, custodia/retención, firma aplicable, evaluación normativa, MFA, infraestructura autorizada y aceptación humana. La construcción propia y el papel de Doctoralia ya están decididos.
3. **Requiere revisión técnica antes de merge:** instante y orden de locks del cierre/export, manejo de auditoría de denegaciones, privilegios de las cinco tablas y pruebas de no filtración. No ofrecer acceso clínico compartido hasta diseñar una autorización específica.

Resultado: contratos y ruta V7 propuestos, no implementados. No se ejecutaron builds, migraciones, Docker ni pruebas durante la elaboración de este documento.
