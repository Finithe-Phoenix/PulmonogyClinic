# Acceso PulmonogyClinic — desarrollo

Tema `pulmonogy` para Keycloak **26.7.4**. Hereda `keycloak.v2` (PatternFly 5), incluidos sus formularios, labels accesibles, mensajes de validación, manejo de sesión y control para mostrar contraseña. Añade CSS, mensajes españoles, un SVG local y el pequeño hook oficial `footer.ftl`; no copia formularios ni reemplaza JavaScript de autenticación.

Paleta coherente con el portal: marfil `#f6f5f1`, blanco, tinta `#202b39`, azul `#294f88`, grafito `#172333`. El CSS organiza tokens primitivos, semánticos y de componente conforme a la skill de sistema de diseño. Presentación en dos columnas en escritorio, una columna desde 850 px, campos/botones de 48 px y anillos de foco visibles. Modo claro explícito y movimiento reducido respetado.

Los assets oficiales se heredan del JAR de distribución `org.keycloak.keycloak-themes-26.7.4.jar`: `theme/keycloak.v2/login/theme.properties`, `template.ftl` y `resources/css/styles.css`. Los estilos comunes son `vendor/patternfly-v5/patternfly.min.css` y `patternfly-addons.css`, heredados mediante `common/keycloak`. Nuestro CSS se carga **después** de `css/styles.css`. El tema incluye únicamente `locales=es`; el realm fija español como idioma predeterminado y único soportado.

## Instalación nueva

El compose monta `./themes/pulmonogy` en `/opt/keycloak/themes/pulmonogy:ro`. El archivo de importación selecciona `loginTheme: pulmonogy`, internacionalización española y añade el rol `MEDICO`. No añade usuarios médicos, credenciales, MFA ficticio ni autorizaciones al rol.

## Realm existente: conservar usuarios

`--import-realm` omite un realm que ya existe. Modificar el JSON y reiniciar por sí solo no cambia su tema ni sus idiomas. Deben actualizarse únicamente esas propiedades mediante la consola de administración autorizada o Admin REST, conservando usuarios, credenciales, clientes y mapeos.

Antes de recrear `identity`, revisar su almacenamiento: este compose de desarrollo usa el almacenamiento H2 interno del contenedor y no monta `/opt/keycloak/data`. Recrear ese contenedor puede perder su estado. Para una instalación existente, el coordinador debe preservar/migrar ese almacenamiento de forma consistente antes de recrearlo; una alternativa inmediata es copiar solo el directorio del tema al contenedor existente y seleccionar el tema por Admin REST/consola, sin reemplazar el realm.

Cambios concretos de configuración (no ejecutar una importación con overwrite):

1. Hacer disponible el directorio `/opt/keycloak/themes/pulmonogy/login` en la instancia actual.
2. En **Realm settings → Themes**, seleccionar `pulmonogy` como Login theme. El tema fija `darkMode=false`.
3. En **Realm settings → Localization**, habilitar internacionalización, dejar español (`es`) como idioma soportado y predeterminado.
4. Crear el rol de realm `MEDICO` si todavía no existe, sin asignarlo a usuarios ni sustituir roles existentes.

Equivalente de configuración por Admin REST, con identidad de administración autorizada (token obtenido y usado fuera de archivos/logs):

```http
PUT /admin/realms/clinic-dev
Content-Type: application/json

{"loginTheme":"pulmonogy","internationalizationEnabled":true,"supportedLocales":["es"],"defaultLocale":"es"}
```

Consultar primero `GET /admin/realms/clinic-dev/roles/MEDICO`; solo si responde 404, crear con `POST /admin/realms/clinic-dev/roles` y cuerpo `{"name":"MEDICO"}`. No hay razón para reimportar usuarios ni modificar contraseñas. Este README no autoriza cambiar permisos administrativos ni desactivar autenticación para aplicar el tema.

## Verificación pendiente en instancia

El coordinador controla la aplicación live y la validación visual. Abrir el acceso desde el portal con flujo OIDC/PKCE nuevo. Confirmar `lang="es"`, CSS servido con 200, campos `Usuario`/`Contraseña`, botón `Entrar al portal` y rechazo de credenciales inválidas en español. Comprobar 360, 390, 768, 1280 y 1440 px; teclado, foco, password reveal, zoom, formulario vencido y regreso al portal después de autenticación correcta. El error de credenciales no debe revelar si existe un usuario concreto.

Fuentes oficiales consultadas:

- [Temas, herencia, CSS y footer](https://www.keycloak.org/ui-customization/themes)
- [Localización e idioma del realm](https://www.keycloak.org/ui-customization/localization)
- [Importación: omisión de realms existentes](https://www.keycloak.org/server/importExport)
- [Admin REST API 26.7.4](https://www.keycloak.org/docs-api/26.7.4/rest-api/index.html)
- [Propiedades del tema oficial 26.7.4](https://github.com/keycloak/keycloak/blob/26.7.4/themes/src/main/resources/theme/keycloak.v2/login/theme.properties)
