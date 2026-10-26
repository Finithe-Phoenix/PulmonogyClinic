# Backlog y condiciones de aceptación

## Iteración posterior a v0.5.0 · 28/09/2026

El portal local conecta inventario, compras, pacientes administrativos, agenda, caja, equipos y auditoría. El rediseño Paper & Ink elimina el verde como color de marca y separa módulos mediante rutas. La identidad de desarrollo tiene acceso en español y almacenamiento persistente migrado con verificación de preservación. **No equivale a una plataforma terminada ni habilitada para datos reales.**

La [validación](VALIDATION.md) distingue ejecuciones locales de entregas publicadas. Una prueba aprobada no cierra por sí sola una fila del backlog.

| ID | Entrega | Implementado / evidencia local | Pendiente y dependencia |
| --- | --- | --- | --- |
| UX-01 | Sistema visual y navegación | Tokens, nueve rutas privadas, componentes, consulta separada de edición; sitio/acceso coherentes | Revisión final, lector de pantalla/dispositivo real y formularios bajo conflicto/sesión. Técnica + usuarios |
| WEB-01 | Sitio/demo adaptables | Rediseño local; pruebas a 360, 390, 768, 1280 y 1440 px; demo separada sintética | Publicar esta iteración y verificar URL. Técnica |
| WEB-02 | Sitio oficial | Datos/enlaces de referencia y marca/fotos provisionales explícitas | Aprobar marca, fotos autorizadas, horarios, teléfonos, servicios, ubicación y avisos. Consultorio |
| OPS-01 | Pacientes administrativos | Alta, búsqueda, homónimos, revisión de duplicados, versiones; comparación de conflictos y descarte de respuestas tardías | Revisar el recorrido con el personal y política de identidad real. Consultorio |
| OPS-02 | Recepción y agenda | Reserva, llegada, espera, consulta, finalización/cancelación, reprogramación; conflictos y hora México. Titular define portal como agenda principal; Doctoralia solo captación | Alinear perfil/canales externos y registrar compromisos existentes antes del piloto. No conector. Consultorio |
| INV-01 | Catálogo/lotes/FEFO | Altas, entradas/salidas/bajas, cuarentena/liberación, búsquedas paginadas, CSV de página | Conteo, catálogo/unidades reales, trazabilidad navegable e importación. Técnica + consultorio |
| INV-02 | Integridad de stock | Transacciones, roles, reintento UUID por sujeto, última unidad, bloqueos vencido/cuarentena | Ensayo operativo de conciliación antes de uso real. Consultorio |
| INV-03 | Categorías reguladas | Sin medicamentos reales ni dispensación clínica | Procedimientos y responsabilidades según catálogo aprobado. Consultorio |
| COM-01 | Compras | Proveedores, varias partidas, costo histórico, recepción parcial por lote, cancelación del saldo; persistencia/concurrencia | Navegación integral orden–recepción–lote–movimiento; documentos acordados. Técnica + consultorio |
| COM-02 | Búsqueda/exportación | Filtros/páginas acotadas y CSV parcial seguro sin consultas ocultas | Exportación masiva/auditada no incluida; definir necesidad/permisos antes de ampliar |
| COM-03 | Correcciones/devoluciones | Cancelar saldo no borra entregas; historia protegida | Acordar causales, autorizadores, cuarentena, compensaciones de stock/costo y documentos. Consultorio + técnica |
| CAJ-01 | Turnos/cobros/cierre | Fondo, métodos, referencia única, centavos exactos, reverso ADMIN, diferencia/cierre; UI/API/PostgreSQL | Confirmados cobros por cita e independientes. Implementar vínculo opcional validado; hoy referencia manual sin FK. Técnica |
| CAJ-02 | Integraciones financieras | Sin pagos electrónicos, contabilidad ni CFDI | Proveedor/PAC, acceso, alcance, costos y aceptación. Consultorio + terceros |
| EQ-01 | Equipos/mantenimiento | Activos, ubicación/serie, disponibilidad, historial/próxima intervención y recurso normalizado en agenda | Inventario real/evidencias aprobadas; no certificación de calibración. Consultorio |
| CLI-01 | Expediente/documentos | Demo sin validez, [arquitectura/fuentes oficiales](CLINICAL_READINESS.md) y construcción propia confirmada | Implementación privada sintética, cuenta MEDICO y permisos por autor; después formatos/firma/custodia/retención y aceptación. Captura real deshabilitada |
| SEC-01 | Identidad/permisos | Keycloak/PKCE, JWT/RBAC servidor; roles ADMIN/RECEPCION/FARMACIA/MEDICO/AUDITOR; tokens en memoria | Recorrido real de rol médico, MFA/alta-baja/sesiones productivas, mínimos por recurso. Técnica + titular |
| SEC-02 | Sesión/recuperación | Renovación real, bloqueo/reauth con PKCE; formularios solo en memoria y separación de cuentas; 10 casos aprobados | Repetir suite integral tras ajustes finales; MFA/operación productiva requieren entorno autorizado |
| API-01 | Servidor modular | Java21/SpringBoot/PostgreSQL17, V1..V5; 100 pruebas locales y 7 de roles BD separados aprobadas | Ampliar contratos/pruebas/política de permisos con cada módulo nuevo. Técnica |
| DEV-01 | Publicación | Pages existente para sitio/demo; API/portal solo locales | Commit/push, Actions y URL de esta iteración. Técnica |
| DEV-02 | Preparación productiva | Stack reproducible, secretos fuera de Git, BD de pruebas exclusiva, política runtime/migración y ensayo 7/7 | Parametrizar portal, HTTPS/MFA, observabilidad/actualización y entorno aprobado. Hosting/dominio/costos: titular |
| REC-01 | Respaldo/restauración | [Ensayo cifrado aprobado](BACKUP_RESTORE.md): 18 tablas, destino nuevo, hashes/relaciones; artefactos conservados | No cubre producción, identidad/adjuntos, copias externas, retención, llaves independientes ni RPO/RTO. Técnica + titular |
| MIG-01 | Conteo/importación/migración | [Plantillas/planificador sin escrituras](IMPORT_AND_COUNT.md), 12 casos puros y ensayo sintético: seis propuestas, cero importaciones | No importador productivo habilitado. Validar catálogo/archivos y autorizar ejecución/conciliación. Técnica + consultorio |
| PIL-01 | Capacitación/turno piloto | [Guía por rol y contingencia](PILOT_RUNBOOK.md); recorridos sintéticos automatizados, no piloto humano | Asignar responsables, medir jornada y aceptar entrada/salida con personal real. Consultorio + técnica |
| QA-01 | Calidad integral | API/dominio/navegador, axe y cinco anchuras; evidencias sintéticas | Rendimiento con escenario documentado, pruebas asistivas manuales y aceptación humana. Técnica + usuarios |

## Decisiones que el desarrollo no puede sustituir

1. **Expediente:** construcción propia confirmada; faltan plantillas, firma, custodia y habilitación clínica. Agenda propia principal y Doctoralia solo exposición/captación también confirmadas. Ver [decisiones](PRODUCT_DECISIONS.md); no volver a pedir esas elecciones ni condicionar el avance a una API de Doctoralia.
2. **Operación económica:** cobros tanto por cita como independientes confirmados; implementar el vínculo opcional. Faltan reglas de aplicación de anticipos, pagos parciales, devoluciones y responsables. Un cobro no implica factura ni consulta concluida.
3. **Inventario:** aprobar catálogo/unidades, conteo, correcciones/devoluciones y categorías reguladas.
4. **Privacidad/infraestructura:** responsable, dominio, hosting, custodios y retención; autorizar costos antes de contratar.
5. **Sitio/piloto:** aprobar contenidos y asignar personal para validar un turno. Pruebas o revisión de agentes no sustituyen aceptación humana.

## Secuencia técnica

Cerrar defectos de sesión/conflicto, ejecutar la suite integrada y publicar la iteración visual verificada. Continuar trazabilidad, configuración productiva, ensayo de importación/conteo, capacitación y piloto sintético. Las dependencias externas no bloquean esos frentes, pero sí impiden declarar el goal completo o habilitar uso clínico real.
