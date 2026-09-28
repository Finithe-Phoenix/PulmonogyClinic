# Guion de demostración — 10 minutos

1. Abrir el sitio propuesto. Revisar en celular el encabezado, servicios y ubicación. Los enlaces a Doctoralia y Maps son externos; no se envía una reserva desde la demo.
2. Entrar a **Explorar plataforma**. La fecha fija de la jornada es 28/09/2026. Los indicadores se calculan de los datos ficticios.
3. **Recepción:** registrar llegada en una cita confirmada; cambia a En espera. Iniciar consulta. También puede simular una cita; repetir fecha y hora ocupadas muestra un error.
4. **Pacientes:** buscar DEMO-002 y abrir su consulta. Para crear otro ejemplo, usar un nombre inventado y fecha ficticia.
5. **Consultas:** llenar los cuatro apartados con texto de ejemplo; guardar borrador, cerrar nota y añadir una adenda. El contenido original permanece visible. Exportar las notas guardadas como JSON ficticio. El cierre no firma un documento clínico.
6. **Inventario:** filtrar Alertas. Intentar salida de SIM-2603: debe bloquearse por caducidad. Intentar más unidades que las existentes: debe rechazarse. Registrar una salida de SIM-2601 con motivo y comprobar que disminuye solo ese lote y aparece el movimiento.
7. **Equipos:** alternar disponibilidad del nebulizador ficticio; no disminuye como si fuese un consumible.
8. **Caja:** registrar un cobro de ejemplo de $250 MXN en efectivo. Conciliar contra el efectivo esperado. Reversar el cobro con motivo y comprobar total y trazabilidad. Repetir referencia debe rechazarse.
9. Recargar la página: los cambios permanecen en ese navegador cuando permite almacenamiento local. No se sincronizan entre equipos ni pestañas.
10. Revisar **Plan del proyecto**. Restablecer datos para la siguiente presentación; antes, exportar ejemplos si se desea conservarlos.

## Lo que se debe decir al presentar

"Esta versión permite revisar cómo trabajaríamos. Toda la información operativa es ficticia. La siguiente entrega construye la parte privada y conecta los sistemas que se acuerden. El expediente clínico real requiere selección y validación propias."

## Recorrido adicional: compras y recepción

1. Abrir **Compras**. La orden `OC-DEMO-001` contiene 20 unidades ficticias pendientes. Crear una orden no suma existencias ni registra un pago.
2. Pulsar **Recibir** y capturar 5 unidades, un folio nuevo, un lote ficticio y una caducidad vigente. La orden pasa a **Parcial** y el lote aparece en Inventario con 5 unidades.
3. Intentar recibir 16 unidades adicionales: debe rechazarse porque quedan 15. Un lote ya conocido debe conservar la misma caducidad y condición.
4. Recibir el saldo restante con otro folio: el estado pasa a **Recibida**. Si se usa el mismo lote, se incrementa ese lote; no se crea una copia.
5. Crear otra orden con varios productos y costos ilustrativos. Recibir una parte en **Cuarentena**; el inventario bloquea su salida.
6. **Cancelar pendiente** conserva las entregas y las existencias ya registradas; requiere un motivo y bloquea nuevas recepciones.
7. Agregar un proveedor ficticio y exportar compras a CSV. No se envían pedidos, pagos ni comunicaciones al proveedor.

Las devoluciones al proveedor, impuestos, descuentos, unidades fraccionarias y cuentas por pagar quedan fuera de esta versión. Todas las cantidades de la demo son unidades enteras del catálogo ilustrativo.

## Casos a validar con el equipo

Recepción: identidad y orden de llegada. Doctor: estructura documental y sistema clínico. Farmacia: unidades, lotes, caducidad, devolución y catálogo regulado. Administración: fondo de caja, descuentos, cortes y facturación. Titular: nombre comercial, permisos de uso de marca/fotos y responsables de datos.
