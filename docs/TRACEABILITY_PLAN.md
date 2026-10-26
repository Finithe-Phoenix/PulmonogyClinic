# Trazabilidad navegable de compras e inventario

Estado: **PENDIENTE DE IMPLEMENTACIÓN Y VALIDACIÓN**. Esta propuesta no añade rutas, contratos ni relaciones nuevas al sistema ejecutado. La corrección independiente del estado de error del historial de inventario no implementa este plan.

## Evidencia del estado actual

- `backend/src/main/java/mx/denova/clinic/purchasing/PurchasingModels.java`: `Receipt` ya conserva `id`, `reference`, `orderId`, `lineId`, `lotId`, `movementId`, `batch`, `expiresOn`, `quarantined`, `quantity`, `unitCostCents`, `actor` y `receivedAt`. Las recepciones se relacionan por UUID, no por texto de motivo.
- `src/portal/api.ts`: la interfaz `Receipt` del frontend solo declara `id`, `reference`, `orderId`, `batch`, `quantity` y `actor`; omite relaciones existentes en la API.
- `src/app/portal/purchases.html`: la tabla de recepciones muestra folio, lote y unidades, sin navegación al lote o movimiento. Un mismo identificador de lote puede pertenecer a productos distintos; no es una clave global.
- `src/app/portal/inventory.ts`: únicamente interpreta `vista=lotes` al construir el componente; no resuelve enlaces por UUID de lote o movimiento. El detalle de inventario no presenta las recepciones de origen.
- `InventoryController` expone el detalle de lote y movimientos paginados por lote; no expone lectura individual de un movimiento. `PurchasingController` ya permite filtrar recepciones por `orderId` o `lotId` con `limit` y `offset`.
- Las pruebas actuales de compras cubren recepción parcial, atomicidad y filtros. El recorrido de UI encuentra manualmente el lote; esto no demuestra una navegación enlazada compra → recepción → lote → movimiento.

## Alcance mínimo propuesto

### 1. Contratos frontend sin modificar persistencia

Archivo: `src/portal/api.ts`.

Ampliar `Receipt` con los campos que ya devuelve el backend. No alterar la representación de comandos ni duplicar estado persistido. Resolver el producto de cada recepción mediante `lineId` y las líneas de la orden abierta, evitando una petición por fila. Si se muestra SKU, declararlo solo si el contrato de la línea lo devuelve; el nombre e ID existentes bastan para la primera entrega.

### 2. Compra a lote y movimiento

Archivos: `src/app/portal/purchases.ts` y `purchases.html`.

Mostrar en cada recepción producto, folio, fecha, identidad, cantidad y costo unitario histórico, con un enlace por identificadores:

```text
/inventario?vista=lotes&lote=<lotId>&movimiento=<movementId>
```

Usar Angular Router y su serialización de parámetros, no concatenación de HTML. Mantener la paginación de recepciones. Conservar la orden y el offset de origen en parámetros validados para que regresar desde el lote restaure, por ejemplo, la segunda página; nunca aceptar una URL externa como destino de retorno. El formato real en el navegador respetará la estrategia de rutas hash existente.

### 3. Detalle de lote enlazable y origen

Archivos: `src/app/portal/inventory.ts` y `inventory.html`.

Observar cambios en `queryParamMap`, no solo el snapshot inicial. Validar UUID antes de consultar `GET /api/v1/inventory/lots/{id}`. Representar carga, 400/404, denegación y error de red de forma explícita. No buscar el lote por nombre, batch ni recorriendo la primera página. Al cerrar el detalle limpiar sus parámetros sin perder los filtros de la lista.

Consultar el origen con la API existente:

```text
GET /api/v1/purchasing/receipts?lotId=<id>&limit=26&offset=<n>
```

Presentar como máximo 25 registros por página y usar el adicional solo para indicar siguiente página. Cada recepción enlaza a su orden mediante `orderId` y permite seleccionar su `movementId`. Una entrada manual legítima puede no tener recepción de compra: mostrar esa ausencia como tal, sin inventar procedencia. Conservar filtros, paginación y selección al regresar.

Todas las respuestas asíncronas deben comprobar consulta activa, identidad y vida del componente; cambiar de lote o cerrar no puede permitir que una respuesta tardía sustituya otro detalle. No usar `ClinicApi.list()` para descargar todas las páginas.

### 4. Único endpoint nuevo necesario

Archivos: `backend/src/main/java/mx/denova/clinic/api/InventoryController.java`, `inventory/InventoryService.java`, documentación de inventario y pruebas HTTP.

```text
GET /api/v1/inventory/lots/{lotId}/movements/{movementId}
200: Movement actual, sin campos clínicos nuevos
400: identificador mal formado
404: movimiento ausente o perteneciente a otro lote
401/403: misma política existente de inventario
```

Consultar por ambos UUID con SQL parametrizado. Mantener el DTO `Movement` existente: `id`, `lotId`, `kind`, `quantity`, `balanceAfter`, `reason`, `actor`, `createdAt`. No requiere migración ni modificación de la historia.

El movimiento seleccionado debe poder verse aunque sea anterior a la página actual del historial. Mostrarlo de forma diferenciada, sin reemplazar silenciosamente el historial paginado. Etiquetar `balanceAfter` como saldo después de ese movimiento; no confundirlo con la existencia actual del lote.

No hace falta un endpoint individual de recepción para esta fase: los filtros paginados existentes proporcionan sus relaciones. Tampoco hace falta inferirlas del campo `reason` ni añadir escrituras de trazabilidad.

## RBAC y límites

- Conservar acceso de lectura a inventario y compras para `ADMIN`, `FARMACIA` y `AUDITOR`, de acuerdo con la configuración actual. No ampliar permisos a `RECEPCION` ni `MEDICO` para hacer funcionar enlaces.
- Mantener al auditor en modo lectura: navegar no habilita altas, recepciones ni movimientos.
- Los guards de UI no sustituyen autorización del servidor. No debe ser necesario modificar `SecurityConfiguration` si el nuevo GET queda bajo la política existente de `/api/v1/inventory/**`; verificarlo mediante pruebas.
- Sin cambios a V1/V2, a la contabilidad de stock, a la atomicidad de recepciones ni a idempotencia. Sin datos reales, importación, integración con terceros o publicación implícita.

## Secuencia y criterios de aceptación pendientes

1. Ampliar tipos de lectura y añadir el GET individual protegido; verificar 200, UUID mal formado, lote incompatible, inexistente, 401 y 403, incluyendo lectura permitida a auditor.
2. Integrar enlaces de compra, apertura por UUID y recepción de origen con paginación independiente.
3. Mantener pruebas E2E con dos productos que compartan batch, una recepción en la segunda página y un movimiento antiguo fuera de la primera página. Comprobar UUID, producto, cantidades, identidad y orden correctos.
4. Probar retorno, recarga del enlace, enlaces inválidos, error recuperable, respuesta tardía A → B, cambio de sujeto y navegación de auditor sin controles de escritura.
5. Verificar un número acotado de peticiones por página, sin N+1 ni exportaciones silenciosamente completas; comprobar móvil y escritorio, teclado y mensajes de estado.
6. Ejecutar build, pruebas API y suite privada coordinadamente. Registrar evidencia ejecutada antes de cambiar este documento a implementado. La revisión estática o la existencia del plan no satisfacen esa condición.
