# Backlog de implementación

## Avance v0.5.0 · primera operación privada

SEC-01, INV-02 y COM-02 ahora tienen **portal privado local conectado y verificado**, con Keycloak de desarrollo, PKCE, autorización JWT existente, PostgreSQL, persistencia entre sesiones y concurrencia entre usuarios. DEV-01 tiene Pages habilitado y desplegado; DEV-02 agrega workflow privado con 10 pruebas E2E. Identidad/MFA productivos, hosting y piloto siguen pendientes. [Guía](PRIVATE_PORTAL.md), [96 pruebas locales](VALIDATION.md), [diagnóstico y dependencias](SESSION_2026-09-28.md).

La tabla conserva el alcance completo; los avances de conexión del portal se actualizan debajo.

Base: plan de 18 semanas acordado como referencia, operación actual en papel y Doctoralia. No equivale a una fecha comprometida ni a un expediente clínico terminado.

| ID      | Prioridad | Entrega / criterio de aceptación                                                             | Estado                      |
| ------- | --------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| WEB-01  | P0        | Sitio adaptable con servicios, ubicación, enlace al perfil y etiqueta de propuesta.          | Demo implementada           |
| OPS-01  | P0        | Pacientes ficticios, estados de atención y vista diaria reproducible.                        | Demo implementada           |
| INV-01  | P0        | Alta de productos/lotes, entradas/salidas, alertas, bloqueos y exportación.                  | Demo implementada en v0.3.0 |
| COM-01  | P0        | Proveedores, órdenes, entregas parciales, trazabilidad por lote, bloqueo de duplicados y cancelación del saldo. | Demo implementada en v0.2.0 |
| CAJ-01  | P0        | Cobros en centavos, referencias únicas, reversos y cierre ilustrativo.                       | Demo implementada           |
| CLI-01  | P0        | Flujo de borrador, cierre y adenda, identificado sin validez clínica.                        | Demo implementada           |
| DEV-01  | P0        | Compilación y pruebas en Actions; artefacto estático para Pages.                             | Pages habilitado, publicado y verificado |
| DEV-02  | P0        | Portal privado separado, stack local y pruebas integrales de identidad/API/UI.              | Implementado; 10 E2E locales aprobados |
| DISC-01 | P0        | Confirmar nombre, razón social, sedes, servicios, personal, horarios y plan Doctoralia.      | Pendiente del levantamiento |
| CLI-02  | P0        | Seleccionar sistema clínico y verificar certificación/versión/alcance, exportación y firma.  | Pendiente de evaluación     |
| SEC-01  | P0        | Portal privado, identidad/MFA, RBAC en API y pruebas negativas por rol/recurso.              | Portal local/Keycloak/PKCE/RBAC verificados; MFA e identidad productiva pendientes |
| API-01  | P0        | Spring Boot modular, PostgreSQL, migraciones y repositorios con transacciones.               | API de inventario y compras implementada en v0.4.0 |
| INV-02  | P0        | Catálogo y lotes reales, conteo inicial, compras, recepción parcial, FEFO y concurrencia.    | API conservada; catálogo, recepción y existencias conectados; conteo real y UI de movimientos pendientes |
| COM-02  | P0        | Proveedores y órdenes persistentes; recibir por lote, evitar duplicados/sobreentrega y cancelar saldos con permiso. | API y portal local conectados; persistencia y concurrencia verificadas |
| COM-03  | P1        | Devoluciones, correcciones de entrega, impuestos y documentos acordados con el responsable. | Pendiente del levantamiento |
| INV-03  | P0        | Procedimientos de antibióticos y categorías reguladas acordes al catálogo real.              | Pendiente del responsable   |
| CAJ-02  | P0        | Turnos de caja, fondo inicial, autorizaciones de reverso y persistencia privada.             | Pendiente                   |
| MIG-01  | P0        | Ensayo sintético; medir archivo; migrar pacientes activos y validar identidad con recepción. | Pendiente                   |
| OPS-02  | P0        | Agenda principal definida; conciliación de citas futuras y cambios en Doctoralia.            | Pendiente                   |
| REC-01  | P0        | Backups cifrados, restauración ensayada, contingencia y recuperación acordada.               | Pendiente                   |
| WEB-02  | P1        | Fotos autorizadas, marca final, textos, avisos y publicación oficial aprobados.              | Pendiente                   |
| API-02  | P1        | Integración Doctoralia aprobada; probar cambios, cancelaciones, reintentos y reconciliación. | Condicionada al proveedor   |
| FIN-01  | P1        | Seleccionar PAC y acordar emisión de CFDI, errores y cancelaciones.                          | Alcance adicional           |
| EQ-01   | P1        | Inventario real de equipo, mantenimiento/calibración y disponibilidad por recurso.           | Pendiente                   |
| PIL-01  | P0        | Un turno piloto, personal capacitado, cero defectos críticos abiertos y entrega documentada. | Pendiente                   |

## Datos de arranque

Nombre comercial confirmado; servicios/horarios; lista de personal y responsabilidades; contrato y funcionalidades de Doctoralia; formatos clínicos vacíos; catálogo de productos y unidades; volumen de archivo; inventario de dispositivos y conectividad. No subir expedientes ni datos de pacientes a este repositorio.

## Secuencia siguiente

Tras el primer recorrido privado local verificado, extender pacientes administrativos y recepción al servidor; continuar caja y equipos con sus interfaces y pruebas. En paralelo, cerrar descubrimiento/sistema clínico y seleccionar infraestructura e identidad/MFA productivas. Después preparar conteo/importación, recuperación, capacitación y piloto. La integración local no omite estas etapas.
