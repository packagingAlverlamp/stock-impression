# Memoria general — Stock Impresión

> Instrucción permanente: **responder siempre en castellano**.
>
> Última actualización: 03/11/2026.

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
- Debe existir un módulo **Pedidos** con proveedor único por pedido, email de
  compras `@alverlamp.es`, seguimiento y conciliación automática de stock.
- La ficha de producto debe incluir el campo **Referencia**.
- Máquina y Proveedor deben tener la misma altura que el resto de campos.
- Toda acción debe dar feedback y bloquearse mientras trabaja (sin dobles
  clics ni botones que parezcan no pulsados).
- En la sesión del 30/10/2026 el usuario pidió **solo documentar** estos
  cambios; la implementación se hace en la siguiente sesión.


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
- Pedidos implementado (02/11/2026) según `PLAN_PEDIDOS.md`:
  - Un pedido = un proveedor; el correo va a su **responsable de compras**, no
    al proveedor, con los datos del proveedor en el cuerpo.
  - El responsable de compras se elige por proveedor en
    `suppliers.purchase_manager_id` (FK a `profiles`, `on delete set null`) y se
    guarda desde el modal de proveedor. Si falta, no se puede enviar el pedido.
  - `purchase_orders.purchase_email` conserva el email del responsable elegido
    como copia histórica, aunque después cambie.
  - El email global de `app_settings` (`purchase_email`) queda obsoleto en la
    interfaz; la tabla y su CHECK de dominio se conservan.
  - Tablas `purchase_orders`, `purchase_order_items` y
    `purchase_order_events`, con copias históricas de nombre, referencia, EAN,
    unidad y datos del proveedor.
  - Estados `draft`, `sent`, `partial`, `received`, `cancelled`.
  - Conciliación automática mediante trigger sobre `stock_movements` de tipo
    `entry`, FIFO por pedido más antiguo; las recepciones parciales dejan la
    línea en `partial`.
  - Dos correos: pedido al responsable del proveedor y aviso al resto del
    equipo con asunto exacto “Pedido realizado a compras”. El aviso indica
    quién es el responsable de compras de ese pedido. El saludo es “Hola,”.
  - El flujo de Nuevo pedido se invirtió el 02/11/2026: primero se muestran los
    suministros con poco stock de todos los proveedores; al marcar el primero se
    fija el proveedor y la lista y el buscador manual se limitan a ese
    proveedor. Los suministros sin proveedor aparecen deshabilitados. Los que
    no están bajo mínimo se añaden con “Añadir otro suministro”.
  - “Recibido” se marca automáticamente al escanear o entrar stock; los
    ajustes manuales quedan como corrección.
  - Aviso de recepción parcial: pasados 7 días desde la primera recepción, un
    cron diario envía un único correo a todos los usuarios `@alverlamp.es`
    excepto el responsable de compras de ese pedido, y guarda
    `partial_notified_at`.
  - La referencia se añadió a `products.reference` y se muestra en tarjeta,
    búsqueda y correos.
  - Los selects Máquina/Proveedor quedan a 46 px con `appearance: none` y
    chevron propio.
  - Auditoría de botones: helper `withBusy`, `flashSuccess`, CSS
    `.btn:disabled` + spinner, bloqueo de modales duplicados y feedback en las
    acciones principales (tabla completa en `PLAN_PEDIDOS.md`, sección 8).


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
- Documentación de la próxima iteración redactada en `PLAN_PEDIDOS.md`:
  modelo de datos, migración, navegación, flujos, correos, conciliación
  automática, referencia de producto, altura de selects y auditoría de botones.
- `MEJORAS.md` actualizado: Pedidos (3.1) figura como implementado.
- Pedidos implementado el 02/11/2026:
  - Migración `20261102120000_purchase_orders.sql` creada y aplicada en remoto:
    referencia, `app_settings`, pedidos, líneas, historial, triggers de
    conciliación, RPC `set_purchase_order_item_received`, RLS y permisos.
  - `supabase/schema.sql` actualizado con el mismo bloque.
  - Vista `#view-orders` con pestañas “Nuevo pedido” y “Seguimiento”. Nuevo
    pedido muestra primero los suministros con poco stock; al marcar el primero
    se fija el proveedor y solo se pueden añadir suministros suyos. El resto se
    añade con “Añadir otro suministro”. Incluye carrito, observaciones,
    borrador y envío.
  - Correos con el copy acordado: pedido al responsable del proveedor y aviso
    al equipo con asunto “Pedido realizado a compras”.
  - Seguimiento con contadores, filtros, búsqueda, detalle por línea,
    historial, reenvío, cancelación y recepción total o parcial.
  - “Recibido” se marca solo al entrar stock o al escanear el suministro; el
    trigger concilia la entrada con el pedido abierto más antiguo.
  - Aviso único de recepción parcial: un cron diario envía a todos los usuarios
    `@alverlamp.es` excepto el responsable del pedido cuando lleva 7 días en
    estado `partial` desde la primera recepción.
  - Conciliación visible al entrar stock desde el stepper, el escaneo o la
    ficha: muestra qué pedido y cuántas unidades se han conciliado.
  - Campo Referencia en alta, edición, tarjeta y búsqueda.
  - Selects a 46 px y estilos de botones con `withBusy`, spinner y estado de
    éxito.
  - Pestañas de Pedidos con el mismo estilo que las de Análisis (subrayado
    teal en la activa), verificado en navegador.
  - `npm run check` y `npm run build` pasan correctamente.
  - Verificado en navegador local con datos simulados: sin errores de consola,
    picker y carrito (2 referencias · 5 unidades), lista de seguimiento y modal
    de detalle.
- Responsable de compras por proveedor (03/11/2026):
  - Migración `20261103120000_supplier_purchase_manager.sql` creada y aplicada
    en remoto: `suppliers.purchase_manager_id` con FK a `profiles` y
    `on delete set null`, más índice.
  - `loadProfiles()` carga los usuarios `@alverlamp.es` y el modal de proveedor
    añade el desplegable “Responsable de compras”. La tabla de proveedores
    muestra la columna y la búsqueda de pedidos no cambia.
  - El banner de **Nuevo pedido** muestra el responsable del proveedor fijado,
    con botón “Asignar/Cambiar” que abre el modal del proveedor. Si falta, el
    envío queda bloqueado con el aviso correspondiente.
  - `submitPurchaseOrder()` guarda el email del responsable en
    `purchase_orders.purchase_email` y bloquea el envío si no hay responsable.
  - `sendPurchaseOrderEmails()` envía el pedido al responsable y el aviso al
    resto de usuarios `@alverlamp.es` (todos, sin depender de
    `notify_low_stock`), excluyendo al responsable. El aviso incluye
    “Responsable de compras: …”.
  - `api/partial-order-reminders.js` excluye ahora solo el `purchase_email` de
    cada pedido (ya no lee `app_settings`).
  - Verificado en navegador local con datos simulados: banner, modal con todos
    los usuarios, bloqueo sin responsable, correo informativo con la línea del
    responsable y sin errores de consola.
- Ajustes de diseño web (03/11/2026, revisados el 04/11/2026):
  - Pantalla de acceso: `body.auth-mode` oculta el menú lateral y centra una
    tarjeta de 460 px con borde superior degradado y sombra; `body.booting`
    evita el parpadeo mientras Supabase resuelve la sesión. Este diseño se
    mantiene porque el usuario lo aprobó.
  - Los enlaces del acceso (“¿Olvidaste tu contraseña?” y “¿No tienes
    cuenta? Regístrate”) quedan en una sola fila con separador, fuera de los
    formularios: el enlace de recuperación solo aparece en el login y toda la
    fila se oculta en el formulario de nueva contraseña. Por debajo de 420 px
    se apilan sin separador.
  - Cada suministro muestra la máquina en un chip “Máquina · …” (o “Sin
    máquina”): en las tarjetas de Inventario, en el picker de poco stock de
    Pedidos, en la búsqueda manual y en el carrito.
  - El resto del rediseño de escritorio (topbar con título de sección,
    contenido a 1080 px, shell a 1240 px) se revirtió el 04/11/2026 porque el
    usuario prefería el diseño anterior; solo se conserva ocultar “Escanear”
    en el sidebar de escritorio.
  - Verificado en navegador: acceso de escritorio con la fila única, cambio
    login/registro y recuperación sin errores de consola; `npm run check` y
    `npm run build` correctos.
- Análisis y endurecimiento de seguridad (10/11/2026):
  - CSP estricta (`script-src 'self'`, `object-src 'none'`,
    `frame-ancestors 'none'`) y cabeceras COOP/CORP/Permissions-Policy en
    `vercel.json`.
  - Librerías de terceros movidas de CDN a `public/vendor/` con versiones
    fijas (supabase-js 2.117.2, html5-qrcode 2.3.8, emailjs-com 3.2.0). La
    inicialización de EmailJS pasa de un script inline a `app.js`.
  - Migración `20261110120000_security_hardening.sql` aplicada en remoto:
    `is_alverlamp_user()` y políticas restrictivas por dominio en todas las
    tablas y en el bucket de fotos; `revoke` a `anon`; trigger que impide
    cambiar `id`/`email` del perfil.
  - API: límite de 25 MB y timeout en `send-email`; `timingSafeEqual` y
    errores genéricos en los crons; CORS restringido en `delete-account`.
  - `finishBoot()` con fallback (rAF + timeout) y red de seguridad de 6 s para
    no dejar la pantalla en blanco si Supabase no responde.
  - Verificado con cabeceras CSP reales en local: librerías cargan, login
    visible, `Html5Qrcode` se inicializa y la CSP bloquea scripts inline y
    `onerror` inyectados. `npm audit`: 0 vulnerabilidades.
  - Informe completo en `SEGURIDAD.md`.
- Correcciones de seguridad pendientes (10/11/2026):
  - MFA TOTP opcional por cuenta: activación con QR y clave manual desde
    Perfil, verificación con `mfa.challengeAndVerify`, baja con `unenroll`, y
    reto AAL2 en el acceso (`#form-mfa`) solo si la cuenta tiene un factor
    verificado. `enterApp()` protegido contra cargas duplicadas.
  - Contraseñas mínimo 10 (Management API) y `minlength`/mensajes del cliente
    alineados. `security_update_password_require_reauthentication=true` y el
    error `reauthentication_needed` se traduce a un mensaje claro en el
    cambio de contraseña.
  - `.github/dependabot.yml` con revisión semanal de `npm` (agrupada
    minor/patch).
  - HIBP (contraseñas filtradas) **no se puede activar**: la API devuelve
    HTTP 402 (“available on Pro Plans and up”).
- Reorganización de menús y pantalla de escaneo (10/11/2026):
  - Se elimina el destino duplicado de Proveedores: ya no está en el sidebar
    de escritorio (`Herramientas`) ni en la hoja “Más” del móvil. Solo se
    llega desde **Taller → Proveedores**.
  - Taller pasa a tener tres pestañas: **Máquinas · Proveedores ·
    Solicitudes**. La tercera es una vista propia (`#view-service`) con el
    título completo “Solicitudes de servicio técnico” dentro. Se elimina el
    layout de dos columnas (`.workshop-machines-grid`).
  - Contador en la pestaña Solicitudes (`[data-service-badge]`, máx. “9+”)
    con las solicitudes `pending` + `in_progress`. Se oculta a 0, actualiza
    `aria-label` y se carga al entrar en la app en segundo plano.
  - Al entrar en Proveedores o Solicitudes se resalta **Taller**, tanto en
    móvil como en escritorio (antes en móvil se resaltaban dos destinos).
  - Menús resultantes:
    - Escritorio: Principal → Inventario, Taller · Herramientas → Añadir,
      Pedidos, Análisis · Cuenta → Perfil. **Escanear sigue oculto**, por
      decisión explícita del usuario (no se escanea desde PC).
    - Móvil: Inventario · Taller · Escanear · Más → Añadir, Pedidos,
      Análisis, Perfil.
  - Botón “+” (`#inventory-add-btn`) junto al buscador de Inventario como
    atajo a “Añadir suministro”.
  - Escanear rediseñado: al entrar solo se ven dos tarjetas grandes,
    “Sacar Stock” y “Añadir Stock”; la cámara solo se enciende al pulsarlas.
    Al leer un código la cámara se oculta y aparece la tarjeta de resultado.
    Botones “Seguir escaneando” y “Elegir otro modo”; el visor tiene además
    “Cerrar”. En ≥601 px las dos tarjetas van en dos columnas.
  - Toast movido fuera de `#shell` (que tiene `backdrop-filter` y
    `overflow:hidden`) y fijado arriba al viewport con `z-index: 2000`, para
    que se vea sin hacer scroll. `#toast.hidden` mantiene `display: flex` con
    `opacity: 0` para que la transición funcione.
  - Escritorio: los botones `.btn` dejan de ocupar todo el ancho del
    contenedor (`width: auto`), salvo en el acceso (`body.auth-mode`).
    Perfil usa `margin: 0 10px 10px 0` para separar botones contiguos.
  - Las tablas de **Análisis** y **Registro de stock** muestran la columna
    **Máquina**. En el registro se resuelve con `machineNameForProductId()`
    a partir de `allProducts`. Colspan actualizado a 9 y 7.
  - `.table-shell.history-table-shell` y `.table-shell.analysis-table-shell`
    suben de especificidad para que `.table-shell` (max-width 760) no recorte
    las tablas; análisis `min-width: 1000px`, registro `860px`.
  - Verificado en navegador con datos simulados (sin errores de consola):
    estados de navegación, contador 2, flujo de escaneo completo por botones,
    tablas con máquina y medidas a 390, 500, 900, 1100 y 1440 px. Las tres
    pestañas caben a 390 px (124 px cada una, sin desbordamiento).
- Taller en dos columnas (10/11/2026) — **sustituido** el 10/11/2026 por las
  tres pestañas de Taller; el CSS `.workshop-machines-grid` se eliminó:
  - En escritorio (≥1100 px) `#view-machines` muestra “Maquinaria” a la
    izquierda y “Solicitudes de servicio técnico” a la derecha
    (`.workshop-machines-grid`, dos `minmax(0, 1fr)` con 28 px de separación y
    `align-items: start`). Por debajo de 1100 px sigue apilado como antes.
  - La cabecera de Máquinas (título + “Nueva máquina”) va dentro de su columna
    y el título de Solicitudes se alinea a la misma altura.
  - En escritorio `#view-machines` lleva `padding-right: 16px` (antes 0) para
    que la columna derecha no toque el borde del panel ni recorte la tarjeta.
  - Verificado con medidas reales: 390/500 px una columna sin desbordamiento,
    900 px una columna de 535 px, 1100 px dos de 353 px, 1440 px dos de 524 px.
- Build de previews de Vercel (10/11/2026):
  - El preview de la rama de Dependabot falló porque `generate-config.js`
    exigía `SUPABASE_URL`/`SUPABASE_ANON_KEY`, variables que solo están
    configuradas en Production. No era un problema de la dependencia.
  - `scripts/generate-config.js` reutiliza ahora el `config.js` versionado
    cuando faltan las variables y `VERCEL_ENV` no es `production`. Son valores
    públicos por diseño. En Production se sigue exigiendo la configuración
    real y el build falla si falta.
  - Verificado simulando el build sin entorno: preview pasa y producción
    falla como debe. La rama de Dependabot se actualizó con `main` y su
    preview vuelve a construir.

### Pendiente

- Activar la verificación en dos pasos en las cuentas que gestionan pedidos y
  valorar exigirla en el proyecto.
- Valorar subir a Supabase Pro para activar la protección de contraseñas
  filtradas (HIBP), bloqueada hoy con HTTP 402.
- Restringir en el panel de EmailJS el dominio permitido a
  `stock-impresion.vercel.app`.
- Revisar la retención de backups de Supabase y probar una restauración.
- Opcional: añadir `SUPABASE_URL`/`SUPABASE_ANON_KEY` al entorno **Preview**
  de Vercel (hoy los previews usan el `config.js` versionado).
- Tras confirmar el nuevo despliegue, eliminar `products.category` con una
  migración posterior.
- Decidir si se configura SMTP antes de dar de alta empleados nuevos.
- Probar el flujo completo de registro con confirmación por email y el enlace
  de vuelta a la web.
- Configurar en la plantilla de EmailJS el asunto `{{subject}}` y el cuerpo
  `{{message}}` para que el aviso lleve el asunto exigido; añadir a
  `TEAM_EMAILS` a todos los posibles responsables de compras si se usa Apps
  Script.
- Asignar responsable de compras a cada proveedor en producción antes de
  enviar pedidos nuevos.
- Probar en producción un pedido real con EmailJS y una entrada de stock que
  concilie la línea y marque “Recibido”.
- Probar el cron de recepción parcial (`/api/partial-order-reminders.js`) con
  `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` y `EMAILJS_PRIVATE_KEY`
  configurados en Vercel.
- Si se quieren adjuntos reales con EmailJS, añadir en la plantilla adjuntos
  variables llamados `photo_1`, `photo_2` y `photo_3`. Sin ese cambio, el
  correo incluye las fotos como enlaces firmados.

### Bloqueado

- Sin bloqueos de migración. La migración de maquinaria ya está aplicada y el
  frontend desplegado. No eliminar `products.category` hasta que la versión
  nueva lleve un tiempo publicada y no queden pestañas antiguas abiertas.

## Siguiente paso

1. Hacer commit + push de los ajustes de diseño web y verificar el despliegue
   (acceso, sidebar sin “Escanear” y chips de máquina).
2. Asignar un responsable de compras a cada proveedor en producción.
3. Configurar EmailJS (`{{subject}}`/`{{message}}`), probar en producción un
   pedido real, su conciliación al entrar stock y el cron de recepción parcial.
4. Probar el registro con un email `@alverlamp.es`, confirmar el correo y
   comprobar que el enlace devuelve a la web con la sesión iniciada.
5. Decidir el tema del SMTP antes de dar de alta empleados nuevos.
6. Probar una solicitud de servicio técnico completa con fotos desde una
   cuenta real y revisar el correo recibido.
7. Crear y aplicar una migración posterior para eliminar `products.category`.

## Ficheros relevantes

- `app.js`: navegación responsive, corrección de cierre de sesión, validación
  de registro, protección de stock a cero, reinicio del escáner, servicio
  técnico con fotos e historial, módulo de pedidos, referencia de producto,
  conciliación visible y helpers `withBusy`/`flashSuccess`.
- `style.css`: alineación de contenido, pestañas de Taller, menú móvil de
  cuatro pestañas, sidebar de escritorio agrupado, campos a 46 px, estados de
  botones y estilos de Pedidos.
- `index.html`: estructura de navegación, vistas de Taller, Pedidos y
  formularios, incluido el campo Referencia.
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
- `PLAN_PEDIDOS.md`: especificación original de Pedidos, referencia, altura de
  selects y auditoría de botones; ya implementada.
- `supabase/migrations/20261102120000_purchase_orders.sql`: pedidos,
  referencia, `app_settings`, historial, conciliación y RPC; aplicada en remoto.
- `supabase/migrations/20261102130000_partial_order_reminders.sql`: primera
  recepción, aviso único y ajuste de las funciones de conciliación; aplicada en
  remoto.
- `supabase/migrations/20261103120000_supplier_purchase_manager.sql`:
  responsable de compras por proveedor; aplicada en remoto.
- `api/partial-order-reminders.js`: cron diario que avisa al equipo de pedidos
  parciales con 7 días.
- `README.md`: instalación, seguridad, desarrollo local y despliegue.
- `.env.example`: plantilla de variables de entorno.
- `.env.local`: configuración local; está ignorada por Git.
- `config.js` y `public/config.js`: configuración generada.
- `package.json`: scripts `config` y `check`.
- `vercel.json`: cabeceras de seguridad y los dos crons (stock bajo y pedidos
  parciales).
- `.gitignore`: permite `.env.example` e ignora `supabase/.temp/`.

## Contexto importante

- Supabase CLI está instalado y conectado al proyecto remoto.
- Migraciones aplicadas en remoto: `20261001000000`, `20261008130000`,
  `20261026110000`, `20261029120000`, `20261030120000`, `20261102120000`,
  `20261102130000` y `20261103120000`.
- No quedan migraciones pendientes en remoto.
- URL de producción: `https://stock-impresion.vercel.app`.
- La configuración de producción usa `APPS_SCRIPT_URL=""` y EmailJS. El
  endpoint SendGrid no lo usa actualmente la app. Por eso las fotos se envían
  como enlaces firmados dentro del mensaje; para adjuntarlas de verdad con
  EmailJS hay que configurar adjuntos variables en la plantilla.
- La plantilla de EmailJS debe usar `{{subject}}` como asunto y `{{message}}`
  como cuerpo; si no, el aviso al equipo no llevará “Pedido realizado a
  compras”. Si se usa Apps Script, todos los posibles responsables de compras
  deben estar en `TEAM_EMAILS`, porque el script solo envía a esa lista blanca.
- El destinatario del pedido sale de `suppliers.purchase_manager_id`; un
  proveedor sin responsable bloquea el envío. `purchase_orders.purchase_email`
  guarda el email usado en cada pedido.
- Vercel ejecuta dos crons: resumen semanal de stock bajo (lunes) y aviso de
  pedidos parciales (diario a las 09:00 UTC). Ambos requieren `CRON_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY` y `EMAILJS_PRIVATE_KEY`; el plan Hobby permite
  exactamente dos cron jobs.
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
- El código de la iteración anterior está en `origin/main`; los cambios de
  Pedidos de esta sesión están sin commitear hasta que el usuario lo confirme.
- La memoria se actualiza después del despliegue; si hay cambios locales
  posteriores, reflejarlos aquí.
