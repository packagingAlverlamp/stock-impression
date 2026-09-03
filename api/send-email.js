// Clean, single handler for Vercel serverless to send email via SendGrid.
// POST JSON: { to: string | string[], subject: string, text?: string, html?: string }
// Env: SENDGRID_API_KEY (required), SENDGRID_FROM (optional)

const parseJsonBody = (req) => new Promise((resolve, reject) => {
  if (req.body) return resolve(req.body);
  let data = '';
  req.on('data', chunk => data += chunk);
  req.on('end', () => {
    try { resolve(JSON.parse(data || '{}')); } catch (err) { reject(err); }
  });
  req.on('error', reject);
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.statusCode = 400;
    return res.end('Invalid JSON body');
  }

  const { to, subject, text, html, emails } = body || {};
  // support both { emails: [...] } (used by app.js) and { to: ... }
  const recipients = Array.isArray(emails)
    ? emails
    : (Array.isArray(to) ? to : (to ? [to] : []));

  if (!recipients.length || !subject || (!text && !html)) {
    res.statusCode = 400;
    return res.end('Missing fields: recipients, subject and text/html required');
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const SENDGRID_FROM = process.env.SENDGRID_FROM || `no-reply@${process.env.VERCEL_URL || 'example.com'}`;
  if (!SENDGRID_API_KEY) {
    res.statusCode = 500;
    return res.end('SENDGRID_API_KEY not configured on server');
  }

  const payload = {
    personalizations: [{ to: recipients.map(email => ({ email })) }],
    from: { email: SENDGRID_FROM },
    subject,
    content: []
  };
  if (html) payload.content.push({ type: 'text/html', value: html });
  if (text) payload.content.push({ type: 'text/plain', value: text });

  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      res.statusCode = 502;
      return res.end(`SendGrid error: ${resp.status} ${txt}`);
    }

    res.statusCode = 200;
    return res.end('Email sent');
  } catch (err) {
    res.statusCode = 500;
    return res.end(String(err));
  }
};
