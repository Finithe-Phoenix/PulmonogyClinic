# Pacientes administrativos y agenda privada

Prefijo `/api/v1/operations`. Autenticación JWT, autorización de servidor, datos sintéticos obligatorios. No se reciben diagnósticos, notas clínicas, documentos ni expedientes. `synthetic: true` es una declaración del operador: no identifica automáticamente si el contenido introducido pertenece a una persona real. Debe mantenerse el entorno limitado a pruebas.

Todas las escrituras usan JSON e `Idempotency-Key: <UUID>`. Repetir exactamente una petición con la misma clave y actor devuelve su primera respuesta, aunque el registro haya cambiado después. Ante respuesta perdida conservar clave y cuerpo; ante conflicto de versión leer de nuevo y preparar una operación nueva. Una clave no se comparte entre acciones o actores.

Los listados retornan `{items,limit,offset}`; `limit` de 1 a 100 (50 por defecto), `offset` de 0 a 1 000 000. No hay endpoints de eliminación.

| Ruta | Permisos | Uso |
| --- | --- | --- |
| GET /patients | ADMIN, RECEPCION, MEDICO, AUDITOR | Búsqueda `q` por nombre sin acentos o referencia, paginación |
| GET /patients/{id} | Los mismos | Registro administrativo |
| GET /patients/duplicates | Los mismos | `fullName` obligatorio, `birthDate` y `phone` opcionales |
| POST /patients | ADMIN, RECEPCION | Alta, 201 |
| POST /patients/{id}/update | ADMIN, RECEPCION | Corrección controlada, 200 |
| GET /appointments | ADMIN, RECEPCION, MEDICO, AUDITOR | Filtros `from`, `to`, `status`, `patientId` |
| GET /appointments/{id} | Los mismos | Detalle actual |
| GET /appointments/{id}/history | Los mismos | Historial inmutable paginado |
| POST /appointments | ADMIN, RECEPCION, MEDICO | Reserva, 201 |
| POST /appointments/{id}/reschedule | Los mismos | Reprogramación mientras está BOOKED, 200 |
| POST /appointments/{id}/transition | Los mismos; inicio y fin solo ADMIN/MEDICO | Transición, 200 |

## Identidad administrativa y coincidencias

Alta:

```json
{
  "reference":"PAC-DEMO-001",
  "fullName":"Paciente de Ejemplo",
  "birthDate":"1990-01-01",
  "phone":"+527220000000",
  "email":"synthetic@example.invalid",
  "duplicateReviewed":false,
  "synthetic":true
}
```

La referencia es única (2–40 caracteres A–Z, dígitos y guion), el nombre tiene hasta 160 caracteres. Nacimiento admite desde hace 130 años hasta hoy. Contactos son opcionales; no se pide CURP, domicilio ni información clínica. Las actualizaciones incluyen los mismos campos y `expectedVersion` (entero no negativo recibido al leer). La respuesta: `id,reference,fullName,birthDate,phone,email,version,synthetic,createdAt,updatedAt`.

Revisar duplicados devuelve candidatos `{patient,matchedOn:["NAME","BIRTH_DATE","PHONE"]}`. Se propone coincidencia por nombre normalizado exacto o por nacimiento y teléfono juntos; la lista de motivos contiene los campos que coinciden. Una misma familia puede compartir teléfono. El sistema no fusiona, ni decide que dos personas sean la misma. `POSSIBLE_DUPLICATE` pide revisar los registros y, solo si procede crear o corregir uno independiente, volver a enviar con `duplicateReviewed:true`. Las escrituras del registro se serializan para impedir altas simultáneas que omitan esa revisión. La normalización permite buscar homónimos con diferencias de acento, mayúsculas o espacios.

## Agenda y recepción

Reserva:

```json
{
  "patientId":"<UUID existente>",
  "startsAt":"<fecha y hora ISO-8601 con zona>",
  "durationMinutes":30,
  "service":"Consulta sintética",
  "practitioner":"MEDICO-1",
  "resource":"CONSULTORIO-1",
  "source":"LOCAL"
}
```

La cita conserva `patientId`; reprogramar no permite cambiarlo. El DTO de reprogramación contiene los campos de reserva excepto `patientId`, más `expectedVersion`. Duración de 5–480 minutos. Fechas entre las últimas 24 horas y los próximos dos años; el frontend representa fechas en `America/Mexico_City` y envía el instante correcto. `service` hasta 120 caracteres; profesional y recurso son identificadores normalizados a mayúsculas de hasta 80. Un recurso que coincide con una referencia de equipo registrado debe estar AVAILABLE para reservar, reprogramar o iniciar; salas genéricas siguen admitidas. Marcar después un equipo fuera de servicio exige conciliar las citas futuras, y bloquea iniciar su uso. No es una certificación de equipo ni una sincronización de recursos externos.

Respuesta: `id,patientId,patientName,patientReference,startsAt,endsAt,durationMinutes,service,practitioner,resource,source,externalReference,status,cancellationReason,version,createdAt,updatedAt`.

Los filtros temporales deben venir juntos, cubrir un máximo de 93 días y usar instantes ISO-8601. Devuelven citas que se solapan con `[from,to)`, incluidas las que empezaron antes del intervalo. Se previene solapamiento del paciente, profesional **o** recurso en citas no canceladas. Se permiten citas contiguas. Un mutex transaccional PostgreSQL compartido serializa todas las mutaciones de agenda y evita carreras entre instancias. Es una elección deliberada para la escala de un consultorio; requiere reevaluación para una agenda de alto volumen.

Transiciones:

```text
BOOKED → ARRIVED (en sala de espera) → IN_CONSULTATION → COMPLETED
BOOKED o ARRIVED → CANCELLED (motivo obligatorio)
```

```json
{"expectedVersion":0,"status":"ARRIVED"}
```

`reason` es opcional salvo cancelación, hasta 240 caracteres y solo administrativo. Estados finales no se reabren. Cada cambio incrementa versión; un intento desactualizado falla con `VERSION_CONFLICT` y no altera historial. El historial conserva actor del JWT, comando, versión, estados, motivo y fotografía del horario/profesional/recurso de cada evento. Eventos y auditoría son append-only.

Una atención que se prolonga mantiene ocupado paciente, profesional y recurso aunque la siguiente cita contigua ya haya llegado. El servidor no permite iniciar la segunda hasta finalizar la consulta que comparte alguno de ellos.

## Doctoralia como canal de captación

Decisión del titular (28/09/2026): **el portal es la agenda principal; Doctoralia solo exposición y captación**. Para un contacto procedente de ese canal, confirmado manualmente por recepción, usar `source:"DOCTORALIA_MANUAL"` y `externalReference` obligatorio de hasta 100 caracteres. Esa referencia identifica el contacto; no afirma una reserva externa ni requiere un identificador emitido por el proveedor. Una referencia externa activa no puede duplicarse. Recepción verifica aquí la disponibilidad y registra la cita una sola vez. El enum se conserva por compatibilidad con registros anteriores; no representa un conector, una fuente autoritativa de disponibilidad ni un expediente clínico compartido. No se hacen llamadas a Doctoralia.

## Errores y verificación

Respuestas ProblemDetail con `code`: `POSSIBLE_DUPLICATE`, `VERSION_CONFLICT`, `SCHEDULE_CONFLICT`, `INVALID_TRANSITION`, `EQUIPMENT_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `DATA_CONFLICT` (409), `INVALID_REQUEST` (400), `NOT_FOUND` (404), `ROLE_REQUIRED` (403). Las rutas no autorizadas responden 401/403 antes de operar. Los mensajes no revelan el paciente que provocó un solapamiento.

`OperationsApiTest` ejecuta HTTP real con JWT de prueba y PostgreSQL. Crea un esquema aleatorio `operations_test_<UUID>` en la base de pruebas, verifica `current_schema()` antes de truncar y elimina exclusivamente ese esquema al terminar. Usa `TEST_DB_URL`, `TEST_DB_USER` y `TEST_DB_PASSWORD`; ejecutar solo contra la base desechable de pruebas. Todas las migraciones aplican dentro del esquema aislado, incluidas caja/equipo. Así los FK nuevos no hacen que el cleanup afecte otras suites ni el esquema de desarrollo.

La suite cubre permisos, validación sintética, homónimos, revisión de duplicados, versionado, reintentos, persistencia entre peticiones, concurrencia de altas/ediciones/reservas/transiciones, horario, espera/consulta/finalización, cancelaciones, conciliación manual, bloqueo por equipo e historial inmutable. Su presencia es implementación de pruebas; la ejecución y el resultado deben registrarse tras correrlas en PostgreSQL.
