# Caja administrativa — API v1

Entorno de desarrollo con datos sintéticos. Registra cobros y conciliación administrativa en MXN; no procesa pagos electrónicos, reembolsos bancarios, contabilidad ni CFDI.

## Acceso y contrato

Base `/api/v1/cash`. JWT de identidad real, audiencia `clinic-api`. Lectura: `ADMIN`, `RECEPCION`, `AUDITOR`. Apertura, cobro y cierre: `ADMIN`, `RECEPCION`. Reverso: solo `ADMIN`; además de la regla de seguridad, el controlador comprueba el rol.

Todos los POST requieren `Idempotency-Key: <UUID>`. Los GET paginados admiten `limit` 1–100 (50 por defecto) y `offset` 0–1000000 (0 por defecto). La respuesta es `{items,limit,offset}`.

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| GET `/shifts` | — | Página de `Shift`, más recientes primero |
| GET `/shifts/{id}` | — | `Shift` |
| POST `/shifts` | `{reference,openingFloatCents}` | 201 `Shift` |
| GET `/shifts/{id}/payments` | — | Página de `Payment`, más recientes primero |
| POST `/shifts/{id}/payments` | `{reference,amountCents,method,operationReference?}` | 201 `Payment` |
| POST `/payments/{id}/reverse` | `{reason}` | 200 `Payment`, incluyendo el reverso |
| POST `/shifts/{id}/close` | `{countedCashCents,reason}` | 200 `Shift` cerrado |

`Shift`:

```json
{
  "id": "UUID", "reference": "TURNO-DEMO-01", "status": "OPEN", "currency": "MXN",
  "openingFloatCents": 50000, "cashTotalCents": 12345, "cardTotalCents": 23456,
  "transferTotalCents": 0, "expectedCashCents": 62345,
  "countedCashCents": null, "differenceCents": null,
  "openedAt": "2026-09-28T15:00:00Z", "openedBy": "subject",
  "closedAt": null, "closedBy": null, "closureReason": null
}
```

`Payment`:

```json
{
  "id": "UUID", "shiftId": "UUID", "reference": "COBRO-DEMO-01",
  "amountCents": 12345, "method": "CASH", "operationReference": "CITA-DEMO-01",
  "createdAt": "2026-09-28T15:10:00Z", "actor": "subject",
  "reversed": false, "reversedAt": null, "reversedBy": null, "reversalReason": null
}
```

`status` es `OPEN` o `CLOSED`; `method` es `CASH`, `CARD` o `TRANSFER`. Los valores monetarios son enteros en centavos, no pesos ni flotantes. Importes requeridos; se rechazan ausencias y fracciones. El cobro exige valor positivo; fondo y conteo admiten cero. El fondo más todos los cobros netos del turno no excede 9000000000000 centavos, dentro del rango entero exacto de JavaScript.

Referencias: máximo 80 caracteres, normalizadas con espacios exteriores eliminados y mayúsculas. Referencia de turno única; referencia de cobro única global incluso después del cierre o reverso. `operationReference` es opcional, una referencia administrativa opaca para conciliación manual: no es una FK ni una verificación de existencia de cita/paciente y no debe contener nombres ni datos clínicos. Puede repetirse para varios cobros de una operación. `reason`: obligatorio, máximo 240 caracteres, para cierre/reverso.

## Cálculo y concurrencia

Hay un único turno abierto por consultorio. Un índice único parcial respalda esta regla incluso con aperturas concurrentes. Cada cobro, reverso y cierre adquiere el mismo bloqueo de fila del turno dentro de la transacción de `CommandService`. Un cierre incluye exactamente los movimientos confirmados antes de adquirir el bloqueo; una escritura posterior recibe 409 `SHIFT_CLOSED`.

Los totales por método excluyen cobros revertidos. `expectedCashCents = openingFloatCents + cashTotalCents`. Tarjetas y transferencias se revisan por separado y no incrementan el efectivo esperado. En cierre, `differenceCents = countedCashCents - expectedCashCents`: negativo significa faltante; positivo, sobrante. El cierre conserva el efectivo esperado, el conteo, el motivo, el usuario y el momento. No se reabre ni modifica el cierre por esta API.

Un reverso es otro registro inmutable enlazado al cobro original, con usuario, motivo y momento; no elimina ni modifica el pago ni ejecuta devolución financiera. Solo puede registrarse una vez mientras el turno esté abierto. La corrección de un cobro requiere el reverso autorizado y, si corresponde, un nuevo cobro con referencia nueva. Correcciones de turnos cerrados y devoluciones reales requieren definir una política operativa antes de habilitar un flujo adicional.

La base protege cobros, reversos y auditoría contra UPDATE/DELETE. El turno protege datos originales y solo admite su primer cierre. Las escrituras y eventos `CASH_SHIFT_OPENED`, `CASH_PAYMENT_RECORDED`, `CASH_PAYMENT_REVERSED`, `CASH_SHIFT_CLOSED` se confirman o revierten juntos. No hay endpoints de edición ni borrado de historia.

La clave idempotente une usuario, operación/ruta y cuerpo normalizado. Un reintento idéntico retorna la respuesta original, incluso después del cierre o de un reverso posterior. Reutilizar clave para otro cuerpo, operación o usuario devuelve 409 `IDEMPOTENCY_CONFLICT`. Después de resolver una respuesta perdida, la interfaz debe refrescar el GET del turno/historial para ver el estado actual. Un comando fallido revierte también la clave y puede corregirse o reintentarse.

## Errores y verificación

400: campos, dinero o paginación inválidos; `CASH_LIMIT` si el cobro supera el límite agregado. 401: identidad ausente/inválida. 403: rol sin permiso. 404: turno/cobro inexistente. 409: turno cerrado, turno ya abierto, cobro ya revertido, referencia repetida o clave idempotente reutilizada. Un conflicto simultáneo de apertura puede manifestarse como `DATA_CONFLICT` por el índice único; ambos usuarios deben refrescar turnos.

`CashApiTest` prueba HTTP real, JWT firmado efímero y PostgreSQL: permisos, centavos exactos, persistencia, normalización, referencias únicas, reversos, inmutabilidad, conteo/diferencia, reintentos, concurrencia de apertura, pago/cierre y reverso/cierre. Ejecutar exclusivamente en base desechable mediante `TEST_DB_URL`, `TEST_DB_USER`, `TEST_DB_PASSWORD`; el coordinador ejecuta las suites de forma secuencial.

El fixture de caja trunca exclusivamente `cash_reversal`, `cash_payment`, `cash_shift`; deja `inventory_command` y `audit_event` para no borrar la historia de otros módulos. Cada solicitud utiliza UUID nuevo y las aserciones de auditoría filtran por comando. Los fixtures antiguos que truncan `inventory_command CASCADE` también truncarán caja por sus FK: son seguros solo en una BD exclusiva y con suites no concurrentes. V4 no incorpora FK hacia pacientes, agenda ni equipos, por lo que no requiere cambios de limpieza en V3/V5.

Este documento describe implementación y alcance; el resultado de la ejecución debe registrarse por el coordinador y no se presupone por la existencia de la suite.
