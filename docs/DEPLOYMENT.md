# Publicar la demo en GitHub Pages

Repositorio: `Finithe-Phoenix/PulmonogyClinic`. Se respeta la ortografía existente del nombre.

1. Abrir **Settings → Pages** con una cuenta que pueda administrar este repositorio.
2. En **Build and deployment**, elegir **GitHub Actions** como Source.
3. Ir a **Actions → Validate and deploy demo** y ejecutar el workflow sobre `main`, o volver a ejecutar el job fallido después de habilitar Pages.
4. Esperar `validate` y `deploy` en verde. La URL publicada aparece en el environment `github-pages` y en la salida `page_url`.
5. Probar la raíz del proyecto y `#/panel/resumen`, navegación, recarga y versión móvil. Comprobar que el sitio dice Demo y no contiene datos reales.

El workflow no incluye token personal ni intenta ampliar permisos de la cuenta. `configure-pages` normalmente requiere que Pages esté habilitado; su opción de auto-habilitación no funciona con el `GITHUB_TOKEN` ordinario, según el [contrato de la acción v5](https://github.com/actions/configure-pages/blob/v5/action.yml). No insertar PAT en código o variables públicas.

## Comportamiento

- Cada push a `main` ejecuta pruebas y compila antes de desplegar.
- La validación ejecuta también Playwright en escritorio y pantalla móvil sobre la compilación estática, servida bajo el prefijo real `/PulmonogyClinic/`.
- Actions conserva el reporte y las capturas ficticias en el artefacto `demo-browser-report` durante siete días.
- En PR solo valida; no despliega el contenido de una contribución sin integrar.
- `npm ci` usa `package-lock.json`. Node 24; Angular 21 LTS.
- Solo se publica `dist/clinic/browser`. No se despliega el repositorio completo.
- El `base-href` es `/PulmonogyClinic/`. Si se renombra el repositorio, debe actualizarse.
- Las rutas usan `#` para que la recarga no requiera rewrites de servidor.
- No cambiar dominio ni publicar como sitio oficial hasta validar marca y contenidos.

## Incidencias frecuentes

| Síntoma                                                          | Acción                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Validación verde, error `Get Pages site` / `Not Found` en deploy | Habilitar Source: GitHub Actions en Pages; volver a ejecutar.                              |
| CSS/JS 404                                                       | Confirmar nombre del repositorio y base-href.                                              |
| Cambios ficticios anteriores                                     | Botón Restablecer datos; afecta únicamente al almacenamiento de esa demo en ese navegador. |
| Cambios no aparecen en otro dispositivo                          | La demo conserva ejemplos locales; todavía no se conecta a la API privada.                          |

## Revertir una entrega

Crear un commit de reversión del cambio defectuoso y ejecutar el mismo workflow. No reescribir el historial. No hay datos clínicos que migrar en esta demo.

## Servidor privado

Pages publica únicamente Angular. La API Spring Boot se compila y prueba con PostgreSQL en `.github/workflows/api.yml`; no se despliega desde este workflow. Su arranque local y variables de identidad están descritos en [backend/README.md](../backend/README.md). No añadir claves ni credenciales de base al build de Angular. El hosting privado, HTTPS, proveedor de identidad y respaldos se configurarán por separado.
