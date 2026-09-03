// Serverless endpoint for Vercel to send email via SendGrid
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, text/html' });
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const SENDGRID_FROM = process.env.SENDGRID_FROM || 'noreply@yourdomain.com';
  if (!SENDGRID_API_KEY) {
    return res.status(500).json({ error: 'SENDGRID_API_KEY not configured' });
  }

  const toList = Array.isArray(to) ? to : [to];
  const personalizations = [
    {
      to: toList.map((email) => ({ email }))
    }
  ];

  const payload = {
    personalizations,
    from: { email: SENDGRID_FROM },
    subject,
    content: [{ type: html ? 'text/html' : 'text/plain', value: html || text }]
  };

  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (r.status >= 400) {
      const txt = await r.text();
      return res.status(r.status).json({ error: txt });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
// Serverless endpoint for Vercel to send email via SendGrid REST API.
// Expects POST JSON: { to: string|string[], subject: string, text?: string, html?: string }
// Env vars: SENDGRID_API_KEY (required), SENDGRID_FROM (optional)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SENDGRID_API_KEY not configured' });

  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, text/html' });
  }

  const from = process.env.SENDGRID_FROM || `noreply@${process.env.VERCEL_URL || 'example.com'}`;

  const toArray = Array.isArray(to) ? to : [to];

  const payload = {
    personalizations: [
      {
        to: toArray.map(email => ({ email })),
        subject,
      },
    ],
    from: { email: from },
    content: [],
  };

  if (text) payload.content.push({ type: 'text/plain', value: text });
  if (html) payload.content.push({ type: 'text/html', value: html });

  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const bodyText = await resp.text();
      return res.status(502).json({ error: 'SendGrid error', details: bodyText });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Request failed', details: err.message });
  }
}
// Vercel serverless endpoint to send email via SendGrid
// POST JSON: { to: string | string[], subject: string, text?: string, html?: string }

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, text|html' });
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const SENDGRID_FROM = process.env.SENDGRID_FROM || 'noreply@yourdomain.com';

  if (!SENDGRID_API_KEY) {
    return res.status(500).json({ error: 'SENDGRID_API_KEY not configured on server' });
  }

  const recipients = Array.isArray(to) ? to : [to];
  const personalizations = [{ to: recipients.map(email => ({ email })) }];

  const body = {
    personalizations,
    from: { email: SENDGRID_FROM },
    subject,
    content: [],
  };
  if (html) body.content.push({ type: 'text/html', value: html });
  if (text) body.content.push({ type: 'text/plain', value: text });

  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const textResp = await resp.text();
      return res.status(502).json({ error: 'SendGrid error', details: textResp });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Request failed', details: String(err) });
  }
};
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-EMAIL-KEY');
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

  const { emails, subject, message } = body || {};
  if (!emails || !subject || !message) {
    res.statusCode = 400;
    return res.end('Missing fields: emails, subject, message are required');
  }

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const SENDGRID_SENDER = process.env.SENDGRID_SENDER || 'no-reply@stock-impresion.example';

  if (!SENDGRID_API_KEY) {
    res.statusCode = 500;
    return res.end('SENDGRID_API_KEY not configured on the server');
  }

  // normalize recipients
  const to = Array.isArray(emails) ? emails : String(emails).split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    personalizations: [{ to: to.map(email => ({ email })) , subject }],
    from: { email: SENDGRID_SENDER },
    content: [{ type: 'text/plain', value: message }]
  };

  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      res.statusCode = 502;
      return res.end(`SendGrid error: ${resp.status} ${text}`);
    }

    res.statusCode = 200;
    return res.end('Email sent');
  } catch (err) {
    res.statusCode = 500;
    return res.end(String(err));
  }
};
