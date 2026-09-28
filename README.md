# PulmonogyClinic

Proyecto digital del Dr. Marco Antonio De Nova Macedo: sitio profesional propuesto y plataforma de demostración para consultorio, farmacia y caja.

**Estado: v0.4.0 — sitio y demo Angular + API privada de inventario y compras. Todos los pacientes, proveedores, compras, notas, productos, lotes, equipos y cobros son ficticios. No usar para atención clínica ni capturar datos reales.**

![Propuesta del sitio del doctor](docs/previews/sitio-desktop.jpg)

[Sitio completo](docs/previews/sitio-completo.png) · [Sitio en celular](docs/previews/sitio-mobile.jpg) · [Inventario en escritorio](docs/previews/inventario-desktop.png) · [Inventario en celular](docs/previews/inventario-mobile.png) · [Ver el panel de gestión](docs/previews/panel-desktop.png) · [Compras en escritorio](docs/previews/compras-desktop.png) · [Compras en celular](docs/previews/compras-mobile.png) · [Guion para presentar la demo](docs/DEMO_GUIDE.md) · [Validaciones y límites](docs/VALIDATION.md)

## Ejecutar

Node.js 24 (>=24.15), npm y Git.

```bash
npm ci
npm start
```

Abrir la dirección que indique Angular. Para compilar como proyecto de GitHub Pages:

```bash
npm test
npm run build:pages
```

Para comprobar los flujos en navegador, instalar Chromium de Playwright una vez y ejecutar:

```bash
npx playwright install chromium
npm run check
```

`check` ejecuta reglas de dominio, compilación de producción y pruebas de navegación, agenda, inventario, notas y caja en escritorio y pantalla móvil. La emulación móvil usa Chromium; no sustituye una prueba en Safari/iPhone real. Para revisar el resultado compilado localmente: `npm run preview` y abrir `http://127.0.0.1:4173/PulmonogyClinic/`.

Si el navegador bloquea el almacenamiento, la interfaz muestra un aviso permanente de modo temporal: los cambios de esa sesión se pierden al recargar.

Salida: `dist/clinic/browser`. Base pública: `/PulmonogyClinic/`. La navegación de los módulos usa fragmentos `#/panel/...` para soportar recarga y enlaces directos en GitHub Pages.

## Qué se puede probar

| Área            | Disponible en esta demo                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sitio propuesto | Diseño adaptable, cuatro servicios, guía de visita, seis preguntas frecuentes, ubicación y contacto en Doctoralia.                  |
| Resumen         | Indicadores derivados de los ejemplos, jornada, alertas y accesos rápidos.                                              |
| Recepción       | Filtrar citas, simular una cita, impedir un horario duplicado, llegada, inicio, finalización y cancelación.             |
| Pacientes       | Buscar perfiles ficticios y agregar ejemplos con identificador propio.                                                  |
| Consultas       | Seleccionar paciente, crear notas, guardar borradores, cerrar ejemplos, agregar adendas y exportar JSON.                |
| Inventario      | Dar de alta productos y lotes, buscar, registrar entradas/salidas, bloquear caducados/cuarentena/faltantes, FEFO y CSV. |
| Compras         | Proveedores ficticios, órdenes de varias partidas, recepción parcial por lote, cuarentena, cancelación del saldo y CSV. |
| Equipos         | Activos ilustrativos y cambio de disponibilidad/mantenimiento.                                                          |
| Caja            | Cobros simulados en centavos, referencia única, reversos con motivo, conciliación de efectivo y CSV.                    |
| Proyecto        | Estado visible de lo demostrado y lo pendiente para producción.                                                         |

Los cambios se conservan en `localStorage` de ese navegador. **La interfaz pública no está conectada a la API privada. No hay sincronización entre dispositivos, reservas en Doctoralia, firma electrónica, recetas válidas, pagos, CFDI ni certificación clínica.** El cierre de una nota es una demostración visual y lógica, no una firma médica. Los bloqueos de la demo son locales. El módulo `backend` implementa por separado transacciones PostgreSQL, permisos por JWT, lotes, movimientos, cuarentena e idempotencia. Su conexión al portal y al proveedor de identidad aún está pendiente; ver [API privada y puesta en marcha](backend/README.md).

La v0.4.0 agrega al servidor **proveedores, órdenes de varias partidas y recepciones parciales**. Crear una orden no cambia el stock. Confirmar una entrega guarda lote, entrada, costo de la partida, saldo recibido y auditoría en una sola transacción; una cancelación administrativa conserva lo recibido y cierra únicamente lo pendiente. Incluye migración desde la v0.3.0 y pruebas de reintentos, permisos y concurrencia. [Contrato de compras](backend/docs/PURCHASING_API.md).

**Validación:** 86 casos aprobados: 25 de reglas, 22 de navegador y 39 del servidor con PostgreSQL, incluida la migración. [Ejecuciones y límites](docs/VALIDATION.md).

Fecha operativa fija: **28 de septiembre de 2026**, señalada en la interfaz para que los casos de caducidad y conciliación sean reproducibles. Precios y equipos son ejemplos, no información comercial validada.

## Publicación en GitHub Pages

El workflow `.github/workflows/api.yml` valida la API en PostgreSQL 17 con tokens firmados de prueba. El workflow `.github/workflows/pages.yml` ejecuta pruebas, compila y publica únicamente el resultado estático. En pull requests solo valida.

El administrador debe habilitar **Settings → Pages → Build and deployment → Source: GitHub Actions** una sola vez. No se incluye ningún token personal en el repositorio. Si Pages todavía no está habilitado, el job de validación puede pasar y el job de despliegue fallará; después de habilitarlo, volver a ejecutar el workflow. Ver [guía de publicación](docs/DEPLOYMENT.md).

## Organización

```text
backend/       API Java 21 + Spring Boot, PostgreSQL, migraciones y pruebas HTTP
src/app/       Interfaz Angular, datos sintéticos y reglas de la demo
tests/         Pruebas de reglas de inventario, agenda, notas, caja y exportación
docs/          Alcance, arquitectura, ruta a producción y validaciones
.github/       Construcción, pruebas, publicación y actualización de dependencias
```

Angular **21.2.24 LTS**, TypeScript **5.9.3**, Node **24**. Dependencias fijadas y lockfile versionado. Ver [arquitectura](docs/ARCHITECTURE.md), [backlog](docs/BACKLOG.md), [guion de demo](docs/DEMO_GUIDE.md) y [fuentes de contenido](docs/CONTENT_SOURCES.md).

La marca visual es provisional. Antes de convertir esta propuesta en sitio oficial, el titular debe validar identidad, contenidos, ubicación vigente, servicios, avisos y publicidad aplicable. El sitio de revisión incluye `noindex` y `robots.txt`; esto **no** limita su acceso público.
