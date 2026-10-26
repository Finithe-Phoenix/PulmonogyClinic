# Búsqueda de inventario y compras

La búsqueda se realiza en PostgreSQL antes de aplicar `limit` y `offset`. Un registro fuera de las primeras 50 filas puede encontrarse directamente sin descargar todo el catálogo.

| Consulta | Campos de búsqueda `q` | Filtros que se conservan |
| --- | --- | --- |
| GET `/api/v1/inventory/products` | SKU, nombre, categoría (`FARMACIA` / `INSUMOS`) | `limit`, `offset` |
| GET `/api/v1/inventory/lots` | Lote, SKU y nombre del producto relacionado | `productId`, `availableOnly`, `limit`, `offset` |
| GET `/api/v1/purchasing/suppliers` | Referencia y nombre de proveedor | `limit`, `offset` |
| GET `/api/v1/purchasing/orders` | Folio de orden, referencia y nombre de proveedor | `supplierId`, `limit`, `offset` |

`q` es opcional y admite hasta 160 caracteres después de quitar espacios exteriores. La coincidencia es parcial y no distingue mayúsculas; conserva los acentos. `%`, `_` y `\` se buscan literalmente y no son comodines. Un valor omitido, vacío o compuesto solo por espacios mantiene el listado normal. El cliente debe codificar el parámetro con `URLSearchParams` o equivalente; por ejemplo, un porcentaje se transmite como `%25`.

Los filtros se combinan: buscar un lote por nombre no omite `productId` ni permite lotes en cuarentena, vacíos o caducados cuando `availableOnly=true`. Buscar una orden no elimina el filtro de proveedor ni cambia sus importes o cantidades.

Las respuestas siguen usando `{items,limit,offset}`; `limit` vale 50 de forma predeterminada y admite 1–100. `offset` admite 0–1000000. Si se cambia la búsqueda, la interfaz debe reiniciar `offset` a cero. Se mantienen los órdenes establecidos: productos por SKU, proveedores por referencia, lotes por caducidad con fechas vacías al final, órdenes por fecha de creación descendente. Los desempates usan ID.

Ejemplos:

```text
GET /api/v1/inventory/products?q=inhalador&limit=25&offset=0
GET /api/v1/inventory/lots?q=inhalador&availableOnly=true&limit=25
GET /api/v1/purchasing/suppliers?q=distribuidor
GET /api/v1/purchasing/orders?q=distribuidor&supplierId=<UUID>
```

Un texto de más de 160 caracteres produce `400 INVALID_SEARCH`. Los límites inválidos conservan sus errores existentes. La búsqueda no modifica los permisos: ADMIN, FARMACIA y AUDITOR tienen lectura; RECEPCION no tiene acceso a estos módulos. No cambia ninguna ruta de escritura ni las migraciones V1/V2.

## Datos de producto en lotes

GET `/api/v1/inventory/lots` y `/api/v1/inventory/lots/{id}` devuelven la vista de lectura `LotView`:

```json
{
  "id": "<UUID del lote>",
  "productId": "<UUID del producto>",
  "batch": "LOTE-DEMO-A",
  "expiresOn": null,
  "quantity": 4,
  "quarantined": false,
  "productName": "Producto sintético",
  "productSku": "DEMO-01"
}
```

Los dos campos nuevos se obtienen con un JOIN en la misma consulta de lectura; no se hace una consulta por fila. Las respuestas POST de alta y cuarentena mantienen el modelo `Lot` previo sin estos campos. Se conservan sus constructores y respuestas guardadas de idempotencia.

GET `/api/v1/inventory/products/{id}` permite resolver los datos completos de cualquier producto, aunque no esté en la página cargada. Devuelve `{id,sku,name,category,unit,minimumStock}`, requiere los mismos permisos de lectura y devuelve 404 si no existe. Es útil para una vista detallada; no hace falta invocarlo por fila en una tabla de lotes.

## Pruebas

`InventoryPurchasingSearchApiTest` usa HTTP, JWT firmado y PostgreSQL real. Prepara más de 50 registros en cada listado para probar que la búsqueda encuentra resultados posteriores a la primera página; verifica filtros combinados, importes de órdenes con varias partidas, caracteres literales, límites, consultas vacías y permisos del detalle de producto. Verifica también que el nombre y SKU aparecen en lotes cuyo producto está fuera de la página inicial.

La base configurada por `TEST_DB_URL`/`TEST_DB_USER`/`TEST_DB_PASSWORD` debe ser exclusivamente desechable: el fixture trunca tablas. La ejecución corresponde a la corrida coordinada del backend; la existencia de estos casos no acredita que hayan pasado.

```powershell
mvn -Dtest=InventoryPurchasingSearchApiTest test
```
