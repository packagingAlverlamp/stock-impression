# Análisis de seguridad · Stock Impresión

**Fecha:** 10/11/2026
**Alcance:** frontend estático (`index.html`, `app.js`, `style.css`), API
serverless de Vercel (`api/*.js`), Edge Function `delete-account`, base de
datos y Storage de Supabase, cabeceras de despliegue y secretos del
repositorio.

---

## 1. Resumen ejecutivo

La aplicación no tenía vulnerabilidades críticas explotables de forma remota,
pero sí varias debilidades reales: no había CSP, se ejecutaba JavaScript de
CDNs externos sin fijar versión, las cuentas antiguas de dominios distintos a
`@alverlamp.es` conservaban acceso completo a los datos y el email del perfil
se podía cambiar desde el cliente.

Todas ellas están corregidas en este cambio. Los riesgos que quedan son
decisiones de producto o configuración del panel de Supabase/EmailJS y están
listados en la sección 5.

| Área | Antes | Ahora |
| --- | --- | --- |
| XSS | Sin CSP, librerías desde CDN sin pin | CSP estricta + librerías propias |
| Acceso a datos | Cualquier cuenta autenticada | Solo JWT `@alverlamp.es` |
| Identidad del perfil | Email modificable por el usuario | Inmutable desde el cliente |
| API de correo | Sin límite de cuerpo | 25 MB, timeout, comparación segura |
| Crons | Comparación no constante, errores internos | `timingSafeEqual` y errores genéricos |
| Edge Function | CORS `*` | Orígenes permitidos explícitos |

---

## 2. Medidas aplicadas

### 2.1 Cabeceras y Content Security Policy

`vercel.json` envía ahora, en todas las rutas:

- `Content-Security-Policy` con:
  - `default-src 'self'`, `script-src 'self'`
  - `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`,
    `form-action 'self'`
  - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
  - `font-src 'self' https://fonts.gstatic.com`
  - `img-src 'self' data: blob: https://*.supabase.co`
  - `connect-src 'self' https://*.supabase.co wss://*.supabase.co
    https://api.emailjs.com https://script.google.com
    https://script.googleusercontent.com`
  - `worker-src 'self' blob:`, `upgrade-insecure-requests`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Permitted-Cross-Domain-Policies: none`
- `Permissions-Policy` con cámara solo para el propio origen.
- Se mantienen HSTS, `X-Frame-Options: DENY`, `nosniff` y
  `Referrer-Policy: strict-origin-when-cross-origin`.

Efecto: aunque se colara HTML malicioso, el navegador no ejecuta scripts
inline, ni `onerror`/`onclick`, ni código de dominios no autorizados.

### 2.2 Librerías de terceros servidas desde el propio dominio

Antes se cargaban desde CDN y sin fijar versión:

- `@supabase/supabase-js@2` (siempre la última 2.x)
- `html5-qrcode@2.3.8`
- `emailjs-com@3`

Ahora están en `public/vendor/` con versiones fijas
(`supabase-js@2.117.2`, `html5-qrcode@2.3.8`, `emailjs-com@3.2.0`) y se
sirven con `Cache-Control: immutable`. Se elimina el riesgo de que un CDN
comprometido inyecte código y se simplifica la CSP a `script-src 'self'`.

La inicialización de EmailJS que estaba en un `<script>` inline se movió a
`app.js`.

### 2.3 Acceso a datos limitado al dominio corporativo

Nueva migración `20261110120000_security_hardening.sql`, aplicada en remoto:

- Función `public.is_alverlamp_user()`: comprueba el claim `email` del JWT.
- Política **restrictiva** `solo_dominio_corporativo` en `profiles`,
  `suppliers`, `products`, `machines`, `maintenance_requests`,
  `maintenance_request_events`, `stock_movements`, `purchase_orders`,
  `purchase_order_items`, `purchase_order_events` y `app_settings`. Se combina
  con AND con las políticas existentes: una cuenta de otro dominio, aunque
  conserve sesión, no ve ni modifica nada.
- Política restrictiva equivalente en `storage.objects` para el bucket
  `service-request-photos`.
- `revoke all ... from anon` en todas las tablas y en la RPC de recepción.
- Trigger `profiles_protect_identity`: el `id` y el `email` del perfil no se
  pueden cambiar desde el cliente (antes se podía desviar los avisos a otra
  cuenta).

Consulta de auditoría para cuentas antiguas fuera de dominio:

```sql
select id, email from public.profiles
where split_part(lower(trim(email)), '@', 2) <> 'alverlamp.es';
```

### 2.4 API serverless

- `api/send-email.js`: límite de 25 MB de cuerpo (responde 413), timeout de
  15 s contra SendGrid, comparación del secreto en tiempo constante,
  destinatarios y adjuntos validados (ya existía).
- `api/weekly-low-stock.js` y `api/partial-order-reminders.js`: comparación de
  `CRON_SECRET` con `crypto.timingSafeEqual`, timeout de las llamadas a
  EmailJS y errores genéricos al cliente (el detalle se registra en los logs).
- `delete-account` (Edge Function): CORS limitado a `ALLOWED_ORIGIN`
  (producción y `localhost:3000` por defecto), método POST obligatorio, JWT
  verificado y errores internos ya no se devuelven.

### 2.5 Robustez del acceso

`finishBoot()` ya no depende solo de `requestAnimationFrame` (que se pausa en
pestañas en segundo plano) y hay un temporizador de 6 s que muestra el acceso
aunque Supabase no responda. Evita quedarse con la pantalla en blanco por un
fallo de red.

### 2.6 Verificación en dos pasos (MFA TOTP)

La app incluye un flujo completo de segundo factor, **opcional por cuenta**:

- **Activación desde Perfil**: botón “Activar verificación en dos pasos”,
  `mfa.enroll({ factorType: 'totp' })`, QR y clave manual, verificación del
  código de 6 dígitos con `mfa.challengeAndVerify` y estado visible.
- **Baja desde Perfil**: `mfa.unenroll` con confirmación previa.
- **Reto en el acceso**: tras el login, `mfa.getAuthenticatorAssuranceLevel()`
  comprueba si la sesión está en AAL1 con un factor verificado pendiente. Si
  es así, `app.js` muestra el formulario `#form-mfa` y no deja entrar hasta
  verificar el código (AAL2). Sin factor verificado no se muestra nada, así
  que quien no la active no cambia su forma de entrar.
- El factor se identifica también con `mfa.listFactors()` si el objeto de
  sesión no lo trae, y si no se puede resolver se cierra la sesión en lugar de
  permitir la entrada.
- `enterApp()` está protegido con un flag para evitar cargas duplicadas cuando
  Supabase emite varios eventos de auth.

> Para exigirla a todo el equipo, el siguiente paso es activarla en cada
> cuenta y, si se quiere forzar, marcar el factor como obligatorio en el
> proyecto (hoy es opcional por diseño para no bloquear al resto).

### 2.7 Política de contraseñas

Aplicada vía Management API del proyecto:

- `password_min_length = 10` (antes 6).
- `security_update_password_require_reauthentication = true`: cambiar la
  contraseña exige una sesión reciente. La app traduce el error
  `reauthentication_needed` a un mensaje claro (“cierra sesión y vuelve a
  entrar”).
- Formularios y validaciones del cliente alineados a 10 caracteres
  (`minlength` en `index.html` y mensajes en `app.js`).
- **Protección de contraseñas filtradas (HIBP): no disponible.** La API
  responde HTTP 402: “available on Pro Plans and up”. Queda pendiente si se
  sube de plan.

### 2.8 Dependencias

`.github/dependabot.yml` revisa `npm` cada lunes (zona Europe/Madrid) y agrupa
minor/patch. Las librerías del navegador de `public/vendor/` no se actualizan
solas: se sustituyen a mano y se comprueba la CSP.

---

## 3. Comprobaciones realizadas

- `npm audit --omit=dev`: 0 vulnerabilidades.
- Búsqueda de secretos en el historial de Git: solo aparecen claves
  `anon` públicas y placeholders vacíos en `.env.example`. `.env.local` nunca
  se ha subido y sigue ignorado.
- `grep` de `innerHTML`: todas las interpolaciones con datos de base de datos
  pasan por `escapeHtml()` (que escapa `& < > " '`) o son valores numéricos,
  UUIDs o texto para `textContent`.
- CSP probada con el servidor local y las cabeceras reales:
  - las tres librerías cargan desde `vendor/`,
  - el login se muestra sin errores de consola,
  - `Html5Qrcode` se inicializa correctamente,
  - un `<script>` inline inyectado **no** se ejecuta,
  - un `onerror` inyectado **no** se ejecuta.
- `html5-qrcode` contiene un `new Function` de detección de `globalThis` que
  no se ejecuta en navegadores modernos; no requiere `'unsafe-eval'`.
- Bucket de fotos privado, con límite de 5 MB, MIME permitidos y URLs
  firmadas de 24 h.
- Flujo MFA probado en local: el formulario `#form-mfa` sustituye al login,
  vuelve correctamente al login al cancelar, la tarjeta de Perfil muestra el
  estado y oculta sus acciones si no hay sesión, y una imagen `data:` (el QR)
  carga bajo la CSP.
- Triggers de stock y de historial con `security definer`,
  `search_path` fijado y `execute` revocado a `public/anon/authenticated`.
- Migración aplicada y verificada con `supabase migration list --linked`.

---

## 4. Modelo de seguridad actual

1. **Autenticación:** Supabase Auth con email/confirmación activada, mínimo de
   10 caracteres, reautenticación para cambiar contraseña y MFA TOTP opcional
   por cuenta (reto AAL2 en el acceso si está activada).
2. **Autorización:** RLS en todas las tablas + política restrictiva de
   dominio. Todo empleado autenticado `@alverlamp.es` es de confianza y puede
   ver/editar el inventario compartido (modelo acordado).
3. **Datos:** solo se exponen la URL del proyecto y la clave `anon`; ambas son
   públicas por diseño y no permiten saltarse RLS.
4. **Correo:** EmailJS desde el navegador con clave pública, o Apps Script con
   lista blanca de destinatarios y límites, o SendGrid con secreto de servidor.
5. **Fotos:** bucket privado, rutas por usuario, URLs firmadas temporales.

---

## 5. Riesgos abiertos y recomendaciones

| Prioridad | Riesgo | Recomendación |
| --- | --- | --- |
| Alta | Clave pública de EmailJS reutilizable desde otro sitio | En EmailJS, restringir el dominio permitido a `stock-impresion.vercel.app`; si se quiere eliminar el abuso, mover el envío al servidor con la clave privada |
| Media | MFA disponible pero opcional | Activar la verificación en dos pasos en las cuentas que gestionan pedidos y proveedores; valorar forzarla en el proyecto |
| Baja | Protección de contraseñas filtradas (HIBP) | No disponible en el plan actual (HTTP 402). Subir a Pro y activarla |
| Media | Sin copias de seguridad verificadas | Confirmar la retención de backups del plan de Supabase y probar una restauración |
| Media | Sin alertas de accesos anómalos | Revisar periódicamente los logs de Auth y activar alertas de errores en Vercel |
| Baja | Librerías del navegador con versión fija | Dependabot cubre `npm`; revisar `public/vendor/` a mano cuando toque |
| Baja | Sin rate limit propio en `/api/*` | Ya hay secretos y límites de Supabase; si se abre a más gente, añadir Vercel Firewall o rate limit por IP |
| Baja | Sin CAPTCHA en el registro | Solo necesario si el dominio deja de estar cerrado o se detecta abuso |
| Baja | `sedGrid.pages` y ficheros sueltos en el repo | No se sirven, pero conviene eliminarlos para reducir superficie |

---

## 6. Verificación rápida en producción

```bash
curl -sI https://stock-impresion.vercel.app/ | grep -iE "content-security|x-frame|strict-transport|cross-origin"
```

Debe aparecer la CSP con `script-src 'self'` y `frame-ancestors 'none'`.

Para confirmar la restricción de datos, con la sesión de una cuenta de otro
dominio (si existiera) cualquier `select` debe devolver 0 filas o un error de
permisos.
