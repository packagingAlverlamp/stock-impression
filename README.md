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
7. Crea un fichero `.env.local` en la raíz del proyecto (puedes copiar
   `.env.example`) y rellena ambos valores:
   ```
   SUPABASE_URL=https://xxxxxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
   Después ejecuta `npm run config` para generar `config.js`.

   En Vercel no subas `.env.local`: configura esas mismas variables en
   **Project → Settings → Environment Variables** y el build generará la
   configuración automáticamente.

### Confirmación por email

La confirmación por email está **activada**: al registrarse, Supabase envía un
correo y la cuenta no puede entrar hasta que se confirme. La app muestra el
aviso correspondiente y lleva al formulario de acceso.

Antes de usarlo en producción, revisa:

- **Authentication → URL Configuration → Site URL**: debe ser
  `https://stock-impresion.vercel.app`.
- **Authentication → Sign In / Providers → Email**: la opción
  **"Confirm email"** debe estar activada.
- El envío de correos: el servicio integrado de Supabase tiene límites bajos.
  Para un uso real conviene configurar un SMTP propio.

Si en algún momento queréis desactivar la confirmación, se hace en
**Authentication → Sign In / Providers → Email → "Confirm email"**. No es
recomendable: sin confirmación, cualquiera podría registrarse con una
dirección `@alverlamp.es` ajena y entrar sin controlar ese buzón. La
restricción de dominio (ver **Seguridad y registro**) impide otros dominios,
pero no verifica la identidad.

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
5. En el editor, abre **Configuración del proyecto → Propiedades del script**
   y añade:
   - `TEAM_EMAILS`: los emails del equipo separados por comas. Es
     **obligatorio**: el script solo envía a direcciones que estén en esta
     lista.
   - `MAX_EMAILS_PER_HOUR` (opcional): límite de envíos por hora. Por
     defecto 60.
6. Pulsa **Implementar**. Google te pedirá autorizar permisos (enviar
   correo en tu nombre) — acéptalos con tu cuenta de Gmail.
7. Copia la **URL de la aplicación web** que te da.
8. Pégala en `.env.local`:
   ```
   APPS_SCRIPT_URL=https://script.google.com/macros/s/xxxxx/exec
   ```
   y ejecuta `npm run config` para regenerar `config.js`.

Límite de Gmail personal: ~100 emails/día, de sobra para avisos de stock.
El script además aplica su propio límite por hora y comprueba la cuota
diaria antes de enviar.

---

## 4. Subir el código a GitHub

1. Crea un repositorio nuevo en [github.com](https://github.com) (puede ser
   privado).
2. Sube todos los ficheros de esta carpeta (`index.html`, `style.css`,
   `app.js` y las carpetas `supabase/` y `google-apps-script/`). No subas
   `.env.local`: está en `.gitignore`. `config.js` se genera en el build a
   partir de las variables de Vercel.

Si nunca has usado Git, la forma más simple es: en GitHub, botón
**"Add file" → "Upload files"**, y arrastrar todos los ficheros.

---

## 5. Publicar la web gratis (Vercel)

1. Ve a [vercel.com](https://vercel.com) → regístrate con tu cuenta de
   GitHub.
2. **Add New → Project** → selecciona el repositorio que acabas de crear.
3. Framework Preset: **Other**. El proyecto incluye `vercel.json` y ejecuta
   `npm run build` para generar la carpeta `public/`.
4. En **Settings → Environment Variables** añade al menos `SUPABASE_URL` y
   `SUPABASE_ANON_KEY` (y las de EmailJS si las usas). Sin ellas el build
   fallará a propósito para no publicar una configuración rota.
5. Pulsa **Deploy**.
6. En 1 minuto tendrás tu web en una dirección gratuita del tipo:
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

- **Registro y análisis de stock**: la aplicación guarda cada alta, entrada y
  salida de cantidad con fecha y usuario. Para actualizar una instalación
  existente, aplica la migración
  `supabase/migrations/20261008130000_stock_movements_and_analytics.sql`
  desde Supabase CLI con `supabase db push`. La migración registra el stock
  actual como saldo inicial; no puede recuperar movimientos anteriores.
  Las medias de consumo y de tiempo entre agotamientos son estimaciones que
  se vuelven más representativas con el uso.
- **Maquinaria y servicio técnico**: para una instalación existente, despliega
  la migración
  `supabase/migrations/20261026110000_machinery_and_service_requests.sql`
  con `supabase db push`. Las categorías actuales de los suministros se
  convertirán en máquinas y quedarán vinculadas; asigna un proveedor a cada
  máquina desde la sección **Taller → Máquinas**. Las solicitudes se guardan
  con estado e historial, y el aviso se envía a las personas que tienen
  activada la recepción de avisos de stock y solicitudes técnicas.
- **Fotos e historial de servicio técnico**: aplica también
  `supabase/migrations/20261030120000_service_request_history_and_photos.sql`.
  Crea el bucket privado `service-request-photos` y la tabla
  `maintenance_request_events`. Cada cambio de estado queda registrado con
  fecha y usuario. Las fotos se comprimen en el navegador, se guardan en el
  bucket y se incluyen en el aviso como enlaces firmados. Si el envío usa el
  Apps Script, se adjuntan al correo; con EmailJS se incluyen los enlaces y
  variables `photo_1`, `photo_2` y `photo_3` para poder configurar adjuntos
  variables en la plantilla.

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

## Seguridad y registro

- **Solo emails @alverlamp.es**: la función `handle_new_user` de
  `supabase/schema.sql` rechaza cualquier registro con otro dominio. Para una
  instalación existente aplica
  `supabase/migrations/20261029120000_restrict_signup_domain.sql` con
  `supabase db push`. La validación del formulario es solo para dar un mensaje
  claro; el bloqueo real está en la base de datos y también cubre llamadas
  directas a la API de Supabase.
- **Confirmación de email activada**: la cuenta no recibe acceso hasta que la
  persona confirma el correo. Esto evita que alguien se registre con una
  dirección `@alverlamp.es` que no controla. Revisa la Site URL y el SMTP en
  **Authentication** antes de usar la app en producción.
- **RLS e inventario compartido**: cualquier persona con cuenta puede ver y
  modificar el inventario, los proveedores y las máquinas. Mantén el registro
  restringido y revisa periódicamente quién tiene cuenta.
- **EmailJS**: la clave pública es visible por diseño. En el panel de EmailJS,
  restringe el origen permitido a tu dominio para evitar que otros usen tu
  plantilla.
- **Endpoint SendGrid** (`/api/send-email`): requiere `EMAIL_API_SECRET` y la
  cabecera `Authorization: Bearer <secreto>`. Sin ese secreto responde 503.
  No lo llames desde el navegador con el secreto incrustado; úsalo desde un
  servidor, un cron o una herramienta interna.
- **Apps Script**: solo envía a los emails de `TEAM_EMAILS` y limita los
  envíos por hora. Así, aunque la URL sea pública, no puede usarse para
  mandar correo a terceros.
- **Relay PHP eliminado**: el antiguo `send_email.php` se ha retirado porque
  no tenía autenticación.

## Desarrollo local

1. Copia `.env.example` a `.env.local` y rellena los valores.
2. Ejecuta `npm install` y `npm run build`.
3. Sirve la carpeta generada: `npx serve public` (o
   `python3 -m http.server 3000 --directory public`) y abre
   `http://localhost:3000`.

`npm run config` regenera `config.js` y `public/config.js` a partir de
`.env.local`. `npm run build` hace lo mismo y además copia el frontend a
`public/`. No edites `config.js` ni `public/` a mano.

## Endpoint de envío de emails (serverless)

`api/send-email.js` envía correos con SendGrid. Es una alternativa al Apps
Script de Google y se despliega junto con la web en Vercel.

Variables en Vercel:

- `EMAIL_API_SECRET` — obligatoria; secreto que debe enviar el cliente.
- `SENDGRID_API_KEY` — clave de API de SendGrid.
- `SENDGRID_FROM` — remitente verificado en SendGrid.
- `ALLOWED_ORIGIN` — opcional; origen permitido para CORS. Por defecto
  `https://stock-impresion.vercel.app`.
- `EMAIL_ALLOWED_DOMAINS` — opcional; por ejemplo `alverlamp.es` para que solo
  se pueda enviar a ese dominio.

La app usa EmailJS por defecto (`APPS_SCRIPT_URL` vacío). Si quieres usar este
endpoint, llama a `APPS_SCRIPT_URL` desde un servidor o cron; no pongas el
secreto en el JavaScript del navegador.

Prueba desde terminal:

```bash
curl -X POST https://stock-impresion.vercel.app/api/send-email \
   -H 'Content-Type: application/json' \
   -H "Authorization: Bearer $EMAIL_API_SECRET" \
   -d '{"to":["tu@alverlamp.es"],"subject":"Prueba","text":"Hola"}'
```

## EmailJS (alternativa sin servidor)

- EmailJS permite enviar emails directamente desde el frontend sin servidor.
  1. Regístrate en https://www.emailjs.com y crea un `Service` y una `Template`.
  2. En la plantilla, añade variables: `to_email`, `subject`, `message`,
     `product_name`, `quantity`, `min_quantity`, `category`, `machine_name`,
     `machine_model`, `machine_serial_number`, `request_reason`,
     `supplier_name`, `supplier_email`, `supplier_phone`. La misma plantilla
     sirve para los avisos de stock y las solicitudes de servicio técnico.
  3. En Vercel (Project → Settings → Environment Variables) añade:
     - `EMAILJS_SERVICE_ID` — ID del Service.
     - `EMAILJS_TEMPLATE_ID` — ID de la plantilla.
     - `EMAILJS_PUBLIC_KEY` — public key / user id.
  4. La app usa EmailJS cuando estas variables están presentes.
  5. Restringe en el panel de EmailJS los orígenes desde los que se puede
     usar la clave pública.

No necesitas curl: una vez configurado, la app enviará los avisos
automáticamente.
