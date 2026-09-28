# Backlog de implementación

Base: plan de 18 semanas acordado como referencia, operación actual en papel y Doctoralia. No equivale a una fecha comprometida ni a un expediente clínico terminado.

| ID      | Prioridad | Entrega / criterio de aceptación                                                             | Estado                      |
| ------- | --------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| WEB-01  | P0        | Sitio adaptable con servicios, ubicación, enlace al perfil y etiqueta de propuesta.          | Demo implementada           |
| OPS-01  | P0        | Pacientes ficticios, estados de atención y vista diaria reproducible.                        | Demo implementada           |
| INV-01  | P0        | Alta de productos/lotes, entradas/salidas, alertas, bloqueos y exportación.                  | Demo implementada en v0.3.0 |
| COM-01  | P0        | Proveedores, órdenes, entregas parciales, trazabilidad por lote, bloqueo de duplicados y cancelación del saldo. | Demo implementada en v0.2.0 |
| CAJ-01  | P0        | Cobros en centavos, referencias únicas, reversos y cierre ilustrativo.                       | Demo implementada           |
| CLI-01  | P0        | Flujo de borrador, cierre y adenda, identificado sin validez clínica.                        | Demo implementada           |
| DEV-01  | P0        | Compilación y pruebas en Actions; artefacto estático para Pages.                             | Workflow implementado       |
| DISC-01 | P0        | Confirmar nombre, razón social, sedes, servicios, personal, horarios y plan Doctoralia.      | Pendiente del levantamiento |
| CLI-02  | P0        | Seleccionar sistema clínico y verificar certificación/versión/alcance, exportación y firma.  | Pendiente de evaluación     |
| SEC-01  | P0        | Portal privado, identidad/MFA, RBAC en API y pruebas negativas por rol/recurso.              | API de inventario con RBAC; identidad/MFA y portal pendientes |
| API-01  | P0        | Spring Boot modular, PostgreSQL, migraciones y repositorios con transacciones.               | Primera API de inventario implementada en v0.3.0 |
| INV-02  | P0        | Catálogo y lotes reales, conteo inicial, compras, recepción parcial, FEFO y concurrencia.    | API de catálogo/lotes/movimientos/FEFO; compras privadas y conteo pendientes |
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

Cerrar descubrimiento y sistema clínico; configurar identidad/MFA y conectar el portal a la API; extender compras, recepción, caja y equipos al servidor; preparar conteo e importación; realizar pruebas integrales y piloto. La demo adelanta diseño y conversación con el doctor, no omite estas etapas.
