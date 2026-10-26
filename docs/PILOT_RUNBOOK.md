# Piloto operativo sintético · guía de ejecución humana

Estado: **procedimiento preparado; piloto humano no ejecutado ni aprobado**. Las pruebas automatizadas y el plan de importación son evidencias técnicas separadas. Este documento no autoriza datos reales, uso clínico, publicación oficial, cambios a Doctoralia, desembolsos, pagos bancarios ni emisión de CFDI.

Objetivo PIL-01: ensayar una jornada administrativa trazable, detectar fricciones por rol y reconciliar agenda, movimientos y caja sin borrar historia. Los tiempos siguientes son presupuestos de sesión, no tiempos medidos ni compromisos de operación. Planificar 75–100 minutos, con pausas si aparece un incidente.

## Entrada: no iniciar hasta completar

- [ ] Facilitador técnico, operador de recepción, responsable de inventario, administrador/autorizador, observador y suplente asignados por nombre; un rol simulado debe declararse como tal.
- [ ] Entorno local confirmado en `http://localhost:4180/`, API/identidad de desarrollo y base sintética. No trabajar en Pages/demo creyendo que confirma operaciones privadas.
- [ ] Versión/build y evidencia de pruebas integradas vigentes anotados. No arrancar suites API destructivas ni recrear contenedores durante el piloto; coordinar con la tarea técnica.
- [ ] Verificación de cuentas/roles realizada; contraseñas solo desde la fuente local privada, nunca en actas/capturas. Confirmar una cuenta con MEDICO antes del recorrido médico; si no existe, registrar ese recorrido **NO EJECUTADO**, no suplir evidencia con ADMIN.
- [ ] Ningún turno de caja abierto ajeno al ensayo. No cerrar un turno ajeno para habilitar esta práctica.
- [ ] Fixtures sintéticos, corte, catálogo y unidades revisados según [IMPORT_AND_COUNT](IMPORT_AND_COUNT.md). Confirmar que no hay pacientes, medicamentos ni contactos reales.
- [ ] Identificador único de sesión y referencias sintéticas disponibles; revisar existencia antes de repetir un piloto. Decisión de producto confirmada: **el portal es la agenda principal y Doctoralia solo exposición/captación**. Las solicitudes de ese canal se representan con folios ficticios, sin acceder/modificar una cuenta real.
- [ ] Recuperación/contingencia explicada; ubicación de evidencia sintética y responsables definidos. [Respaldo/restauración](BACKUP_RESTORE.md) es un procedimiento aparte, no una garantía productiva ni autorización para restaurar encima de una base activa.

Hoja de sesión a completar, sin valores inventados:

| Dato | Registro |
| --- | --- |
| ID, fecha, zona horaria y build | PENDIENTE |
| Participantes y roles reales/simulados | PENDIENTE |
| Alcance de lotes/pacientes/turno exclusivos | PENDIENTE |
| Responsable de decidir detener/reanudar | PENDIENTE |
| Evidencias, incidencias y aceptación | NO EJECUTADO |

## Roles y límites que deben comprobarse

| Rol | Recorrido autorizado | No debe poder hacer |
| --- | --- | --- |
| ADMIN | Catálogo/proveedores, operación, bajas, cuarentena, reversos, equipos y auditoría | Saltarse invariantes o borrar historia desde el portal |
| RECEPCION | Pacientes administrativos, reserva/reprogramación/llegada/cancelación; apertura/cobro/cierre de caja; consultar equipos | Inventario/compras, reversos, iniciar/finalizar consulta |
| MEDICO | Consultar pacientes; reservar/reprogramar/llegada/cancelación; iniciar/finalizar atención administrativa; consultar equipos | Editar pacientes, caja, inventario/compras |
| FARMACIA | Consultar catálogo, crear lotes, entradas/salidas permitidas, órdenes y recepciones; consultar equipos | Alta de producto/proveedor, baja DISPOSAL, cuarentena/liberación, cancelar saldo de orden, caja |
| AUDITOR | Consultar módulos y auditoría | Cualquier escritura |

La navegación oculta es una ayuda, no prueba suficiente de autorización. Los rechazos 401/403 los aplica el servidor. No compartir cuentas para aparentar otro rol; registrar sujeto/rol que hizo cada operación. Referencia: [portal privado](PRIVATE_PORTAL.md) y contratos backend. La matriz de funciones no es una asignación laboral o clínica aprobada.

## Recorrido guiado

### A. Acceso y continuidad · 10 minutos previstos

1. Abrir el portal privado desde su raíz; no reutilizar una URL antigua de `login-actions`. Iniciar sesión con cuenta asignada y comprobar rol visible y módulos permitidos.
2. Capturar un borrador ficticio sin enviarlo; pedir al facilitador el escenario de bloqueo previsto en la prueba de sesión, si está habilitado y coordinado. No modificar TTL, tokens ni configuración de identidad para forzarlo durante el piloto.
3. Al bloquearse, comprobar que no se pueden consultar ni enviar operaciones; recuperar explícitamente con la misma identidad. Revisar el borrador antes de confirmar. No asumir que recuperar sesión envió algo.
4. Explicar la diferencia: borradores solo en memoria de la pestaña; comandos ya enviados e inciertos conservan su clave por identidad. Cerrar/recargar puede perder borradores. Cambio de cuenta no debe mostrar el formulario anterior. Véase [SESSION_RECOVERY](SESSION_RECOVERY.md); registrar el resultado observado, no presuponerlo por el documento.

### B. Conteo, compra y trazabilidad · 20 minutos previstos

1. Seguir el conteo inicial de la guía: lote ficticio de INSUMOS, 12 piezas disponibles, y lote sintético de categoría FARMACIA, 4 unidades en cuarentena con caducidad vigente. Obtener ambos saldos mediante operaciones confirmadas, no por editar BD.
2. ADMIN crea proveedor ficticio si no existe. FARMACIA crea orden de **5 piezas a $10.00 MXN** con fecha esperada vigente. El stock sigue en 12: una orden no es una entrada.
3. Recibir **2** piezas del lote de INSUMOS; producto, batch, caducidad y cuarentena deben coincidir con el lote existente. Esperado: lote **14**, orden parcial, recibido **$20.00**, pendiente **$30.00**. Registrar folio/orden/partida/recepción/lote/movimiento según respuesta/historial; si la UI todavía no permite navegar toda la cadena, anotar esa limitación y obtener evidencia mediante el mecanismo de lectura autorizado, sin inventar enlaces.
4. Registrar salida sintética autorizada de **1** pieza con motivo: saldo **13**. Comprobar que una salida del lote en cuarentena se rechaza; no liberarlo para eludir el control.
5. Recontar ficticiamente **12** piezas frente a 13 registradas. No corregir automáticamente. Documentar causa de simulación y autorización ADMIN; para demostrar corrección append-only, registrar una Baja de **1** con motivo explícito del ensayo. Saldo **12**, con la entrada, salida y baja originales presentes. Esto no define cómo tratar devoluciones reales ni una política clínica de desecho.
6. Si el escenario incluye cancelar las 3 piezas no entregadas, solo ADMIN cancela el saldo con motivo. Esperado: orden CANCELLED, pendiente $0; recibido $20 y stock 12 sin alteración. Nunca usar cancelación para deshacer lo recibido.
7. Consultar y exportar la página visible por rol autorizado. Verificar aviso de exportación parcial y número de filas; no usar ese CSV como inventario completo sin recorrer/conciliar el alcance.

### C. Identidad administrativa, agenda principal y captación · 20 minutos previstos

1. RECEPCION busca referencia y nombre antes de alta. Registrar dos personas ficticias con referencias distintas y el mismo nombre, revisando fecha/contacto y candidatos. La coincidencia no fusiona: solo confirmar registros independientes si así está diseñado el ejercicio. No usar CURP, diagnósticos o documentos reales.
2. Reservar para la persona correcta en fecha/hora de **Ciudad de México**, duración, profesional y recurso coherentes. Confirmar nombre y referencia, no solo el nombre homónimo. Para un equipo registrado, usar exactamente su referencia; si no está disponible, no inventar otro nombre para sortear la restricción.
3. Intentar un cruce sintético con el mismo profesional/recurso/paciente; verificar rechazo y elegir otra franja. Confirmar que la primera cita sigue intacta. Reprogramar solo mientras esté Programada.
4. Simular una solicitud captada por Doctoralia. Recepción verifica disponibilidad **en el portal**, identifica a la persona ficticia y registra allí la cita con origen `DOCTORALIA_MANUAL` y folio **ficticio** `DA-SYN-<ID-ENSAYO>-01`. Ese campo técnico de origen/referencia no significa que haya una reserva o agenda operativa externa. Anotar momento/operador y conciliar que el mismo contacto no se capturó dos veces; la referencia activa no debe duplicarse.
5. Simular un cambio solicitado por ese contacto: recepción reprograma/cancela **solo en el portal**, conforme al estado permitido, y registra la conciliación manual de la solicitud. Doctoralia no es agenda principal ni expediente; se limita a exposición/captación. No hay sincronización, llamadas al proveedor ni notificaciones automáticas. La decisión del canal no autoriza importar datos reales ni contratar servicios.
6. RECEPCION registra llegada. Con cuenta MEDICO, iniciar consulta y finalizar; son estados administrativos, no un expediente, nota médica, firma ni validación clínica. Si una consulta sigue abierta compartiendo profesional/recurso, la siguiente no debe poder iniciarse.
7. Provocar un conflicto de versión con dos operadores **sobre una cita sintética asignada al ensayo**. El segundo revisa servidor frente a borrador, acepta conscientemente la nueva versión y vuelve a confirmar solo si procede. Nunca repetir a ciegas ni copiar el estado antiguo sobre el nuevo.

### D. Caja y conciliación manual · 15 minutos previstos

1. Confirmar que no existe turno abierto ajeno. RECEPCION abre un turno exclusivo con fondo ficticio **$1000.00**.
2. Registrar cobro ficticio **$123.45 en efectivo** y otro **$50.10 en tarjeta**, con folios únicos. La referencia de operación es manual y opaca: crear un folio administrativo sintético en la hoja de conciliación, relacionarlo explícitamente con la cita y copiarlo al cobro. No escribir nombres/datos clínicos ni asumir una FK: el sistema no valida ese vínculo y un cobro no prueba atención concluida.
3. Esperado: efectivo **$1123.45**, tarjeta **$50.10**. El registro no ejecuta cargo bancario, factura ni pago electrónico.
4. ADMIN revierte el cobro de tarjeta con motivo sintético. Esperado: tarjeta neta **$0**, cobro original y reverso visibles. No es devolución bancaria. Si corresponde otra captura, usar un nuevo folio, no editar el cobro revertido.
5. Contar ficticiamente **$1120.00**; conciliar faltante **-$3.45** con motivo. Revisar métodos por separado y confirmar cierre solo tras aceptar la diferencia. Esperado: turno cerrado, sin nuevos movimientos. No reabrir ni borrar el cierre; correcciones posteriores requieren política/flujo aún no definido.

### E. Auditoría y cierre · 10 minutos previstos

1. AUDITOR revisa registros del ámbito, actores, razones y saldos sin escribir. Comparar la hoja de sesión con las respuestas/historial; las capturas por sí solas no demuestran que hubo persistencia.
2. Cerrar sesión, entrar con rol permitido y releer los datos confirmados. No convertir una falta de acceso de otro rol en un defecto de persistencia.
3. Registrar por escenario: ejecutado/no ejecutado, esperado/observado, tiempo observado, evidencia e incidencia. Un facilitador no firma en nombre de participantes ausentes.

## Contingencias: detener la acción, no la historia

| Situación | Respuesta operativa | Condición para reanudar |
| --- | --- | --- |
| Respuesta perdida / aviso pendiente | Conservar pestaña; misma cuenta y Reintentar con el mismo comando. No crear otra entrada/cobro/recepción con nueva clave | Leer saldo e historial tras confirmar; una sola afectación |
| Pestaña perdida y clave incierta | Detener nuevas escrituras de ese evento; conciliar folio único, historia y actor con ADMIN/técnico | Resultado identificado documentalmente, no por suposición |
| Sesión bloqueada | Recuperar misma identidad explícitamente; no recargar ni borrar almacenamiento para “arreglarla” | Rol correcto, borrador revisado y sin reenvío automático |
| 403 | Verificar cuenta/rol; pedir al autorizador la acción necesaria | Operador realmente autorizado; nunca prestar credenciales |
| VERSION_CONFLICT | Leer/comparar estado nuevo conservando borrador | Nueva aceptación y comando nuevo para la decisión revisada |
| Stock/caducidad/cuarentena o saldo de compra insuficiente | Detener salida/recepción; revisar lote, partidas e historial | Causa y datos reconciliados; no relajar controles |
| API/identidad/energía no disponible | Suspender captura en el portal. Para este piloto, anotar eventos ficticios numerados en hoja de contingencia, marcados NO INGRESADOS | Servicio confirmado y conciliación uno por uno antes de capturar; jamás presentarlos como ya confirmados |
| Descuadre o presunta duplicación | Aislar el ámbito y conservar evidencia. No truncar, restaurar encima ni modificar historia | Responsable aprueba diagnóstico y corrección append-only apropiada |

La hoja de contingencia es exclusivamente un recurso del ensayo sintético. No autoriza registrar datos clínicos reales fuera de un sistema aprobado ni establece una política real de retención/custodia. Un procedimiento clínico de continuidad necesita al responsable del consultorio.

## Criterios de salida y aceptación

- [ ] Cada escenario previsto tiene resultado observado; ausencias/roles simulados/fallos se señalan sin convertirlos en aprobaciones.
- [ ] Se conciliaron fuente → referencia/UUID destino, lote → movimientos, orden → recepciones y folio manual de cita → cobros del ámbito; ningún saldo se ajustó por SQL.
- [ ] Saldo esperado del ejercicio de INSUMOS: 12; la cuarentena del segundo lote permanece identificada; compras conserva sus entregas. Diferencias explicadas y autorizadas.
- [ ] Caja exclusiva del ensayo conciliada/cerrada con diferencia visible; ninguna operación pendiente de confirmación. No tocar turnos ajenos para lograr el cierre.
- [ ] Reintentos no duplicaron afectaciones, conflictos no eliminaron borradores y otro rol no vio formularios del anterior, según recorrido efectivamente ejecutado.
- [ ] No quedan incidentes de integridad, permisos o pérdida de información sin resolución. Los pendientes no críticos tienen responsable y fecha acordada, no inventada.
- [ ] Participantes y responsable del consultorio registran aceptación/rechazo del **ensayo sintético**, con alcance y límites. Este paso no lo sustituye Codex ni una suite verde.

Si falta cualquiera de los controles de integridad/identidad/conciliación, resultado `NO APTO PARA AMPLIAR`; conservar registros sintéticos y abrir incidencia. Un piloto aceptado tampoco habilita datos reales: privacidad, infraestructura, expediente, proveedores, políticas económicas, catálogo real y demás dependencias del [backlog](BACKLOG.md) requieren sus decisiones/evidencias propias.
