# PulmonogyClinic

Primera entrega del proyecto digital del Dr. Marco Antonio De Nova Macedo: sitio profesional propuesto y plataforma de demostración para consultorio, farmacia y caja.

**Estado: demo estática v0.1.0. Todos los pacientes, notas, productos, lotes, equipos y cobros son ficticios. No usar para atención clínica ni capturar datos reales.**

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

Salida: `dist/clinic/browser`. Base pública: `/PulmonogyClinic/`. La navegación de los módulos usa fragmentos `#/panel/...` para soportar recarga y enlaces directos en GitHub Pages.

## Qué se puede probar

| Área            | Disponible en esta demo                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sitio propuesto | Diseño adaptable, información profesional pública, servicios, ubicación y enlace externo a Doctoralia.                  |
| Resumen         | Indicadores derivados de los ejemplos, jornada, alertas y accesos rápidos.                                              |
| Recepción       | Filtrar citas, simular una cita, impedir un horario duplicado, llegada, inicio, finalización y cancelación.             |
| Pacientes       | Buscar perfiles ficticios y agregar ejemplos con identificador propio.                                                  |
| Consultas       | Seleccionar paciente, crear notas, guardar borradores, cerrar ejemplos, agregar adendas y exportar JSON.                |
| Inventario      | Buscar y filtrar lotes, entradas y salidas, bloqueo de caducados/cuarentena/faltantes, sugerencia FEFO, bitácora y CSV. |
| Equipos         | Activos ilustrativos y cambio de disponibilidad/mantenimiento.                                                          |
| Caja            | Cobros simulados en centavos, referencia única, reversos con motivo, conciliación de efectivo y CSV.                    |
| Proyecto        | Estado visible de lo demostrado y lo pendiente para producción.                                                         |

Los cambios se conservan en `localStorage` de ese navegador. **No hay backend, autenticación, control de roles, sincronización entre dispositivos, reservas en Doctoralia, firma electrónica, recetas válidas, pagos, CFDI ni certificación clínica.** El cierre de una nota es una demostración visual y lógica, no una firma médica. Los bloqueos de inventario son locales: no prueban concurrencia multiusuario ni transacciones de base de datos.

Fecha operativa fija: **28 de septiembre de 2026**, señalada en la interfaz para que los casos de caducidad y conciliación sean reproducibles. Precios y equipos son ejemplos, no información comercial validada.

## Publicación en GitHub Pages

El workflow `.github/workflows/pages.yml` ejecuta pruebas, compila y publica únicamente el resultado estático. En pull requests solo valida.

El administrador debe habilitar **Settings → Pages → Build and deployment → Source: GitHub Actions** una sola vez. No se incluye ningún token personal en el repositorio. Si Pages todavía no está habilitado, el job de validación puede pasar y el job de despliegue fallará; después de habilitarlo, volver a ejecutar el workflow. Ver [guía de publicación](docs/DEPLOYMENT.md).

## Organización

```text
src/app/       Interfaz Angular, datos sintéticos y reglas de la demo
tests/         Pruebas de reglas de inventario, agenda, notas, caja y exportación
docs/          Alcance, arquitectura, ruta a producción y validaciones
.github/       Construcción, pruebas, publicación y actualización de dependencias
```

Angular **21.2.24 LTS**, TypeScript **5.9.3**, Node **24**. Dependencias fijadas y lockfile versionado. Ver [arquitectura](docs/ARCHITECTURE.md), [backlog](docs/BACKLOG.md), [guion de demo](docs/DEMO_GUIDE.md) y [fuentes de contenido](docs/CONTENT_SOURCES.md).

La marca visual es provisional. Antes de convertir esta propuesta en sitio oficial, el titular debe validar identidad, contenidos, ubicación vigente, servicios, avisos y publicidad aplicable. El sitio de revisión incluye `noindex` y `robots.txt`; esto **no** limita su acceso público.
