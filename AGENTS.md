# Memoria general — Stock Impresión

> Instrucción permanente: **responder siempre en castellano**.
>
> Última actualización: 30/10/2026.

## Objetivo

Implementar las correcciones P0 detectadas en el análisis del proyecto Stock
Impresión y aportar propuestas de mejora de usabilidad y funcionalidades.

Además, restringir el registro a emails `@alverlamp.es`, con aplicación real
en el servidor y no solo en el formulario.

## Requisitos

- El usuario aprobó implementar las correcciones P0.
- El usuario pidió también propuestas de mejora de usabilidad y
  funcionalidades.
- El registro debe limitarse a emails `@alverlamp.es`.
- El menú móvil debe ser exactamente **Inventario · Taller · Escanear · Más**.
- En escritorio se puede ver todo, agrupado por secciones; Taller agrupa
  Máquinas y Proveedores.
- Las solicitudes de servicio técnico deben guardar historial de estados y
  permitir adjuntar fotos.


## Decisiones tomadas

- Se corrigieron `.env.local` y `config.js` locales usando la URL y la clave
  anónima públicas válidas del proyecto de Supabase.
- `scripts/generate-config.js` ahora carga `.env.local`, valida los valores y
  genera tanto `config.js` como `public/config.js`.
- La restricción de dominio se aplica en dos capas:
  1. Validación en el formulario.
  2. Trigger de Supabase que sustituye a `public.handle_new_user()` y aborta
     el alta si el email no pertenece a `@alverlamp.es`.
- `/api/send-email` se protegió con `EMAIL_API_SECRET`, CORS restringido,
  validación de destinatarios y respuestas de error genéricas.
- El Apps Script se reescribió para enviar solo a `TEAM_EMAILS` y aplicar
  límites horarios y diarios. No usa secreto compartido porque el script se
  invoca desde el navegador y cualquier secreto sería público.
- Se eliminaron `send_email.php` y `config.example.js`, y se añadió
  `.env.example`.
- Se añadió la migración
  `20261029120000_restrict_signup_domain.sql`.
- Se añadieron cabeceras de seguridad en Vercel y el script `npm run check`.
- La navegación móvil se redujo a cuatro pestañas: Inventario, Taller,
  Escanear y Más. Añadir, Proveedores, Análisis y Perfil quedan dentro de Más
  o de Taller. En escritorio el sidebar muestra todos los destinos agrupados en
  Principal, Herramientas y Cuenta.
- Taller agrupa Máquinas y Proveedores con pestañas internas.
- El historial de estados de servicio técnico se guarda en
  `maintenance_request_events` mediante trigger de Supabase.
- Las fotos de servicio técnico se guardan en el bucket privado
  `service-request-photos`, se comprimen en el navegador y se enlazan con URLs
  firmadas en el correo. El Apps Script y SendGrid las adjuntan; EmailJS
  incluye enlaces y variables `photo_1`…`photo_3` para adjuntos variables.


## Estado del trabajo

### Completado

- Reparación de la configuración local y del generador de configuración.
- `npm run build` y `npm run check` pasan correctamente.
- Corregido `app.js`: `supabase.auth.signOut()` → `supabaseClient.auth.signOut()`.
- Restricción de registro en el formulario, verificada en navegador: un email
  como `persona@gmail.com` muestra “Solo se permiten cuentas con email
  @alverlamp.es”.
- Migración de restricción de dominio aplicada en Supabase remoto.
- Endpoint de email endurecido; las pruebas simuladas devuelven 503, 401, 403
  y 400 en los casos esperados.
- Apps Script endurecido y sintaxis validada.
- Eliminados `send_email.php` y `config.example.js`.
- Eliminados del índice de Git los restos de `path/` y `supabase/.temp/*`.
- Añadidos `.env.example`, `MEJORAS.md`, cabeceras de Vercel y documentación
  actualizada en `README.md`.
- Confirmación por email activada en Supabase (`mailer_autoconfirm: false`).
- Corregida la contradicción del `README.md` sobre la confirmación por email.
- Migración de maquinaria aplicada en remoto. Se conserva
  `products.category` temporalmente para que la versión antigua siga
  funcionando durante el despliegue.
- Commit `42a6cfe` subido a `origin/main` y desplegado en Vercel.
- Verificado en producción: la web carga sin errores y el registro con un
  dominio distinto sigue bloqueado.
- Prueba de humo en navegador: la app carga sin errores de consola y el
  formulario de registro funciona.
- Corregida la alineación de Máquinas: cabecera, tarjetas, pestañas de Taller e
  historial comparten el ancho de contenido de 760 px y el mismo borde izquierdo
  que Proveedores.
- Menú móvil reducido a Inventario · Taller · Escanear · Más, verificado en un
  viewport de 375 px.
- Sidebar de escritorio agrupado en Principal, Herramientas y Cuenta.
- Taller agrupa Máquinas y Proveedores con pestañas internas.
- Servicio técnico: historial de estados con fecha y usuario, y hasta 6 fotos
  comprimidas y guardadas en Supabase Storage.
- Migración `20261030120000_service_request_history_and_photos.sql` aplicada
  en Supabase remoto.
- `npm run check` y `npm run build` pasan correctamente.
- Commit `f31b74d` subido a `origin/main` y desplegado en Vercel.
- Verificado en producción: la web carga sin errores de consola y el menú de
  escritorio muestra las secciones Principal, Herramientas y Cuenta.

### Pendiente

- Tras confirmar el nuevo despliegue, eliminar `products.category` con una
  migración posterior.
- Decidir si se configura SMTP antes de dar de alta empleados nuevos.
- Probar el flujo completo de registro con confirmación por email y el enlace
  de vuelta a la web.
- Si se quieren adjuntos reales con EmailJS, añadir en la plantilla adjuntos
  variables llamados `photo_1`, `photo_2` y `photo_3`. Sin ese cambio, el
  correo incluye las fotos como enlaces firmados.

### Bloqueado

- Sin bloqueos de migración. La migración de maquinaria ya está aplicada y el
  frontend desplegado. No eliminar `products.category` hasta que la versión
  nueva lleve un tiempo publicada y no queden pestañas antiguas abiertas.

## Siguiente paso

1. Probar el registro con un email `@alverlamp.es`, confirmar el correo y
   comprobar que el enlace devuelve a la web con la sesión iniciada.
2. Decidir el tema del SMTP antes de dar de alta empleados nuevos.
3. Probar una solicitud de servicio técnico completa con fotos desde una
   cuenta real y revisar el correo recibido.
4. Crear y aplicar una migración posterior para eliminar `products.category`
   cuando la versión nueva lleve un tiempo publicada.

## Ficheros relevantes

- `app.js`: navegación responsive, corrección de cierre de sesión, validación
  de registro, protección de stock a cero, reinicio del escáner, servicio
  técnico con fotos e historial.
- `style.css`: alineación de contenido, pestañas de Taller, menú móvil de
  cuatro pestañas y sidebar de escritorio agrupado.
- `index.html`: estructura de navegación, vistas de Taller y formularios.
- `scripts/generate-config.js`: carga `.env.local`, valida y genera la
  configuración.
- `api/send-email.js`: endpoint SendGrid protegido y con soporte de adjuntos.
- `google-apps-script/Code.gs`: envío limitado a la lista blanca del equipo y
  soporte de adjuntos.
- `supabase/schema.sql`: esquema canónico actualizado.
- `supabase/migrations/20261029120000_restrict_signup_domain.sql`: migración
  de dominio aplicada en remoto.
- `supabase/migrations/20261026110000_machinery_and_service_requests.sql`:
  migración de maquinaria y solicitudes aplicada en remoto.
- `supabase/migrations/20261030120000_service_request_history_and_photos.sql`:
  historial de estados, fotos y bucket de Storage; aplicada en remoto.
- `MEJORAS.md`: propuestas de usabilidad y funcionalidades.
- `README.md`: instalación, seguridad, desarrollo local y despliegue.
- `.env.example`: plantilla de variables de entorno.
- `.env.local`: configuración local; está ignorada por Git.
- `config.js` y `public/config.js`: configuración generada.
- `package.json`: scripts `config` y `check`.
- `vercel.json`: cabeceras de seguridad.
- `.gitignore`: permite `.env.example` e ignora `supabase/.temp/`.

## Contexto importante

- Supabase CLI está instalado y conectado al proyecto remoto.
- Migraciones aplicadas en remoto: `20261001000000`, `20261008130000`,
  `20261026110000`, `20261029120000` y `20261030120000`.
- No quedan migraciones pendientes en remoto.
- URL de producción: `https://stock-impresion.vercel.app`.
- La configuración de producción usa `APPS_SCRIPT_URL=""` y EmailJS. El
  endpoint SendGrid no lo usa actualmente la app. Por eso las fotos se envían
  como enlaces firmados dentro del mensaje; para adjuntarlas de verdad con
  EmailJS hay que configurar adjuntos variables en la plantilla.
- **Confirmación de email activada**: la configuración remota devuelve
  `mailer_autoconfirm: false`. Al registrarse, Supabase envía un correo y la
  cuenta no tiene acceso hasta confirmarlo.
- Configuración de Auth revisada tras el cambio: `site_url` de producción,
  redirects vacías, MFA TOTP activo, OTP de 8 dígitos y frecuencia de 1 minuto.
- **SMTP**: el usuario decidió no configurar SMTP por ahora (30/10/2026) por
  el volumen bajo de correos. Ojo: el SMTP integrado de Supabase solo entrega
  a miembros del equipo de la organización y está limitado a 2 correos por
  hora. Sin SMTP, los nuevos usuarios `@alverlamp.es` que no sean miembros del
  equipo de Supabase no podrán recibir la confirmación. Pendiente decidir
  entre SMTP propio, alta manual de cuentas o desactivar la confirmación.
- Si se desactiva la confirmación, la restricción de dominio no verifica que
  la persona controle el buzón: alguien podría registrarse con una dirección
  `@alverlamp.es` ajena y entrar sin confirmarla. No se recomienda desactivarla.
- El trigger de dominio aborta altas de otros dominios, pero **no elimina**
  cuentas antiguas ya existentes. La migración incluye una consulta SQL de
  auditoría como comentario.
- No exponer valores privados de `.env.local`.
- `public/` se genera pero está versionado; el build lo actualiza.
- El código de esta iteración está commiteado y subido a `origin/main`.
- La memoria se actualiza después del despliegue; si hay cambios locales
  posteriores, reflejarlos aquí.
