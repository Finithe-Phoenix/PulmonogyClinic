# Preparación del expediente clínico privado en México

Revisión documental: **28 de septiembre de 2026**, zona `America/Mexico_City`.

**Estado: diseño propuesto; habilitación clínica real pendiente.** Este documento no acredita cumplimiento, certificación, validez de firmas ni aptitud para atender pacientes. No incorpora datos reales ni implementa un sistema clínico. La revisión de aplicabilidad corresponde al prestador, su responsable clínico y asesoría jurídica competente.

## 1. Alcance y punto de partida

Complementa [fuentes del contenido](CONTENT_SOURCES.md), [arquitectura](ARCHITECTURE.md) y los pendientes `DISC-01`, `CLI-02`, `SEC-01`, `MIG-01`, `OPS-02`, `REC-01`, `API-02` y `PIL-01` del [backlog](BACKLOG.md). La demostración `CLI-01` no satisface esos pendientes. Los avances administrativos del portal tampoco demuestran seguridad o funcionalidad clínica.

Se evalúa consulta privada ambulatoria en México, con expediente y documentos vinculados al paciente. Hospitalización, investigación, telemedicina, recetas, medicamentos controlados y notificaciones sanitarias necesitarían análisis específico si se incluyen. Tampoco se completa aquí una revisión de licencias del establecimiento, regulación estatal, ejercicio profesional o todas las disposiciones complementarias.

No se han recibido para esta evaluación: identidad jurídica confirmada del prestador/responsable de datos; validación actual de profesionales y atribuciones; formatos clínicos aprobados; selección y alcance aprobado del sistema clínico; certificado aplicable; evidencias del mecanismo de firma; contrato de alojamiento ni modelo de encargados. **El titular definió el 28/09/2026 que Doctoralia solo tendrá función de exposición/captación: no será agenda principal ni expediente.** Por tanto, su contratación clínica o API no es una dependencia de este alcance. El portal tendrá la agenda principal; eso no lo convierte en un expediente clínico validado.

## 2. Hechos documentados y fuentes primarias

Las fechas de publicación/reforma siguientes son distintas de la fecha de consulta anterior. Se resumen puntos relevantes, no la totalidad de cada instrumento.

| Fuente | Hecho documentado y alcance |
| --- | --- |
| [NOM-004-SSA3-2012, DOF 15/10/2012](https://sidof.segob.gob.mx/notas/docFuente/5272787), §§ 5.1–5.12, 6 y 10.1 | La obligación de integrar/conservar alcanza al sector privado. Conservación mínima: cinco años desde el último acto médico (§ 5.4). Las notas requieren identificación, fecha, hora, autor y firma aplicable; la firma electrónica/digital queda sujeta al ordenamiento correspondiente. Regula confidencialidad, solicitudes de información, contenido de consulta general/especialidad y cartas de consentimiento. La [ficha federal de Orden Jurídico Nacional](https://www.ordenjuridico.gob.mx/fichaOrdenamiento.php?ambito=FEDERAL&idArchivo=74063&poder=ejecutivo) la identifica como vigente. |
| [NOM-024-SSA3-2012, DOF 30/11/2012](https://sidof.segob.gob.mx/notas/docFuente/5280847), §§ 1, 6.3–6.6 y 7.4–7.5 | Aplica a SIRES en sectores público, privado y social dentro de su campo. Incluye documentos estructurados e inalterables, gestión de seguridad, autenticación, roles, exportación y controles de consentimiento. Contempla firma electrónica avanzada en los supuestos que describe. La evaluación debe corresponder al alcance, guías y formatos; § 7.5.3 establece vigencia de dos años del certificado, sujeta a verificaciones y cambios. No basta anunciar que un producto “usa HL7” o exhibir un logotipo. |
| [Programa Nacional de Infraestructura de la Calidad 2026, DOF 24/02/2026](https://sidof.segob.gob.mx/notas/docFuente/5780781), temas 25 y 27 de Salud | Programa modificaciones de NOM-024-SSA3-2012 y NOM-004-SSA3-2012. Un tema programado no es, por sí mismo, una norma sustituta publicada y exigible. Debe repetirse la revisión de DOF, guías y catálogos antes de contratar y antes del piloto; esta búsqueda no sustituye una comprobación jurídica exhaustiva de vigencia. |
| [LFPDPPP, texto vigente de Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), nueva ley 20/03/2025, última reforma indicada 14/11/2025 | Salud es dato sensible (art. 2.VI). Arts. 7–9 regulan consentimiento y excepciones; 14–16, aviso; 18–20, seguridad, vulneraciones y confidencialidad; 21–34, derechos ARCO; 35–36, transferencias. Las excepciones requieren analizar el caso, no asumir autorización general por tratarse de una clínica. La ley identifica a la Secretaría Anticorrupción y Buen Gobierno (art. 2.XV); no debe copiarse sin revisión una política antigua que presente al INAI como autoridad actual. |
| [Docplanner: Integration process](https://integrations.docplanner.com/guide/integration-process.html), documentación del proveedor sin fecha editorial visible | Describe acceso sandbox, coordinación con especialista, pruebas de aceptación y activación con autorización del cliente. No prueba que la clínica tenga contratado un expediente clínico ni permite inferir alcance de su plan mexicano, certificación o firma. |

**Limitación de verificación:** la [página oficial de certificación SIRES de DGIS](http://www.dgis.salud.gob.mx/contenidos/intercambio/sires_certificacion_gobmx.html) no devolvió contenido utilizable al consultarla por HTTP/HTTPS. No se validó ningún proveedor en ese registro. No se sustituyó esa evidencia por listas comerciales. Solicitar certificado, dictamen y confirmación por canal oficial, contrastando titular, producto, versión, alcance, vigencia y modificaciones.

La matriz normativa se debe completar con reglamentos, disposiciones sanitarias complementarias, guías aplicables, normativa local y contratos concretos. La documentación de 2012 conserva referencias históricas: no se presume que todas las leyes/catálogos citados allí sigan sin cambios en 2026.

## 3. Decisión de arquitectura propuesta, no implementada

**Decisión confirmada del titular: desarrollar expediente propio dentro del portal.** Doctoralia queda fuera de la función clínica. Se mantiene separación de permisos, datos y servicios clínicos respecto de administración, aunque compartan navegación. La siguiente implementación será exclusivamente sintética: autoría, borradores versionados, cierre técnico sin firma, adendas y trazabilidad. La decisión de construcción no sustituye la evaluación del SIRES, formatos, firma, custodia ni aceptación clínico-jurídica; añadir formularios no demuestra esos requisitos. Ver [decisiones confirmadas](PRODUCT_DECISIONS.md).

### Separación, identidad y acceso

- Servicio/almacenamiento clínico privado, con cuentas, permisos y claves de operación separados de desarrollo. Prohibir contenido clínico en Pages, repositorio, fixtures, analítica, logs, herramientas de IA externas y almacenamiento persistente del navegador. Cualquier uso futuro de IA requiere evaluación y autorización propias; no se autoriza aquí.
- Identificador interno estable del paciente y correspondencias explícitas con cada proveedor. Ningún nombre, CURP aislada o cita decide automáticamente una fusión. Revisión humana de homónimos, representante y vínculos familiares; registrar correcciones de identidad sin trasladar silenciosamente documentos a otra persona.
- Autorizar en servidor por profesional, organización y relación asistencial, además del rol. `ADMIN` técnico no implica lectura clínica. Recepción, caja, farmacia y auditor operativo ven solamente sus datos mínimos; no heredan acceso a notas o adjuntos por conocer el ID. Auditoría clínica necesitaría asignación y finalidad específicas.
- MFA productivo, cuentas personales, baja inmediata, caducidad de sesión y revisión periódica de permisos. Si se justifica acceso excepcional de urgencia, diseñar elevación temporal con motivo, aviso y revisión; no un permiso universal permanente.

### Ciclo documental y firma

Propuesta de estados: `BORRADOR → PENDIENTE_DE_FIRMA → CERRADO`; una corrección posterior genera una `ADENDA` asociada. Son estados de diseño, no categorías jurídicas ni estados ya disponibles en producción.

| Etapa | Invariante propuesta | Evidencia que deberá producir la prueba |
| --- | --- | --- |
| Borrador | Revisiones numeradas; guardado con versión esperada; autor y paciente visibles. Una actualización concurrente no sobrescribe otra. No se presenta como nota firmada. | Dos sesiones sobre la misma revisión: una recibe conflicto recuperable; ambas versiones quedan identificables. |
| Preparación del cierre | Mostrar contenido completo, paciente, episodio, adjuntos y versión de plantilla. Confirmación expresa del profesional habilitado; no cerrar por finalizar una cita o cobrarla. Congelar los bytes que se enviarán al mecanismo de firma. | Una cita completada deja intacto el estado documental; cambio del contenido invalida la preparación anterior. |
| Firma/cierre | Conservar el original, identidad profesional comprobada, fecha de atención y de registro separadas, zona horaria, evidencias del proveedor y resultado verificable. Reintentos idempotentes. Un timeout se reconcilia por identificador: no produce dos documentos ni un falso éxito. | Fallo, revocación o respuesta indeterminada no muestran “firmado”. Un verificador independiente comprueba el documento de prueba y la vinculación a su autor. |
| Adenda | Nuevo documento con referencia inequívoca al original, motivo, autor y fecha; atraviesa su propio cierre. El original permanece consultable sin reescritura retrospectiva. | Intentos de editar/borrar un cerrado se rechazan; exportación conserva original y secuencia completa de adendas. |

El diseño de firma, custodia de claves, sello de tiempo, validación de certificados y conservación de evidencias se seleccionará con el proveedor y la revisión jurídica. Un hash, una imagen de rúbrica, un JWT, una contraseña o el texto “firmado por” **no acreditan por sí solos** una firma aplicable. No almacenar claves privadas personales del médico en el repositorio ni solicitar su entrega para desarrollar la demo.

Las plantillas se versionan y el responsable clínico aprueba su contenido y alcance: historia, evolución, solicitudes/resultados, referencia, resumen y consentimientos según los servicios confirmados. Evitar respuestas clínicas predeterminadas o inferidas de datos vacíos. Separar aviso de privacidad, base del tratamiento y consentimiento informado para un procedimiento; no reemplazarlos por una única casilla genérica. Las validaciones técnicas no sustituyen revisión del profesional.

### Adjuntos, auditoría y recuperación

- Adjuntos en almacenamiento privado cifrado; carga a cuarentena, límites, validación del tipo real, análisis de contenido peligroso y revisión antes de incorporarlos. Nombres opacos; impedir rutas públicas y acceso por enumeración. No interpretar un archivo de estudio como diagnóstico.
- Descarga mediante autorización actual por paciente/documento, con auditoría, controles de caché y sesión. Si se eligen enlaces temporales, justificar caducidad y exposición, evitar que tokens o URLs terminen en logs y comprobar comportamiento tras revocación.
- Bitácora de lectura, modificación, cierre, exportación, fallos y acceso excepcional, sin copiar notas ni secretos. Separar administración del registro de auditoría de la operación clínica; probar detección de alteración y restauración. Un trigger contra `UPDATE/DELETE` no protege frente a un administrador DDL ni demuestra inmutabilidad criptográfica.
- Respaldos cifrados con claves recuperables bajo custodia autorizada, copia aislada y simulacro de restauración. Acordar RPO/RTO con el prestador; comprobar juntos originales, adjuntos, firma, identidades y auditoría. Definir contingencia en papel y conciliación posterior sin duplicar episodios. La disponibilidad de Docker local no satisface este criterio.

### Retención, solicitudes y exportación

Propuesta: motor de retención por clase documental, último acto médico, expediente, bloqueo y suspensión de destrucción por litigio/requerimiento. El mínimo normativo no se convierte en borrado automático al quinto año. Aprobar una tabla de plazos con el responsable, incluyendo casos especiales, copias, auditoría y respaldos. La [LFPDPPP, arts. 10, 24 y 25](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) contempla conservación/bloqueo y excepciones a cancelación: una solicitud ARCO debe tramitarse, no activar una eliminación indiscriminada.

Flujo propuesto de entrega: solicitud registrada → identidad/representación y fundamento revisados → alcance autorizado → paquete preparado → entrega protegida → acuse y cierre auditado. Distinguir acceso a datos, resumen elaborado por médico y exportación técnica/migración; no prometer que un único PDF sirve para todos.

El paquete técnico debería incluir originales y adendas, adjuntos, índice, procedencia, versiones, identificadores y evidencias de firma verificables. Una representación PDF debe indicar si es una copia y conservar enlace interno a su original, sin publicar datos. Exigir al proveedor prueba de exportación completa y reimportación/lectura independiente con datos sintéticos, costos y condiciones de salida. Seleccionar formatos estructurados y guías aplicables al intercambio concreto; “compatible con FHIR/HL7” no reemplaza esa prueba ni la evaluación del sistema.

## 4. Decisiones humanas y dependencias externas

Todos los responsables de la tabla son **funciones por designar**, no personas que hayan aceptado un compromiso. Ningún bloqueo se cierra mediante autoaprobación del equipo de desarrollo.

| Bloqueo / backlog | Responsable y evidencia necesaria | Qué impide / avance seguro mientras tanto |
| --- | --- | --- |
| Prestador y operación — `DISC-01` | Titular: identidad jurídica, sede, profesionales/atribuciones y catálogo de servicios confirmados. | Impide fijar responsable del expediente/aviso y publicar capacidad clínica oficial. Preparar cuestionario y formatos vacíos. |
| Contenido clínico — `CLI-02` | Responsable clínico: plantillas, episodios, documentación por procedimiento, correcciones y consentimientos aprobados. | Impide captura asistencial. Revisar recorridos con casos ficticios, sin inventar criterio médico. |
| Sistema clínico — `CLI-02` | Titular + proveedor + revisión competente: contrato, producto/versión, certificado y dictamen verificables, alcance y cambios, exportación demostrada. | Impide tratar el portal como expediente válido. Comparar evidencia, no anuncios comerciales. |
| Firma — `CLI-02` | Profesional + proveedor + asesoría: mecanismo aplicable, identidad, custodia, verificación, revocación y conservación de evidencia. | Impide mostrar cierres como firmados/válidos. Diseñar estados y pruebas negativas sintéticas. |
| Privacidad — `DISC-01` / `SEC-01` | Responsable de datos y asesoría: inventario/finalidades, aviso, bases de tratamiento, representación/menores, ARCO, incidentes, encargados/transferencias y contratos. | Impide recolectar datos reales. Elaborar matriz sin información de pacientes; no asumir que alojar fuera de México sea automáticamente permitido o prohibido. |
| Seguridad/operación — `SEC-01` / `REC-01` | Titular + operación: infraestructura aprobada, MFA, mínimo privilegio, gestión de claves, monitoreo, restauración observada, RPO/RTO y contingencia aceptados. | Impide despliegue asistencial. Ensayar infraestructura aislada con datos sintéticos. |
| Archivo existente — `MIG-01` | Custodio + recepción + médico: inventario sin datos al repositorio, calidad/procedencia, coincidencia de identidad, revisión de errores y custodia de originales. | Impide importación masiva. Ensayar escaneo ficticio; digitalizar no autoriza destruir papel ni convertir OCR en nota validada. |
| Captación — `OPS-02` | Agenda principal ya definida: portal. Recepción/titular: canal de contacto, registro de solicitudes y alineación del perfil externo como difusión. | No requiere integración ni expediente Doctoralia. Registrar contactos manualmente y confirmar disponibilidad solo en la agenda propia; no se ha modificado la configuración externa. |
| Entrada en operación — `PIL-01` | Titular + personal clínico/operativo: revisión normativa actualizada, capacitación, contingencia y aceptación de piloto con incidencias cerradas. | Impide anunciar preparación productiva. Una suite verde no equivale a aceptación clínica humana. |

## 5. Criterios de salida verificables

Antes de habilitar datos reales, guardar las siguientes evidencias en un repositorio **privado y autorizado de evaluación**, no en este repositorio público:

1. Matriz normativa revisada y decisión de proveedor/alcance aprobadas, con responsables y fechas. Certificados y contratos contrastados; ningún “pendiente” oculto como “cumple”.
2. Pruebas negativas de roles y de acceso cruzado entre pacientes, organizaciones y adjuntos; pruebas de sesión expirada, baja y permiso revocado. Verificar también búsqueda, exports y auditoría, no solo páginas.
3. Casos reproducibles de revisión concurrente, firma fallida/indeterminada, cierre repetido, adenda y corrección de identidad. Confirmar que no se pierden originales y que documentos de prueba se verifican fuera de la aplicación.
4. Ejercicios de solicitud de acceso/rectificación/cancelación, retención suspendida y entrega a representante; revisión humana de respuestas y plazos. Probar borrado únicamente en el entorno desechable y cuando la política lo permita.
5. Exportación de salida y restauración integral cronometradas, incluyendo pérdida del servidor, indisponibilidad del proveedor y recuperación de claves. Registrar diferencias y demostrar lectura de un expediente sintético completo.
6. Piloto autorizado con usuarios capacitados y procedimiento de incidentes; aceptación explícita del responsable clínico y titular. Solo entonces decidir habilitación, nunca por el aspecto visual del portal.

Resultado de esta revisión: **requisitos y arquitectura de referencia documentados; ninguna certificación de proveedor, firma válida ni operación clínica real verificada**. Los siguientes insumos son decisiones y evidencias del prestador/proveedores, no expedientes de pacientes enviados al equipo de desarrollo.
