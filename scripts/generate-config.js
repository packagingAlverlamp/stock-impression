const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// Carga .env.local / .env sin dependencias externas. Las variables que ya
// existen en el entorno (por ejemplo, las de Vercel) tienen prioridad.
function loadEnvFile(filename) {
  const filePath = path.join(ROOT, filename);
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;

    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) return;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile('.env.local');
loadEnvFile('.env');

function fail(message) {
  console.error(`[config] ${message}`);
  process.exit(1);
}

// Normaliza errores habituales: /rest/v1 final y barra final.
function normalizeSupabaseUrl(url) {
  let value = String(url || '').trim();
  value = value.replace(/\/rest\/v1\/?$/i, '');
  value = value.replace(/\/+$/, '');
  return value;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();

if (!/^https?:\/\/[^\s/]+/i.test(supabaseUrl) || /PEGA_AQUI/i.test(supabaseUrl)) {
  fail('SUPABASE_URL no es una URL válida. Revisa .env.local o las variables de Vercel.');
}
if (
  !supabaseAnonKey ||
  supabaseAnonKey.length < 20 ||
  /PEGA_AQUI/i.test(supabaseAnonKey) ||
  /^https?:\/\//i.test(supabaseAnonKey)
) {
  fail('SUPABASE_ANON_KEY no parece una clave válida. Revisa .env.local o las variables de Vercel.');
}

// APPS_SCRIPT_URL puede ser una URL absoluta, una ruta relativa o vacío.
const hasAppsScriptUrl = Object.prototype.hasOwnProperty.call(process.env, 'APPS_SCRIPT_URL');
const appsScriptUrl = hasAppsScriptUrl
  ? String(process.env.APPS_SCRIPT_URL || '').trim()
  : '/api/send-email';

if (appsScriptUrl && !/^(https?:\/\/|\/)/i.test(appsScriptUrl)) {
  fail('APPS_SCRIPT_URL debe ser una URL (https://...) o una ruta que empiece por /.');
}

const emailJsServiceId = process.env.EMAILJS_SERVICE_ID || '';
const emailJsTemplateId = process.env.EMAILJS_TEMPLATE_ID || '';
const emailJsPublicKey = process.env.EMAILJS_PUBLIC_KEY || '';

if ((emailJsServiceId || emailJsTemplateId) && !emailJsPublicKey) {
  console.warn('[config] EmailJS está parcialmente configurado: falta EMAILJS_PUBLIC_KEY.');
}

const content = `// Auto-generated config.js — do not edit by hand\n` +
`const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\n` +
`const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};\n` +
`const APPS_SCRIPT_URL = ${JSON.stringify(appsScriptUrl)};\n` +
`const EMAILJS_SERVICE_ID = ${JSON.stringify(emailJsServiceId)};\n` +
`const EMAILJS_TEMPLATE_ID = ${JSON.stringify(emailJsTemplateId)};\n` +
`const EMAILJS_PUBLIC_KEY = ${JSON.stringify(emailJsPublicKey)};\n`;

// Escribe la configuración local (raíz) y la del build estático (public/).
const outputs = [path.join(ROOT, 'config.js')];
const publicDir = path.join(ROOT, 'public');
if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
  outputs.push(path.join(publicDir, 'config.js'));
}

outputs.forEach((outPath) => {
  fs.writeFileSync(outPath, content, 'utf8');
  console.log('Generated config.js at', outPath);
});
