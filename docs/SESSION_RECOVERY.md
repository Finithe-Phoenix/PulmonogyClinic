# Recuperación de sesión sin persistir borradores

Diseño e implementación local: 28/09/2026. Compilación privada aprobada; los cinco escenarios siguientes se ejecutaron en escritorio y móvil con **10/10 aprobados**. La regresión conjunta se registra por separado en [VALIDATION](VALIDATION.md).

## Contrato

El portal intenta renovar antes del vencimiento mediante `oidc-client-ts` 3.5.0 y el proveedor real. No cambia el TTL del realm ni omite autenticación. Usa la renovación soportada por [UserManager.signinSilent](https://authts.github.io/oidc-client-ts/classes/UserManager.html), preferentemente con refresh token; un fallo de renovación, expiración o respuesta API 401 bloquea el espacio. Los tokens permanecen en `InMemoryWebStorage`.

Durante el bloqueo se conserva el usuario anterior como contexto **no autorizado para peticiones**. El servicio central rechaza lecturas, escrituras y reintentos antes de llegar a la red. Una compuerta de contexto descarta respuestas iniciadas antes del bloqueo/cambio de identidad. Esto no cancela ni deshace una operación que el servidor ya pudo recibir: su clave de idempotencia permanece para consulta/reintento explícito por la misma cuenta.

Una renovación ordinaria exitosa con identidad y roles sin cambios no invalida solicitudes en vuelo. No se envían automáticamente los formularios o comandos pendientes después de recuperar la sesión.

## Formulario y foco

El outlet y los componentes permanecen montados en un contenedor oculto e `inert`; el bloqueo no sustituye la pantalla por un nuevo login destructivo. Los diálogos nativos abiertos se cierran sin emitir el evento que descartaría el formulario. La pantalla independiente de recuperación recibe el foco. Al volver la misma identidad y permisos, el diálogo se abre de nuevo y recupera su último control enfocado.

Esta preservación es únicamente en memoria de la pestaña: no se serializan borradores en localStorage, sessionStorage, IndexedDB, archivos ni servidor. Cerrar/recargar la pestaña o navegar deliberadamente fuera puede perderlos; el aviso de bloqueo lo explica. Ocultar el DOM no es cifrado frente a herramientas de desarrollo o scripts con acceso al mismo origen. No habilita el uso de datos clínicos reales.

El estado transitorio OIDC de la redirección inicial sigue en sessionStorage. Es distinto de tokens y borradores. También se conserva el mecanismo existente de **comandos ya enviados**, con cuerpo y clave idempotente en sessionStorage por sujeto, para recuperar resultados inciertos. No se amplía esa persistencia a formularios sin enviar. El despliegue productivo debe revisar por separado dicha política de comandos y su sensibilidad.

## Reautenticación explícita

El botón abre [signinPopup](https://authts.github.io/oidc-client-ts/classes/UserManager.html) con `prompt=login` y PKCE. Se usa exactamente `http://localhost:4180/`, ya permitido por el cliente local; no se agrega wildcard, otro URI ni excepción CSP. La ventana de retorno con opener notifica al UserManager original mediante `signinPopupCallback`; allí se validan estado/protocolo y se canjea el código. La aplicación no procesa manualmente contraseñas, códigos o tokens ni los escribe en logs.

La recuperación compara emisor, sujeto y roles. Si cualquiera cambia, primero se desmonta el espacio anterior y sus diálogos, luego se navega a Inicio y se presenta la nueva identidad. El pendiente activo anterior se limpia; otra cuenta solo puede recuperar su propia clave de comando. Un cambio de roles no restaura automáticamente el pendiente previo. Los registros almacenados de otra cuenta no se borran ni se transfieren.

Si la ventana emergente se bloquea, se cierra o no consigue completar el protocolo, el portal sigue bloqueado y el formulario permanece en memoria. Se ofrecen reintento y cierre de sesión explícito con advertencia de descarte. No se usa redirección automática como fallback porque recargaría la pestaña y perdería el borrador. Si un navegador/proveedor separa el opener o no permite este flujo, ese fallo debe mostrarse y validarse; no se relaja autenticación para sortearlo. La renovación por iframe puede estar limitada por CSP/cookies: sin renovación válida, se requiere el popup explícito.

## Evidencia ejecutada

`tests/portal/session.spec.ts` usa Keycloak real y datos sintéticos. Cubre:

- 401 de lectura inyectado solo como respuesta: formulario oculto y deshabilitado, compuerta de API, recuperación de la misma cuenta y foco.
- Cierre del popup y segundo intento sin pérdida de borrador.
- Cambio de cuenta con comando pendiente: desmontaje, ausencia de datos/pendiente anterior y cero reenvíos automáticos.
- Renovación real mientras una respuesta de escritura está retenida: confirmación del único comando, sin invalidación por renovación ordinaria.
- Fallo de renovación: bloqueo y conservación solo en memoria.

Los casos de renovación adelantan exclusivamente el reloj del navegador, sin cambiar expiraciones del servidor, crear JWT ni simular un proveedor. El ensayo con escritura adelanta primero el reloj sin peticiones pendientes y cruza después el umbral de renovación dentro del timeout normal de la petición. Capturas, videos y trazas están desactivados. La prueba de almacenamiento devuelve solo indicadores booleanos, nunca su contenido. La regresión de recuperación idempotente y los resultados conjuntos se documentan en VALIDATION.
