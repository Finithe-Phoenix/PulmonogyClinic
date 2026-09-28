# Arquitectura y límites · v0.4.0

## Decisiones ejecutadas

- Angular 21 LTS, componentes standalone y estado con signals. Compilación estática para GitHub Pages.
- Un sitio propuesto y nueve vistas de operación, navegación por fragmentos para evitar errores de recarga en Pages.
- Reglas puras separadas de la interfaz en `src/app/domain.ts`; dinero en centavos enteros.
- Datos exclusivamente sintéticos. Persistencia de demostración en `localStorage`, sin transmisión al consultorio.
- Versión 2 del estado: agrega proveedores, órdenes y recepciones; migra el estado v1 conservando pacientes, notas, caja y stock. Se mantiene la clave de almacenamiento existente para poder reconocer los ejemplos anteriores.
- Las compras conservan cantidades pedidas/recibidas y costos por partida. Cada recepción enlaza orden, partida, lote y movimiento; un folio repetido con los mismos datos devuelve el estado existente. Un folio con otros datos se rechaza. Son invariantes secuenciales de la demo; el módulo privado implementa por separado transacciones y concurrencia.
- CSV con escape de comillas y neutralización de prefijos de fórmulas; interpolación Angular, sin HTML de usuario.
- Documentos de consulta de ejemplo cerrados conservan el contenido desde la interfaz; las correcciones se agregan como adendas. Esto no implementa firma electrónica ni inmutabilidad del almacenamiento.
- Sin rastreadores, fuentes externas, formularios de captación, credenciales ni fotos de terceros. SVG decorativo propio y marca provisional.

## API privada implementada

`backend/` contiene Java 21 / Spring Boot 4.0.8, PostgreSQL 17 y migraciones Flyway V1/V2. Inventario y compras se exponen mediante REST autenticado por JWT. Roles ADMIN/FARMACIA/AUDITOR/RECEPCION se aplican en servidor, con denegación predeterminada. Firma, emisor, audiencia y vigencia se validan contra el proveedor configurado. El proveedor, MFA, despliegue privado y conexión con Angular todavía no están configurados.

Las escrituras reservan una clave de idempotencia, bloquean el lote y confirman saldo, movimiento, auditoría y resultado en una transacción. La suite HTTP/PostgreSQL cubre concurrencia y permisos, con claves efímeras solo en fuentes de prueba. Triggers protegen UPDATE/DELETE de historia; un administrador de BD con privilegios DDL puede alterar esa protección. No hay afirmación de inmutabilidad criptográfica. Ver [contrato y operación](../backend/README.md).

Compras conserva el producto/unidad/costo de cada partida tal como se ordenó. Toda recepción o cancelación bloquea primero su orden; la recepción bloquea después el lote. La restricción única producto/lote coordina entregas simultáneas de órdenes distintas. Las condiciones del lote existente deben coincidir; compras no puede liberar una cuarentena. El costo recibido es informativo y no crea un pago ni una deuda contable. El detalle de orden se lee en una transacción de solo lectura con una instantánea consistente; sus listados agregan los totales en una sola consulta. [Contrato detallado](../backend/docs/PURCHASING_API.md).

## Arquitectura objetivo y trabajo restante

1. Sitio público separado del portal privado. El nombre de la clínica y su identidad jurídica aún se confirman.
2. Portal Angular y API Spring Boot modular: identidad, pacientes administrativos, recepción, inventario, compras, caja, activos y auditoría.
3. PostgreSQL como fuente de verdad. Movimientos y cobros inmutables por procedimiento; correcciones por reverso. Control optimista/pesimista según operación, claves de idempotencia y restricciones en BD.
4. Autenticación de personal con MFA, roles y autorización por recurso en servidor. Recepción no accede a las notas clínicas; farmacia recibe solo la información necesaria para dispensación.
5. Expediente clínico: evaluar lo contratado en Doctoralia y una solución SIRES adecuada, con evidencia de versión y alcance. Elegir al inicio; no sustituirlo por este prototipo.
6. Adjuntos privados cifrados, autorización por descarga, bitácora sin contenido clínico, retención definida, respaldos y restauración probados.
7. Doctoralia conserva la disponibilidad. Primera etapa: enlace/widget autorizado y conciliación por recepción. Conector API solo después de acceso, acuerdo y pruebas de aceptación de Docplanner.

## Invariantes y cobertura

| Operación            | Estado y validación en servidor                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Salida de inventario | Implementado en API: bloquear lote, comprobar disponibilidad, caducidad y estado; registrar movimiento y descuento en una transacción.        |
| Reintento            | Implementado en API: clave única; repetir la misma solicitud devuelve el resultado original; contenido distinto con misma clave es conflicto. |
| Recepción de compra  | Implementado en API: bloquear orden/lote, respetar el saldo pedido, conservar costo y registrar entrada, recepción e historia conjuntamente. |
| Cancelar compra      | Implementado en API: solo ADMIN con motivo; cerrar el saldo pendiente sin descontar ni eliminar las entregas anteriores. |
| Cobro/reverso        | Importe en centavos, referencia única, relación con original y motivo; no borrar eventos.                                |
| Identidad            | IDs propios; homónimos revisados con segundo dato; no unir por nombre automáticamente.                                   |
| Cierre clínico       | Solo profesional autorizado, firma aplicable, adendas y trazabilidad en el sistema clínico validado.                     |
| Exportación          | Permiso específico, registro de acceso y contenido mínimo; nunca expediente clínico público.                             |

## Límites que no se resuelven con Pages

GitHub Pages sirve archivos públicos. No aloja Spring Boot ni PostgreSQL y no aporta autenticación de personal, permisos clínicos, respaldos de expedientes ni transacciones multiusuario. Ocultar botones o proteger una ruta del frontend no sustituye autorización de servidor. El repositorio público no debe recibir archivos reales, secretos, bases de datos, documentos clínicos, cotizaciones privadas ni exportaciones de Doctoralia.

La primera versión no automatiza diagnósticos ni prescribe tratamientos. El catálogo ficticio evita nombres de medicamentos reales y no representa disponibilidad comercial.
