# Compras privadas · v0.4.0

Contrato para integrar el portal privado. Las llamadas requieren JWT válido y los permisos descritos debajo. No conectarlo al panel público de ejemplos ni introducir credenciales en GitHub Pages. El servidor no envía pedidos al proveedor ni efectúa pagos.

## Permisos y rutas

Prefijo: `/api/v1/purchasing`. Todas las escrituras requieren `Idempotency-Key: <UUID>` y JSON. Los listados aceptan `limit` (1–100, predeterminado 50) y `offset` (0–1 000 000), y devuelven `{items, limit, offset}`.

| Método / ruta | ADMIN | FARMACIA | AUDITOR | Resultado |
| --- | --- | --- | --- | --- |
| GET /suppliers | Sí | Sí | Sí | Proveedores ordenados por referencia |
| POST /suppliers | Sí | No | No | 201, proveedor creado |
| GET /orders | Sí | Sí | Sí | Resúmenes; filtro opcional `supplierId` |
| GET /orders/{id} | Sí | Sí | Sí | Orden con partidas, cantidades y costos |
| POST /orders | Sí | Sí | No | 201, orden y partidas creadas, stock intacto |
| POST /orders/{id}/receipts | Sí | Sí | No | 201, recepción registrada y stock actualizado |
| POST /orders/{id}/cancel | Sí | No | No | 200, orden con saldo pendiente cancelado |
| GET /receipts | Sí | Sí | Sí | Historia; filtros opcionales `orderId` y `lotId` |

RECEPCION no accede a estas rutas. No hay endpoints de eliminación ni edición de una compra confirmada. La identidad registrada procede del `sub` del token; no se acepta un actor elegido por el cliente.

## Recorrido de integración

1. ADMIN crea el proveedor. Referencia interna única de hasta 80 caracteres; nombre de hasta 160. Se recortan espacios y la referencia se normaliza a mayúsculas.

```json
{"reference":"PROV-DEMO-01","name":"Proveedor de demostración"}
```

2. Consultar el catálogo de `/api/v1/inventory/products`. Los productos los crea ADMIN según el contrato de inventario. Crear una orden usando IDs existentes de proveedor/producto y una fecha esperada no anterior al día actual en `America/Mexico_City`.

```json
{
  "reference":"OC-DEMO-01",
  "supplierId":"<UUID del proveedor>",
  "expectedOn":"<AAAA-MM-DD>",
  "lines":[
    {"productId":"<UUID del producto>","quantity":10,"unitCostCents":12550}
  ]
}
```

Los marcadores deben sustituirse por valores válidos. Son de 1 a 100 partidas, sin repetir productos. Cantidad entera de 1 a 1 000 000; costo entero de 1 a 100 000 000 centavos por unidad. Total de orden máximo: 9 000 000 000 000 centavos. La moneda es MXN, determinada por servidor; no se calculan impuestos, descuentos ni conversiones caja/pieza. El costo corresponde a una unidad del catálogo. SKU, nombre, categoría, unidad y costo quedan conservados en la partida.

La respuesta contiene `id`, `reference`, `supplierId`, `orderDate`, `expectedOn`, `currency`, `status`, `cancellationReason`, `lines`, `totalCents`, `receivedCents` y `pendingCents`. Cada partida tiene su propio `id`, `productId`, datos del producto, `ordered`, `received` y `unitCostCents`. Crear la orden no crea lotes ni movimientos.

3. Usar el `id` de una partida para confirmar una entrega. **Una recepción corresponde a una partida y a un lote.** Si llegan varios productos o lotes, registrar una recepción por combinación, con folio interno único y una nueva clave. El folio identifica esta operación, no una factura completa del proveedor.

```json
{
  "reference":"REC-DEMO-01",
  "lineId":"<UUID de la partida>",
  "quantity":4,
  "batch":"LOTE-DEMO-A",
  "expiresOn":"<AAAA-MM-DD vigente>",
  "quarantined":false
}
```

La cantidad debe ser positiva y no superar lo pendiente. La partida debe pertenecer a la orden. Farmacia requiere caducidad; un insumo no perecedero puede usar `null`. No se admite mercancía caducada. `quarantined` es obligatorio. Un lote nuevo se crea en esta transacción; si ya existe para ese producto, deben coincidir su caducidad y condición actual. Una recepción no cambia esas condiciones. Recibir en cuarentena mantiene el lote bloqueado para salidas.

El servidor toma el costo de la partida, sin admitir otro desde la recepción. Devuelve el folio con `id`, `orderId`, `lineId`, `lotId`, `movementId`, `batch`, `expiresOn`, `quarantined`, `quantity`, `unitCostCents`, `actor` y `receivedAt`. Es una instantánea histórica: para conocer disponibilidad/cuarentena actuales hay que consultar el lote.

4. Volver a consultar la orden y el lote para presentar los saldos actualizados. Usar los filtros de `/receipts` para mostrar la trazabilidad desde ambos.

5. Si se cancela lo pendiente, ADMIN envía un motivo de 1 a 240 caracteres:

```json
{"reason":"El proveedor no entregará las unidades pendientes del ejemplo"}
```

La orden queda CANCELLED. `pendingCents` pasa a cero; `totalCents`, `receivedCents`, cantidades y recepciones previas se conservan. No se retira stock. Una orden completa no tiene saldo para cancelar. Las devoluciones y correcciones de recepciones necesitan un flujo adicional; cancelar no las sustituye.

## Estados e importes

| Estado | Significado | Saldo pendiente |
| --- | --- | --- |
| PENDING | Ninguna unidad recibida | Total ordenado |
| PARTIAL | Al menos una entrega y unidades por recibir | Ordenado menos recibido |
| RECEIVED | Todas las partidas recibidas | Cero |
| CANCELLED | ADMIN cerró lo pendiente, con motivo | Cero; se conserva lo ya recibido |

Los importes son sumas exactas en centavos. `receivedCents` mide las entregas al costo acordado; no es un cobro, una cuenta por pagar ni la valoración del stock actual después de las salidas.

## Reintentos, concurrencia y errores

- La clave se comparte con inventario: generar un UUID nuevo para cada operación. Misma clave, identidad, ruta/operación y cuerpo normalizado devuelve el resultado original sin volver a afectar stock. El resultado original puede describir una orden que después cambió; refrescar con GET.
- Misma clave con otros datos, usuario u operación: 409 `IDEMPOTENCY_CONFLICT`. Un error revierte también la reserva de la clave.
- Folio ya registrado con una clave nueva: 409 por duplicado. No se interpreta automáticamente como otra recepción, ni se duplica stock. El portal debe conservar la clave cuando se interrumpe la respuesta y reintentar con ella.
- Se bloquea primero la orden y después el lote. Entregas simultáneas de la última unidad pendiente solo permiten una recepción. Órdenes distintas pueden aumentar un mismo lote sin crear dos lotes ni perder unidades.
- Cancelar y recibir simultáneamente tiene un resultado serializado: si la entrega llegó primero, se conserva y se cancela el resto; si la cancelación llegó primero, la entrega se rechaza.
- Orden cancelada: 409 `ORDER_CANCELLED`; exceso de entrega: 409 `OVER_RECEIPT`; cancelar una completa: 409 `ORDER_COMPLETE`; condición/caducidad del lote distinta: 409 `LOT_CONDITION_MISMATCH`; lote caducado: 409 `LOT_EXPIRED`.
- Referencia/cuerpo/cantidad/costo/fecha inválidos o caducidad obligatoria ausente: 400. Proveedor, producto, orden o partida inexistentes: 404. Sin autenticación: 401; rol insuficiente: 403. Campos JSON desconocidos y cantidades fraccionarias se rechazan.

Cada entrega confirma clave, lote, movimiento, recepción, saldo de la partida y auditoría juntos. Los triggers rechazan UPDATE/DELETE de recepciones, movimientos y eventos; esto no impide que un administrador de BD con DDL altere el esquema. Las restricciones e índices están en `V2__purchasing.sql`; V1 permanece intacta.

La suite HTTP `PurchasingApiTest` cubre los rechazos, reintentos y carreras anteriores contra PostgreSQL. `MigrationUpgradeTest` aplica V1, inserta stock/historia sintéticos y después aplica V2, comprobando que se conservan. Ver [validación de la entrega](../../docs/VALIDATION.md) para la ejecución comprobada y sus límites.

Referencias técnicas: [bloqueos en PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html), [INSERT ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html), [propagación transaccional de Spring](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html).
