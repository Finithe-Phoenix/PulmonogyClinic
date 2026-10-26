# Conteo e importación sintética · ensayo v1

Estado: **planificador en seco y procedimiento, no importador productivo**. No se ha cargado esta plantilla al servidor ni se ha realizado un conteo humano por crear estos archivos. El planificador no tiene cliente HTTP, acceso a BD, credenciales, comandos externos ni funciones de escritura de archivos. No proporciona `--apply`.

Alcance MIG-01: catálogo, lotes/conteos y pacientes administrativos ficticios. No importa agenda, expedientes, documentos, compras históricas, costos, cobros ni saldos bancarios. No transforma una devolución en un ajuste de inventario. Las reglas de esos procesos siguen pendientes de acuerdo operativo.

Decisión de producto: **el portal es la agenda principal; Doctoralia se usa solo para exposición y captación**. Un contacto originado en ese canal se registra y concilia manualmente en el portal. Este ensayo no importa Doctoralia, no sincroniza agendas ni le atribuye funciones de expediente/operación clínica. Tampoco autoriza contratar una integración.

## 1. Preparar y validar sin tocar servicios

Desde la raíz del proyecto, con Node 24:

```text
node scripts/plan-synthetic-import.mjs --input fixtures/import/v1 --as-of 2026-09-28
node --test tests/import-plan.test.ts
```

No requiere Docker ni un portal abierto. El primer comando emite JSON a stdout; no crea ni sobrescribe reportes. La fecha de corte es explícita: repetir exactamente los archivos y fecha produce el mismo plan. Para otro ensayo, elegir conscientemente otra fecha; el plan no verifica la fecha actual del servidor. Una recepción posterior debe volver a validar la caducidad y las condiciones reales de ese momento.

Exit code `0`: estructura válida **para revisión**, no autorización ni carga. Exit code `2`: archivos/argumentos/datos rechazados. Una carpeta con errores queda `BLOCKED` completa: los ítems válidos retenidos para diagnóstico tampoco deben ejecutarse. Las advertencias también requieren una decisión registrada antes de continuar manualmente.

Propiedades permanentes del reporte:

```json
{
  "mode": "DRY_RUN",
  "executionAllowed": false,
  "databaseChecked": false,
  "importedRecords": 0,
  "status": "READY_FOR_REVIEW"
}
```

`READY_FOR_REVIEW` no cambia las otras cuatro propiedades. El reporte incluye conteos, errores con archivo/registro/campo/código, duplicados omitidos, advertencias, propuestas y SHA-256 de entradas/filas/plan. El número de registro es lógico, incluido encabezado como registro 1; no necesariamente coincide con la línea física de un CSV con comillas y saltos de línea.

No introducir información real ni siquiera marcando `synthetic=true`: esa declaración **no anonimiza ni detecta PII**. El reporte contiene los valores sintéticos normalizados. Abrir las plantillas en un editor de texto; el parser no ejecuta fórmulas de hojas de cálculo. No pegar reportes privados ni secretos en repositorios o conversaciones.

## 2. Contrato de carpeta v1

La [plantilla versionada](../fixtures/import/v1/manifest.json) contiene cuatro archivos regulares UTF-8, sin enlaces simbólicos. Manifest máximo 4 KiB; cada CSV máximo 256 KiB, 500 filas de datos y 4096 caracteres por celda antes de validar límites específicos. Admite BOM inicial, coma, LF/CRLF, campos entrecomillados y comillas escapadas `""`. Los textos de negocio no admiten controles/saltos de línea, aunque el parser pueda reconocerlos. No admite CSV delimitado por punto y coma, campos adicionales, encabezados reordenados, filas vacías intermedias ni coerciones numéricas.

`manifest.json` tiene exclusivamente:

```json
{"schemaVersion":1,"synthetic":true,"sourceSystem":"SYNTHETIC-PILOT-V1"}
```

`sourceSystem` y cada `sourceId`: 1–64 caracteres A–Z, dígitos, `.`, `_` o `-`; primer carácter alfanumérico. La clave de procedencia es `sourceSystem/tipo/sourceId`. Es estable para el mismo objeto, no un UUID de BD ni una clave idempotente de API. No cambiarla para ocultar un duplicado. No se persiste en el backend actual: requiere una tabla de conciliación manual hasta diseñar una importación autorizada.

### products.csv

```csv
sourceId,sku,name,category,unit,minimumStock,synthetic
```

- SKU normalizado a mayúsculas, 2–40 letras/dígitos/guiones; nombre hasta 160; unidad hasta 40.
- Categoría exacta `INSUMOS` o `FARMACIA`; mínimo entero 0–1000000.
- `synthetic` debe ser literalmente `true` en cada fila.
- Una unidad representa la del catálogo: no se convierte caja a pieza, mililitro a frasco ni presentación comercial. Categoría FARMACIA en una prueba no habilita dispensación clínica.

### lots.csv

```csv
sourceId,productSourceId,targetLotId,batch,expiresOn,quarantined,recordedQuantity,countedQuantity,reason,synthetic
```

- `productSourceId` debe referir a un producto válido del mismo archivo. Lote hasta 80 caracteres, normalizado a mayúsculas; identidad comercial = SKU + lote, no solo lote.
- `expiresOn`: vacío o fecha ISO válida; obligatorio en FARMACIA. `quarantined`: `true` o `false` explícito.
- Para un lote nuevo, `targetLotId` vacío y `recordedQuantity=0`. Crear lote en la API no incorpora unidades.
- Para revisar un lote existente, `targetLotId` es un UUID previamente comprobado; `recordedQuantity` es la fotografía del saldo tomado por el operador. **El plan no verifica** que ese ID exista, pertenezca al producto o tenga el saldo/condición/caducidad indicados. Siempre genera `UNVERIFIED_SNAPSHOT`.
- Saldo registrado/contado: enteros entre 0 y 1000000000; diferencia absoluta máxima 1000000, límite de un movimiento. Cantidades mayores requieren otro diseño revisado; no se fragmentan automáticamente.
- `reason` obligatorio, máximo 240 caracteres, identifica sesión de conteo y evidencia ficticia. No incluye datos clínicos.
- Diferencia positiva propone revisar una entrada; caducado + diferencia positiva se rechaza porque el servidor no acepta esa entrada. Diferencia cero propone no mover stock. Diferencia negativa propone **investigar y autorizar**, sin elegir salida/baja/devolución automáticamente.

### patients.csv

```csv
sourceId,reference,fullName,birthDate,phone,email,synthetic
```

- Referencia normalizada de 2–40 letras/dígitos/guiones; nombre hasta 160; nacimiento ISO desde corte menos 130 años hasta corte.
- Teléfono opcional, 7–30 caracteres del contrato; correo opcional hasta 160 y terminado en `.invalid`, restricción adicional deliberada del ensayo.
- Detecta coincidencia por nombre normalizado sin acentos o nacimiento y teléfono juntos. Advierte, no fusiona. No decide identidad por homonimia; `duplicateReviewed` permanece `false` en la propuesta.
- Sin CURP, domicilio, diagnóstico, nota clínica, expediente o documentos. El servidor vuelve a exigir `synthetic:true` y revisar candidatos actuales, no solo los del archivo.

## 3. Deduplicación y conciliación obligatoria

| Situación | Resultado del plan | Decisión humana posterior |
| --- | --- | --- |
| Mismo ID de fuente y contenido normalizado idéntico | Una propuesta y `IGNORED_IDENTICAL_SOURCE` | Revisar que sea duplicación accidental de fila |
| Mismo ID de fuente, datos diferentes | `SOURCE_CONFLICT`; lote de importación completo bloqueado | Resolver cuál versión documentada corresponde, sin elegir la última automáticamente |
| Distintos IDs con mismo SKU/referencia/producto-lote | `BUSINESS_KEY_CONFLICT`; bloqueado | Revisar correspondencia y fuente; no fusionar |
| Un UUID de lote existente en dos conteos | `TARGET_CONFLICT`; bloqueado | Conciliar y repetir conteo |
| Nombre o nacimiento/teléfono coincidentes | Advertencia `POSSIBLE_DUPLICATE` | Comparación administrativa humana y consulta de candidatos del servidor |
| Referencia ya cargada en el servidor en otro ensayo | **No detectable sin consulta** | Buscar todas las páginas pertinentes y cotejar historial/mapeo antes de otra alta |

Repetir el comando en seco solo repite el plan; no detecta una ejecución manual anterior. `planFingerprint` no prueba que se importó, no firma una aprobación y no reemplaza las claves UUID de cada comando real. El CSV exportado por el portal es parcial —solo la página visible— y no es automáticamente un snapshot completo ni coincide con este esquema de entrada.

Registro mínimo del ensayo, inicialmente sin completar:

| Clave de fuente | Huella de fila/plan | Decisión y responsable | UUID destino verificado | Saldo antes / contado / después | Evidencia de operación/historial |
| --- | --- | --- | --- | --- | --- |
| Pendiente | Pendiente | NO REVISADO | NO ASIGNADO | NO EJECUTADO | NO EJECUTADO |

Conciliar por lote y por SKU/unidad, nunca sumar indiscriminadamente unidades distintas. Registrar totales de filas leídas, aceptadas, duplicadas, rechazadas, revisadas y efectivamente capturadas: son medidas distintas. Para los fixtures v1, solo el plan contiene 2 productos, 2 lotes y 2 pacientes; propuesta inicial de lotes: 12 y 4 unidades respectivamente.

## 4. Ensayo manual de conteo inicial, separado del plan

Solo tras aprobación del facilitador, con cuentas sintéticas y [entrada al piloto](PILOT_RUNBOOK.md). El script no realiza ninguno de estos pasos.

1. Reservar un identificador de ensayo y comprobar que el catálogo/lotes/turno de caja no pertenecen a otra prueba activa. No truncar ni reiniciar una base para limpiar referencias.
2. Elegir un corte y suspender movimientos del ámbito que se contará. Registrar inicio, operador y segundo revisor. Si entró/salió material durante el conteo, documentarlo y volver a contar; no inferir el saldo.
3. Comparar el plan con catálogo y lotes actuales: SKU, unidad, producto/lote, caducidad y condición. Si un registro ya existe, mapearlo; no recrearlo con otro nombre. La UI/API actual no edita SKU/unidad/batch/caducidad de un alta: un error de estos campos requiere detener la incorporación y acordar tratamiento, no SQL correctivo.
4. ADMIN crea únicamente productos inexistentes. ADMIN/FARMACIA crea los lotes vacíos aprobados. Verificar saldo cero, caducidad y cuarentena antes del movimiento.
5. Contar dos veces unidades ficticias. Registrar el conteo y razón con ID de ensayo/fuente. Para saldo inicial positivo no caducado, confirmar una Entrada (`RECEIPT`) de la cantidad aprobada; el backend registra actor y hora actuales. No backdatear ni fabricar una compra histórica.
6. Reconsultar lote, movimientos y auditoría: saldo inicial + entradas − salidas − bajas debe igualar saldo actual. Una condición de cuarentena no desaparece al recibir unidades. Documentar UUIDs retornados; no asignar UUIDs inventados como si fueran del servidor.
7. Si se perdió una respuesta, conservar la pestaña/comando y reintentar con el mismo UUID y cuerpo desde el portal. No hacer otra Entrada con clave nueva hasta resolver la incertidumbre.
8. Una vez conciliados todos los lotes del ámbito, registrar cierre del conteo y reanudar solo ese ámbito. Diferencias sin explicar impiden aprobar la carga.

## 5. Correcciones sin cambiar historia

Volver a contar antes de corregir. Una diferencia no demuestra consumo, daño, devolución ni error de captura. Conservar la fila original de conteo y registrar otra revisión con motivo, referencia a la evidencia y autorizador; no modificar movimientos, recepciones o auditoría por SQL ni borrar comandos.

En un ensayo explícitamente autorizado puede demostrarse una nueva Entrada por faltante de incorporación o una Baja (`DISPOSAL`, solo ADMIN) por la corrección sintética acordada. Una salida (`ISSUE`) no sustituye una baja administrativa: la API la bloquea en cuarentena/caducidad, y la elección debe corresponder a la causa aprobada. No convertir la diferencia negativa del CSV en ninguna de ellas automáticamente.

La nueva operación conserva su propio UUID, cantidad positiva y motivo; el saldo negativo se impide en servidor. Si un movimiento confirmado fue incorrecto, no reutilizar su clave con otro cuerpo: eso es `IDEMPOTENCY_CONFLICT`, no edición. La compensación aprobada es otra operación y debe quedar vinculada por motivo/registro de conciliación. Para lotes caducados solo existe la baja administrativa; no “liberarlos” para admitir entradas/salidas. Estos son límites implementados, no una política clínica de disposición.

**No disponible:** importar una compra histórica con costo arbitrario al lote, corregir una recepción ya confirmada, devolución a proveedor/paciente, valoración contable, reapertura de caja o transformación de unidades. Escalar y acordar el flujo/documentos/roles antes de implementarlo. Cancelar saldo de compra conserva entregas previas y no devuelve stock.

## 6. Evidencia local de este entregable

El 28/09/2026 se ejecutaron exclusivamente el comando en seco de arriba y `node --test tests/import-plan.test.ts`: **12 pruebas aprobadas**, sin red ni BD. El fixture produjo 6 propuestas, 0 errores, 0 advertencias, 0 duplicados e `importedRecords:0`. Huella de plan para ese corte:

```text
67cf9a9c6f2e282183c3d9f87029a0f10c79e1407cdeed613dfc7c1091f62313
```

No es evidencia de importación, conteo físico, aceptación clínica o piloto humano. Contratos alineados: [inventario](../backend/src/main/java/mx/denova/clinic/inventory/InventoryModels.java), [movimientos](../backend/src/main/java/mx/denova/clinic/inventory/InventoryService.java), [pacientes/agenda](../backend/docs/OPERATIONS_API.md), [compras](../backend/docs/PURCHASING_API.md) y [caja](../backend/docs/CASH_API.md).
