// Copia este fichero a `config.js` y rellena los valores reales.

const SUPABASE_URL = "PEGA_AQUI_TU_SUPABASE_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_ANON_KEY";
// Si usas el endpoint PHP que viene con el proyecto, pon la URL pública:
// Ejemplo: "https://tu-dominio.com/send_email.php"
const APPS_SCRIPT_URL = "PEGA_AQUI_TU_URL_DE_ENPOINT_DE_EMAIL";

// Opcional: EmailJS (sin servidor). Si lo usas, añade estos valores
// Crea una cuenta en https://www.emailjs.com, configura un Service y una Template
const EMAILJS_SERVICE_ID = ""; // ej: service_xxx
const EMAILJS_TEMPLATE_ID = ""; // ej: template_xxx
const EMAILJS_PUBLIC_KEY = ""; // ej: user_xxx o public key

// Export para entornos de build (no necesario en la versión estática)
// export { SUPABASE_URL, SUPABASE_ANON_KEY, APPS_SCRIPT_URL };