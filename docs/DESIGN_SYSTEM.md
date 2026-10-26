# Sistema de diseño · Paper / Ink

Iteración local posterior a v0.5.0, 28/09/2026. Dirección de producto implementada, no identidad comercial aprobada por el consultorio. El portal, el acceso y el sitio público tienen compilaciones y comprobaciones distintas.

## Principios y tokens

Base marfil `#f6f5f1`, superficies blancas, tinta `#172333` / `#202b39` y acento azul `#294f88`. Ámbar significa atención y rojo indica error o riesgo; el verde no es el color de marca. No usar color como único indicador. La tipografía de interfaz es Segoe UI/system; Georgia se reserva para títulos editoriales, no para formularios o cifras. No se cargan fuentes externas.

Los tokens se organizan como primitivos → semánticos → componentes en `src/portal/tokens.css`, con equivalentes del sitio en `src/styles.css` y del proveedor de identidad en su tema. Espaciado base de 4 px; bordes discretos, radio moderado y sombras reservadas a superficies elevadas. Los iconos SVG locales son decorativos cuando acompaña un texto; los botones sin texto llevan nombre accesible.

El texto secundario mantiene al menos 12 px, las celdas y navegación 14 px; los campos móviles usan 16 px y los controles principales objetivos de 44 px. El inicio prioriza datos operativos: se retiró el gran bloque promocional de abastecimiento al revisar su coste de espacio. No se introducen gráficos ni cifras globales ficticias para llenar la pantalla.

## Componentes y comportamiento

| Patrón | Contrato de experiencia |
| --- | --- |
| Navegación | Rutas propias por módulo, sección activa, menú adaptable y enlaces filtrados por rol. El servidor conserva la autorización definitiva. |
| Encabezado | Contexto, título y acción principal. El foco se lleva al título al cambiar de módulo; existe enlace para saltar al contenido. |
| Consultas | Búsqueda y filtros en servidor, páginas limitadas, carga/error/vacío diferenciados. Una consulta anterior no puede reemplazar la actual. No mostrar totales globales calculados desde una página parcial. |
| Tablas | Encabezados, filas legibles, región de desplazamiento identificada y alcanzable por teclado. El desplazamiento horizontal, cuando es necesario para comparar columnas, queda dentro de la tabla. |
| Formularios | Etiquetas persistentes, ayudas próximas y validación por regla. Consulta y edición separadas. Importes expresados en pesos al capturar y convertidos exactamente a centavos; fechas operativas en Ciudad de México. |
| Diálogo | Elemento nativo modal, título/descripción, cierre por teclado, foco contenido y retorno al disparador cuando continúa presente. Las incidencias de la operación se muestran dentro del diálogo. |
| Escritura incierta | Se conserva solicitud y UUID por sujeto en almacenamiento de sesión; la interfaz bloquea nuevas escrituras mientras se reconcilia. Un reintento confirmado cierra el formulario anterior y no genera una nueva operación. |
| Conflicto | Mensaje del servidor, datos conservados cuando es posible y actualización explícita antes de confirmar una versión nueva. No simular un éxito ni sobreescribir silenciosamente. |
| Estados | Texto además de color; errores con anuncio accesible y confirmaciones con estado. Las acciones peligrosas solicitan motivo/confirmación según su consecuencia. |

## Comprobación y límites

La suite `tests/portal/responsive.spec.ts` comprueba nueve módulos en 360, 390, 768, 1280 y 1440 px: anchura del documento y reglas automáticas pertinentes de WCAG 2.2 AA con axe. Guarda capturas locales de datos sintéticos fuera de Git. `identity.spec.ts` valida por separado la pantalla de acceso, el teclado, la visibilidad de contraseña y el error genérico. No se graban contraseñas, tokens ni trazas de autenticación.

La inspección manual y las pruebas funcionales siguen siendo obligatorias. Una suite automática no certifica conformidad integral ni sustituye lector de pantalla, ampliación, dispositivos reales, revisión por el personal y aceptación de diseño. Chromium móvil emulado no es Safari físico. Ver [validación](VALIDATION.md) para resultados ejecutados; la existencia de una prueba no prueba su aprobación.

## Trabajo pendiente del goal

Completar verificación manual de teclado/zoom/lector, estados de desconexión y edición no enviada; medir rendimiento con escenario reproducible; revisar densidad de todas las vistas con datos extensos; aprobar marca/contenido con el titular. Mantener coherencia al incorporar importaciones, conciliaciones y reglas de devolución acordadas. El sistema de diseño no habilita información clínica real.
