# Equipos reutilizables y mantenimiento

Contrato privado bajo `/api/v1/equipment`. Los equipos tienen identidad, ubicación y disponibilidad propias; no son unidades del inventario consumible. El módulo no descuenta existencias ni genera cobros. Las pruebas y el entorno de desarrollo usan únicamente ejemplos sintéticos.

## Permisos y operaciones

ADMIN, RECEPCION, MEDICO, FARMACIA y AUDITOR pueden consultar. Solo ADMIN puede crear equipos, registrar intervenciones y cambiar disponibilidad. El servidor toma el actor del token firmado. Todas las escrituras requieren `Idempotency-Key: <UUID>`.

| Método y ruta | Solicitud / resultado |
| --- | --- |
| GET `/assets` | Filtros opcionales `q`, `status`; paginación `limit=50&offset=0` |
| GET `/assets/{id}` | Un equipo y su próxima intervención registrada |
| POST `/assets` | `{reference,name,location,serialNumber?}` → 201, equipo AVAILABLE versión 0 |
| POST `/assets/{id}/status` | `{status,reason,expectedVersion}` → 200, equipo actualizado |
| GET `/assets/{id}/maintenance` | Historial paginado por fecha de intervención descendente |
| POST `/assets/{id}/maintenance` | `{performedOn,nextDueOn?,description,technician,expectedVersion}` → 201, intervención |

Los listados devuelven `{items,limit,offset}`. `limit` admite 1–100 y `offset` 0–1000000. Los equipos se ordenan por referencia. La búsqueda `q` admite hasta 160 caracteres y busca texto literal, sin distinguir mayúsculas, en referencia, nombre, ubicación y número de serie. `%` y `_` no actúan como comodines.

Las consultas de equipos devuelven:

```json
{
  "id": "<UUID>",
  "reference": "EQ-DEMO-001",
  "name": "Equipo de demostración",
  "location": "Sala de entrenamiento",
  "serialNumber": null,
  "status": "AVAILABLE",
  "version": 0,
  "nextDueOn": null,
  "createdAt": "<instante ISO-8601>",
  "updatedAt": "<instante ISO-8601>"
}
```

La referencia es única, de hasta 80 caracteres, y se normaliza a mayúsculas sin espacios exteriores. Nombre y ubicación son obligatorios y admiten hasta 160 caracteres. El número de serie es opcional, admite hasta 120 y no se presume globalmente único entre fabricantes. Una serie vacía se guarda como `null`.

## Disponibilidad y agenda

Estados: `AVAILABLE`, `MAINTENANCE`, `OUT_OF_SERVICE`. El cambio exige un motivo no vacío de hasta 160 caracteres y la versión actual. No se permite repetir el estado mediante una operación nueva. Una intervención registrada no cambia por sí sola la disponibilidad; el responsable debe liberar expresamente el equipo después de revisar el resultado.

`EquipmentService.assertResourceAvailable(reference)` está disponible para agenda y requiere una transacción existente. Busca la referencia exacta normalizada y bloquea el equipo hasta finalizar esa transacción. Si coincide con un equipo registrado no disponible, rechaza con `EQUIPMENT_UNAVAILABLE`; si no existe coincidencia, permite el recurso genérico, como un consultorio. Agenda debe invocarlo al reservar y antes de iniciar una cita. Su conexión y las pruebas HTTP de ese recorrido corresponden al módulo de agenda.

Poner un equipo fuera de servicio se permite aunque existan reservas anteriores: una falla real debe poder registrarse. Las citas anteriores no se cancelan ni cambian automáticamente; el personal debe revisar las afectadas. Una fecha de mantenimiento vencida se presenta para revisión y no altera automáticamente la disponibilidad, pues no se ha establecido una política del consultorio que lo autorice.

## Intervenciones y programación

Ejemplo sintético de solicitud:

```json
{
  "performedOn": "2026-09-28",
  "nextDueOn": "2027-03-28",
  "description": "Inspección sintética de entrenamiento; sin certificación",
  "technician": "Técnico de ejemplo",
  "expectedVersion": 0
}
```

`performedOn` es una fecha desde 1900 y no posterior al día actual del consultorio (`America/Mexico_City`). `nextDueOn`, cuando se indique, debe ser posterior a la intervención y su año no puede superar 9999; puede haber vencido si se incorpora un registro histórico. Descripción y técnico son obligatorios, con máximos de 1000 y 160 caracteres respectivamente. No se solicitan pacientes ni información clínica.

La respuesta incluye `{id,assetId,performedOn,nextDueOn,description,technician,actor,createdAt,assetVersion}`. Se conserva cada intervención; no hay edición ni eliminación. Los triggers de PostgreSQL rechazan UPDATE/DELETE del historial y la auditoría para el usuario normal de aplicación. Esto no protege contra un administrador capaz de cambiar el esquema.

La próxima intervención del equipo corresponde al registro con `performedOn` más reciente. Para intervenciones del mismo día, prevalece la de mayor `assetVersion`. Añadir un registro atrasado no reemplaza una programación más reciente. Si el registro que prevalece no define `nextDueOn`, la fecha queda sin determinar. Estos datos documentan la intervención reportada; no acreditan calibración, certificación ni aptitud clínica.

## Concurrencia, reintentos y errores

Las escrituras usan `CommandService`, su transacción y su registro de idempotencia. El equipo, intervención, versión, respuesta y auditoría se confirman juntos. Una operación fallida revierte también la clave. La disponibilidad y el mantenimiento comparten una versión: dos operadores que usen la misma versión no pueden sobrescribirse; uno obtiene `409 STALE_VERSION` y debe actualizar y revisar su operación.

El reintento conserva clave, actor y cuerpo. La misma solicitud exitosa devuelve su resultado original aunque el equipo haya cambiado después. Una clave reutilizada con otro cuerpo, actor u operación produce `409 IDEMPOTENCY_CONFLICT`. Tras una respuesta perdida, se reintenta la solicitud original antes de generar otra clave; se consulta luego el estado vigente.

Errores: 400 entrada/paginación inválida; 401 identidad ausente o inválida; 403 rol insuficiente o método no habilitado; 404 equipo inexistente; 409 conflicto. Códigos de dominio adicionales: `EQUIPMENT_SAME_STATUS`, `EQUIPMENT_UNAVAILABLE`, `STALE_VERSION`. Las referencias repetidas usan el `DATA_CONFLICT` existente. Se rechazan propiedades JSON desconocidas, como intentar atribuir un actor desde el cliente.

## Migración y comprobaciones

V5 agrega `equipment_asset` y `equipment_maintenance`, sus índices y protección del historial. No modifica V1/V2 ni datos de inventario/compras. Depende de `inventory_command`, `audit_event` y la función de protección existentes.

`EquipmentApiTest` contiene pruebas HTTP con tokens firmados y PostgreSQL real: lectura por rol y rechazo de escritura, normalización, duplicados, reintentos, validación, filtros, próximas intervenciones, historial atrasado, auditoría, concurrencia entre operadores y protección del historial. También verifica el guard de disponibilidad de agenda dentro de una transacción PostgreSQL.

Ejecución coordinada en una base exclusivamente desechable, configurando `TEST_DB_URL`, `TEST_DB_USER` y `TEST_DB_PASSWORD`:

```powershell
mvn -Dtest=EquipmentApiTest test
```

La clase trunca tablas entre casos. No ejecutar contra una base operativa ni en paralelo con otras suites que compartan esa base. La existencia de estos casos no acredita su ejecución: consultar el reporte de la corrida correspondiente.
