# Publicación del sitio oficial

El sitio público funciona en dos modos, controlados solo por [`src/site.config.json`](../src/site.config.json):

| | Propuesta (`official: false`, actual) | Oficial (`official: true`) |
| --- | --- | --- |
| Buscadores | `noindex` y `robots.txt` con `Disallow: /` | `index,follow`, `robots.txt` con `Allow`, `sitemap.xml` y URL canónica |
| Avisos | Barra "Propuesta · No oficial", pie de demostración, notas de identidad provisional | Sin avisos de demo; pie con © y aviso de privacidad si se configura |
| Demo de gestión | Accesible en `#/panel/...` | Oculta; las rutas del panel regresan al inicio |
| Contacto | Perfil de Doctoralia | WhatsApp o teléfono confirmados; horario, correo y Doctoralia como respaldo |
| Datos estructurados | No | `Physician` de schema.org con dirección, teléfono y horario |

`npm run build:pages` ejecuta `scripts/site-mode.mjs`, que **rechaza el build** si el modo oficial no tiene aprobación, URL, contacto y horario válidos, o si no puede aplicar alguna sustitución al HTML. No se inventan datos: cada campo debe venir confirmado por el titular.

## Datos que debe confirmar el titular

| Campo | Ejemplo de formato | Obligatorio en modo oficial |
| --- | --- | --- |
| `approvedBy` | Nombre de quien autoriza la publicación | Sí |
| `approvedOn` | `2026-11-03` | Sí |
| `canonicalUrl` | `https://www.dominio-del-consultorio.mx/` o `https://finithe-phoenix.github.io/PulmonogyClinic/` | Sí |
| `phone` | `+52 722 123 4567` | Uno de los dos |
| `whatsapp` | `527221234567` (12 dígitos, sin + ni espacios) | Uno de los dos |
| `hours` | `[{"days":"Lunes a viernes","time":"10:00 a 14:00","schema":"Mo-Fr 10:00-14:00"}]` | Sí, al menos uno |
| `email` | `recepcion@dominio.mx` | No |
| `privacyNoticeUrl` | URL https del aviso de privacidad | Recomendado |

`schema` es opcional en cada horario y solo alimenta los datos estructurados para buscadores.

## Antes de activar

1. Aprobación escrita del titular sobre textos, servicios, dirección y canales de contacto. Confirmar que la sede de Plaza PAME sigue vigente.
2. Aviso de privacidad: el sitio no recibe datos ni archivos, pero el contacto por WhatsApp o teléfono sí implica tratamiento de datos personales por el consultorio. Conviene publicarlo y enlazarlo en `privacyNoticeUrl`; su contenido corresponde al responsable y a su asesoría legal.
3. Dominio propio (opcional): registrar el dominio, configurarlo en *Settings → Pages → Custom domain* con HTTPS forzado y apuntar el DNS a GitHub Pages. El script genera `CNAME` cuando `canonicalUrl` no es `github.io`.
4. Alinear el perfil de Doctoralia y Google Business Profile con el mismo teléfono, dirección y horario.
5. Pendientes editoriales que siguen siendo del titular: fotografía, marca/logotipo definitivo y cédula profesional (solo si decide publicarla y tras cotejo).

## Activación

1. Editar `src/site.config.json` con los datos confirmados y `"official": true`.
2. `npm run check`: debe terminar sin errores. El build imprime `Modo oficial aplicado para ...` y la suite E2E cambia sola a `tests/e2e/official.spec.ts` (indexación, ausencia de demo, contacto, horario y accesibilidad a 360/768/1280 px).
3. Revisar en local con `npm run preview`; el servidor toma la ruta base del build (`/PulmonogyClinic/` en Pages, `/` con dominio propio).
4. Commit y PR. Al fusionar a `main`, el workflow de Pages publica.
5. Después de publicar: dar de alta el sitio en Google Search Console, enviar `sitemap.xml` y validar los datos estructurados con la prueba de resultados enriquecidos.

El 26/10/2026 se validaron ambos modos: propuesta con 468 pruebas unitarias y 32 E2E, y oficial, con datos de prueba y dominio propio, con 12 E2E y revisión visual. Los datos de prueba no se versionaron.

Para volver al modo propuesta basta `"official": false`.
