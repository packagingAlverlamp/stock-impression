const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'PEGA_AQUI_TU_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'PEGA_AQUI_TU_SUPABASE_ANON_KEY';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'PEGA_AQUI_TU_URL_DE_ENPOINT_DE_EMAIL';
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || '';
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || '';
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || '';

const content = `// Auto-generated config.js — do not edit by hand\n` +
`const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};\n` +
`const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};\n` +
`const APPS_SCRIPT_URL = ${JSON.stringify(APPS_SCRIPT_URL)};\n` +
`const EMAILJS_SERVICE_ID = ${JSON.stringify(EMAILJS_SERVICE_ID)};\n` +
`const EMAILJS_TEMPLATE_ID = ${JSON.stringify(EMAILJS_TEMPLATE_ID)};\n` +
`const EMAILJS_PUBLIC_KEY = ${JSON.stringify(EMAILJS_PUBLIC_KEY)};\n`;

// Prefer writing into `public/` when it exists so static deployments include it
const publicDir = path.join(process.cwd(), 'public');
let outPath;
if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
	outPath = path.join(publicDir, 'config.js');
} else {
	outPath = path.join(process.cwd(), 'config.js');
}
fs.writeFileSync(outPath, content, 'utf8');
console.log('Generated config.js at', outPath);
