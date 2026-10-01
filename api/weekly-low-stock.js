// Weekly low-stock digest for Vercel cron.
// Runs every Monday at 09:00 UTC and sends a single HTML email with all products under minimum.

const { createClient } = require('@supabase/supabase-js');

function buildWeeklyDigestHtml(products) {
  const rows = products.map((p) => {
    const unit = p.unit || 'uds';
    return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827;">${p.name}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">${p.quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">${p.min_quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: left;">${unit}</td>
      </tr>
    `;
  }).join('');

  return `
    <!doctype html>
    <html>
      <body style="margin: 0; padding: 0; background: #f3f4f6; font-family: Arial, sans-serif; color: #111827;">
        <div style="max-width: 720px; margin: 24px auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e5e7eb;">
          <div style="background: #111827; color: #ffffff; padding: 22px 24px;">
            <div style="font-size: 28px; font-weight: 700;">Stock Impresión</div>
            <div style="font-size: 13px; opacity: 0.8; margin-top: 6px;">Resumen semanal de stock bajo</div>
          </div>
          <div style="padding: 24px;">
            <div style="font-size: 16px; line-height: 1.6; color: #374151; margin-bottom: 18px;">
              Hola,<br><br>
              Estos son los suministros que siguen por debajo del mínimo y requieren revisión:
            </div>
            <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
              <thead>
                <tr>
                  <th style="padding: 12px; background: #f9fafb; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; text-align: left;">Suministro</th>
                  <th style="padding: 12px; background: #f9fafb; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; text-align: center;">Stock</th>
                  <th style="padding: 12px; background: #f9fafb; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; text-align: center;">Mín.</th>
                  <th style="padding: 12px; background: #f9fafb; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; text-align: left;">Formato</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="4" style="padding: 18px; color: #6b7280; text-align: center;">No hay suministros por debajo del mínimo.</td></tr>'}
              </tbody>
            </table>
            <div style="margin-top: 22px; font-size: 14px; color: #6b7280;">
              Reponedlos cuando puedas.<br><br>
              — Stock Impresión
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const sendGridKey = process.env.SENDGRID_API_KEY;
  const sendGridFrom = process.env.SENDGRID_FROM || 'no-reply@stock-impresion.com';

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, message: 'Missing Supabase env vars' });
  }

  if (!sendGridKey) {
    return res.status(500).json({ ok: false, message: 'Missing SENDGRID_API_KEY' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  const { data: productsData, error: productsError } = await supabase
    .from('products')
    .select('*');

  if (productsError) {
    return res.status(500).json({ ok: false, message: productsError.message });
  }

  const lowStockProducts = (productsData || []).filter((p) => Number(p.quantity) <= Number(p.min_quantity));

  if (!lowStockProducts.length) {
    return res.status(200).json({ ok: true, sent: 0, message: 'No low-stock products this week' });
  }

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('email')
    .eq('notify_low_stock', true);

  if (profilesError) {
    return res.status(500).json({ ok: false, message: profilesError.message });
  }

  const emails = (profileRows || []).map((row) => row.email).filter(Boolean);
  if (!emails.length) {
    return res.status(200).json({ ok: true, sent: 0, message: 'No recipients configured' });
  }

  const subject = 'Resumen semanal de stock bajo';
  const html = buildWeeklyDigestHtml(lowStockProducts);
  const text = lowStockProducts
    .map((p) => `${p.name}: ${p.quantity} ${p.unit || 'uds'} (mínimo ${p.min_quantity})`)
    .join('\n');

  const payload = {
    personalizations: [{ to: emails.map((email) => ({ email })) }],
    from: { email: sendGridFrom },
    subject,
    content: [
      { type: 'text/plain', value: `Resumen semanal de stock bajo\n\n${text}` },
      { type: 'text/html', value: html }
    ]
  };

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sendGridKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const textResponse = await response.text();
    return res.status(502).json({ ok: false, message: 'SendGrid error', details: textResponse });
  }

  return res.status(200).json({ ok: true, sent: emails.length, count: lowStockProducts.length });
};
