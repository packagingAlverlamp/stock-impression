# Stock Impresión — Guía de despliegue

App para controlar el stock de suministros: listado, altas por escáner EAN,
entradas/salidas por escáner, y avisos por email cuando algo llega al mínimo.

No hace falta saber programar para desplegarla — sigue los pasos en orden.
Tiempo estimado: 30-40 minutos la primera vez.

---

## 1. Crear el proyecto en Supabase (base de datos + login)

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratis.
2. **New project** → ponle un nombre (ej. `stock-impresion`) y una contraseña
   de base de datos (guárdala, no la necesitarás casi nunca pero consérvala).
3. Espera 1-2 minutos a que se cree el proyecto.
4. En el menú lateral, ve a **SQL Editor** → **New query**.
5. Abre el fichero `supabase/schema.sql` de este proyecto, copia **todo** su
   contenido, pégalo en el editor y pulsa **Run**. Esto crea las tablas, los
   permisos y las automatizaciones necesarias.
6. Ve a **Project Settings** (icono de engranaje) → **API**.
   - Copia el **Project URL**.
   - Copia la clave **anon public**.
7. Abre `config.js` en este proyecto y pega ambos valores:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

### Opcional: quitar la confirmación por email al registrarse
Por defecto, Supabase pide confirmar el email antes de poder entrar. Si
sois pocas personas de confianza y quieres que el registro sea instantáneo:
**Authentication → Sign In / Providers → Email** → desactiva
**"Confirm email"**.

---

## 2. Desplegar la función que borra cuentas (botón "Eliminar mi cuenta")

Esto requiere el CLI de Supabase (una sola vez):

```bash
npm install -g supabase
supabase login
```

Dentro de la carpeta del proyecto:

```bash
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy delete-account
```

*(El "project ref" lo ves en Project Settings → General → Reference ID.)*

No hace falta configurar ninguna clave adicional: Supabase inyecta
automáticamente los permisos necesarios en la función.


---

## 3. Configurar el envío de emails (gratis, con tu Gmail)

1. Ve a [script.google.com](https://script.google.com) → **Proyecto nuevo**.
2. Borra el contenido por defecto y pega el contenido íntegro de
   `google-apps-script/Code.gs`.
3. Dale un nombre al proyecto (ej. "Stock Impresión — Emails").
4. Pulsa **Implementar → Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
5. Pulsa **Implementar**. Google te pedirá autorizar permisos (enviar
   correo en tu nombre) — acéptalos con tu cuenta de Gmail.
6. Copia la **URL de la aplicación web** que te da.
7. Pégala en `config.js`:
   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/xxxxx/exec";
   ```

Límite de Gmail personal: ~100 emails/día, de sobra para avisos de stock.

---

## 4. Subir el código a GitHub

1. Crea un repositorio nuevo en [github.com](https://github.com) (puede ser
   privado).
2. Sube todos los ficheros de esta carpeta (`index.html`, `style.css`,
   `app.js`, `config.js` ya con tus datos rellenados, y las carpetas
   `supabase/` y `google-apps-script/` si quieres conservarlas como
   referencia).

Si nunca has usado Git, la forma más simple es: en GitHub, botón
**"Add file" → "Upload files"**, y arrastrar todos los ficheros.

---

## 5. Publicar la web gratis (Vercel)

1. Ve a [vercel.com](https://vercel.com) → regístrate con tu cuenta de
   GitHub.
2. **Add New → Project** → selecciona el repositorio que acabas de crear.
3. Framework Preset: **Other** (es HTML/CSS/JS plano, no necesita build).
4. Pulsa **Deploy**.
5. En 1 minuto tendrás tu web en una dirección gratuita del tipo:
   `stock-impresion.vercel.app`

Cada vez que subas cambios al repositorio, la web se actualiza sola.

### Dominio propio (opcional, con coste)
Si más adelante quieres algo como `stock.tuempresa.com` en vez del
subdominio gratuito: compra el dominio en cualquier registrador (Porkbun,
Namecheap, Cloudflare — unos 10-15€/año) y en Vercel ve a
**Project → Settings → Domains** para conectarlo. El certificado HTTPS se
genera solo, sin coste.

---

## 6. Primeros pasos de uso

1. Abre la web publicada, pulsa "Regístrate" y crea tu cuenta (y la del
   resto del equipo).
2. Ve a **Añadir** para dar de alta el primer suministro: puedes escanear
   su código EAN con la cámara o escribirlo a mano.
3. Define la **cantidad mínima** de cada suministro — es la que dispara el
   aviso por email.
4. Desde **Escanear**, elige "Sacar stock" o "Añadir stock" y apunta la
   cámara al código de barras para actualizar cantidades sin escribir nada.
5. En **Mi perfil**, cada persona puede activar/desactivar sus propios
   avisos por email.

---

## Notas importantes

- **Privacidad interna**: al ser un inventario compartido, cualquier
  persona registrada puede ver el email de las demás (es necesario para
  poder avisarles). No hay datos de terceros expuestos públicamente.
- **Cámara y HTTPS**: el escáner necesita acceso a la cámara, que los
  navegadores solo permiten en páginas con HTTPS. Vercel y Netlify lo dan
  automáticamente, así que no tendrás que configurarlo.
- **Instalar como app en el móvil**: aunque no es una app nativa, puedes
  abrir la web en Chrome/Safari y usar "Añadir a pantalla de inicio" para
  tenerla como un icono más, a modo de acceso directo.

---

## Endpoint de envío de emails (serverless)

Se ha añadido un endpoint serverless en `api/send-email.js` para enviar
correos usando SendGrid. Es una alternativa rápida al Apps Script de
Google y se despliega junto con la web en Vercel.

Pasos para activar:

- En Vercel (Project → Settings → Environment Variables) añade:
   - `SENDGRID_API_KEY` — tu clave de API de SendGrid
   - `SENDGRID_FROM` — email remitente (opcional, por defecto: `noreply@yourdomain.com`)

- Opcional: cambia `APPS_SCRIPT_URL` en `config.js` a `/api/send-email`
   para que la aplicación use el endpoint servidor en vez de Apps Script.

Alternativa sin servidor: EmailJS (recomendado si no quieres gestionar API keys)

- EmailJS permite enviar emails directamente desde el frontend sin servidor.
  1. Regístrate en https://www.emailjs.com y crea un `Service` y una `Template`.
  2. En la plantilla, añade variables: `to_email`, `subject`, `message`, `product_name`, `quantity`, `min_quantity`.
  3. En Vercel (Project → Settings → Environment Variables) añade:
     - `EMAILJS_SERVICE_ID` — el ID de tu Service (ej. `service_xxx`) (Config)
     - `EMAILJS_TEMPLATE_ID` — el ID de la plantilla (ej. `template_xxx`) (Config)
     - `EMAILJS_PUBLIC_KEY` — tu public key / user id (Secret)
  4. La app ya viene preparada para usar EmailJS cuando estas variables están presentes.

Prueba básica con EmailJS: no necesitas curl — una vez añadido en Vercel, la app enviará los avisos automáticamente. Si quieres probar manualmente desde la consola, puedes usar la interfaz de EmailJS o una petición desde el navegador que imite la plantilla.

- Haz commit y push; Vercel desplegará automáticamente y expondrá
   `/api/send-email` en tu dominio.

Prueba básica desde terminal (JSON esperado: `to`, `subject`, `text` or `html`):

```bash
curl -X POST https://stock-impresion.vercel.app/api/send-email \
   -H 'Content-Type: application/json' \
   -d '{"to":["tu@email.com"],"subject":"Prueba","text":"Hola"}'
```

Si prefieres que lo gestione yo, indícame si quieres:

- Que prepare el commit con `config.js` apuntando al endpoint y lo empuje (necesitas añadir la variable `SENDGRID_API_KEY` en Vercel antes de probar).
- O que use otro proveedor (Mailgun, SMTP) — en ese caso dame preferencia.

