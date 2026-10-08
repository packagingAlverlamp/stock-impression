// Weekly low-stock digest for Vercel cron, every Monday at 09:00 UTC.

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ ok: false, message: 'Missing CRON_SECRET' });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emailJsServiceId = process.env.EMAILJS_SERVICE_ID;
  const emailJsTemplateId = process.env.EMAILJS_TEMPLATE_ID;
  const emailJsPublicKey = process.env.EMAILJS_PUBLIC_KEY;
  const emailJsPrivateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, message: 'Missing Supabase service credentials' });
  }
  if (!emailJsServiceId || !emailJsTemplateId || !emailJsPublicKey || !emailJsPrivateKey) {
    return res.status(500).json({ ok: false, message: 'Missing EmailJS env vars' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  const { data: productsData, error: productsError } = await supabase
    .from('products')
    .select('name, quantity, min_quantity, unit');

  if (productsError) {
    return res.status(500).json({ ok: false, message: productsError.message });
  }

  const lowStockProducts = (productsData || [])
    .filter((product) => Number(product.quantity) <= Number(product.min_quantity));

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('email')
    .eq('notify_low_stock', true);

  if (profilesError) {
    return res.status(500).json({ ok: false, message: profilesError.message });
  }

  const emails = [...new Set((profileRows || [])
    .map((row) => row.email?.trim())
    .filter(Boolean))];
  if (!emails.length) {
    return res.status(200).json({ ok: true, sent: 0, message: 'No recipients configured' });
  }

  const subject = 'Resumen semanal de stock bajo';
  const message = [
    lowStockProducts.length
      ? 'Estos suministros están por debajo del mínimo:'
      : 'No hay suministros por debajo del mínimo esta semana.',
    '',
    ...lowStockProducts.map((product) =>
      `- ${product.name}: stock ${product.quantity} / mínimo ${product.min_quantity}${product.unit ? ` (${product.unit})` : ''}`
    ),
    '',
    'Reponlos cuando puedas.',
    '',
    '— Stock Impresión'
  ].join('\n');

  const results = await Promise.all(emails.map(async (email) => {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: emailJsServiceId,
        template_id: emailJsTemplateId,
        user_id: emailJsPublicKey,
        accessToken: emailJsPrivateKey,
        template_params: { to_email: email, subject, message }
      })
    });
    return response.ok;
  }));

  const sent = results.filter(Boolean).length;
  if (sent !== emails.length) {
    return res.status(502).json({
      ok: false,
      message: 'EmailJS failed to send some weekly digests',
      sent,
      failed: emails.length - sent
    });
  }

  return res.status(200).json({ ok: true, sent, count: lowStockProducts.length });
};
