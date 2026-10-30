// Endpoint serverless para enviar emails con SendGrid.
//
// Seguridad:
// - Requiere EMAIL_API_SECRET y cabecera `Authorization: Bearer <secreto>`.
// - No acepta peticiones de navegador desde orígenes no configurados.
// - Limita y valida destinatarios, asunto y cuerpo.
//
// Variables de entorno:
// - EMAIL_API_SECRET (obligatoria)
// - SENDGRID_API_KEY (obligatoria)
// - SENDGRID_FROM (obligatoria, remitente verificado en SendGrid)
// - ALLOWED_ORIGIN (opcional, por defecto https://stock-impresion.vercel.app)
// - EMAIL_ALLOWED_DOMAINS (opcional, dominios separados por comas)

const crypto = require('crypto');

const MAX_RECIPIENTS = 50;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 100000;

const parseJsonBody = (req) => new Promise((resolve, reject) => {
  if (req.body && typeof req.body === 'object') return resolve(req.body);
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    try { resolve(JSON.parse(data || '{}')); } catch (err) { reject(err); }
  });
  req.on('error', reject);
});

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '').toLowerCase();

const getAllowedOrigins = () => String(process.env.ALLOWED_ORIGIN || 'https://stock-impresion.vercel.app')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const applyCors = (req, res) => {
  const origin = req.headers.origin;
  if (!origin) return true;

  if (!getAllowedOrigins().includes(normalizeOrigin(origin))) return false;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return true;
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!applyCors(req, res)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const emailApiSecret = process.env.EMAIL_API_SECRET;
  if (!emailApiSecret) {
    return res.status(503).json({ ok: false, error: 'Email API not configured' });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!safeEqual(token, emailApiSecret)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  const { to, subject, text, html, emails } = body || {};

  // Admite { emails: [...] } (formato usado por la app) y { to: ... }.
  const rawRecipients = Array.isArray(emails)
    ? emails
    : (Array.isArray(to) ? to : (to ? [to] : []));

  const recipients = [...new Set(rawRecipients
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean))];

  if (!recipients.length || recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ ok: false, error: `Se requieren entre 1 y ${MAX_RECIPIENTS} destinatarios` });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (recipients.some((email) => !emailPattern.test(email))) {
    return res.status(400).json({ ok: false, error: 'Hay direcciones de email no válidas' });
  }

  const allowedDomains = String(process.env.EMAIL_ALLOWED_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (allowedDomains.length) {
    const unauthorized = recipients.filter((email) => !allowedDomains.includes(email.split('@')[1]));
    if (unauthorized.length) {
      return res.status(403).json({ ok: false, error: 'Hay destinatarios fuera de los dominios permitidos' });
    }
  }

  const safeSubject = typeof subject === 'string' ? subject.trim() : '';
  const safeText = typeof text === 'string' ? text : (typeof body?.message === 'string' ? body.message : '');
  const safeHtml = typeof html === 'string' ? html : '';

  if (!safeSubject || safeSubject.length > MAX_SUBJECT_LENGTH) {
    return res.status(400).json({ ok: false, error: `El asunto es obligatorio y debe tener menos de ${MAX_SUBJECT_LENGTH} caracteres` });
  }
  if ((!safeText && !safeHtml) || safeText.length > MAX_BODY_LENGTH || safeHtml.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ ok: false, error: 'El cuerpo es obligatorio y no puede superar los 100.000 caracteres' });
  }

  const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
  if (rawAttachments.length > 6) {
    return res.status(400).json({ ok: false, error: 'No se pueden adjuntar más de 6 fotos' });
  }

  let attachmentBytes = 0;
  const attachments = [];
  for (const item of rawAttachments) {
    const filename = String(item?.filename || item?.name || '').trim().replace(/[^\w.\-]/g, '_').slice(0, 120);
    const content = String(item?.content || '').trim();
    const type = String(item?.type || item?.mimeType || 'image/jpeg').trim().slice(0, 100);
    if (!filename || !content || !/^image\//i.test(type)) {
      return res.status(400).json({ ok: false, error: 'Hay un adjunto no válido' });
    }
    attachmentBytes += content.length;
    if (attachmentBytes > 16 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: 'Los adjuntos superan el tamaño máximo permitido' });
    }
    attachments.push({ content, filename, type, disposition: 'attachment' });
  }

  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const sendgridFrom = process.env.SENDGRID_FROM;
  if (!sendgridApiKey || !sendgridFrom) {
    return res.status(503).json({ ok: false, error: 'SendGrid no está configurado en el servidor' });
  }

  const payload = {
    personalizations: [{ to: recipients.map((email) => ({ email })) }],
    from: { email: sendgridFrom },
    subject: safeSubject,
    content: [],
  };
  if (safeHtml) payload.content.push({ type: 'text/html', value: safeHtml });
  if (safeText) payload.content.push({ type: 'text/plain', value: safeText });
  if (attachments.length) payload.attachments = attachments;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[send-email] SendGrid error:', response.status, detail.slice(0, 500));
      return res.status(502).json({ ok: false, error: 'No se pudo enviar el email' });
    }

    return res.status(200).json({ ok: true, sent: recipients.length });
  } catch (error) {
    console.error('[send-email] Error inesperado:', error);
    return res.status(500).json({ ok: false, error: 'Error interno al enviar el email' });
  }
};
