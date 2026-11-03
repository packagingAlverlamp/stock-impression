// Aviso único al equipo cuando un pedido lleva 7 días recibido solo en parte.
// Lo ejecuta un cron diario de Vercel.

const { createClient } = require('@supabase/supabase-js');

const REMINDER_AFTER_DAYS = 7;

function formatOrderNumber(order) {
  const number = Number(order.order_number);
  if (!Number.isFinite(number)) return 'PED-—';
  return `PED-${String(number).padStart(4, '0')}`;
}

function formatUnits(value) {
  const amount = Number(value) || 0;
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(amount)} ${amount === 1 ? 'ud' : 'uds'}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
}

function buildMessage(orders, itemsByOrder) {
  const blocks = orders.map((order) => {
    const pending = (itemsByOrder.get(order.id) || []).filter((item) =>
      item.status !== 'cancelled'
      && item.status !== 'received'
      && Number(item.quantity_requested) > Number(item.quantity_received)
    );

    return [
      `Pedido: ${formatOrderNumber(order)}`,
      `Proveedor: ${order.supplier_name || 'Sin proveedor'}`,
      `Primera recepción: ${formatDate(order.first_received_at)}`,
      `Pendiente de recibir (${pending.length} ${pending.length === 1 ? 'línea' : 'líneas'}):`,
      ...pending.map((item) => {
        const reference = item.product_reference ? ` · Ref. ${item.product_reference}` : '';
        const missing = Number(item.quantity_requested) - Number(item.quantity_received);
        return `- ${formatUnits(missing)}${reference} · ${item.product_name}`;
      }),
    ].join('\n');
  });

  return [
    'Hola,',
    '',
    orders.length === 1
      ? 'Este pedido se recibió parcialmente y sigue pendiente parte del suministro:'
      : 'Estos pedidos se recibieron parcialmente y sigue pendiente parte del suministro:',
    '',
    blocks.join('\n\n'),
    '',
    'Revisad con compras si falta reclamar al proveedor.',
    '',
    '— Stock Impresión',
  ].join('\n');
}

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

  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error: ordersError } = await supabase
    .from('purchase_orders')
    .select('id, order_number, supplier_name, purchase_email, requested_by_email, first_received_at')
    .eq('status', 'partial')
    .not('first_received_at', 'is', null)
    .lte('first_received_at', cutoff)
    .is('partial_notified_at', null)
    .order('first_received_at', { ascending: true })
    .limit(50);

  if (ordersError) {
    return res.status(500).json({ ok: false, message: ordersError.message });
  }
  if (!orders || !orders.length) {
    return res.status(200).json({ ok: true, sent: 0, orders: 0, message: 'No partial orders to remind' });
  }

  const orderIds = orders.map((order) => order.id);
  const { data: items, error: itemsError } = await supabase
    .from('purchase_order_items')
    .select('order_id, product_name, product_reference, quantity_requested, quantity_received, status')
    .in('order_id', orderIds);

  if (itemsError) {
    return res.status(500).json({ ok: false, message: itemsError.message });
  }

  const itemsByOrder = new Map();
  (items || []).forEach((item) => {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  });

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('email');

  if (profilesError) {
    return res.status(500).json({ ok: false, message: profilesError.message });
  }

  const excluded = new Set(
    orders
      .map((order) => String(order.purchase_email || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const emails = [...new Set((profileRows || [])
    .map((row) => String(row.email || '').trim())
    .filter((email) => /^[^\s@]+@alverlamp\.es$/i.test(email))
    .filter((email) => !excluded.has(email.toLowerCase())))];

  if (!emails.length) {
    return res.status(200).json({ ok: true, sent: 0, orders: orders.length, message: 'No recipients configured' });
  }

  const subject = orders.length === 1
    ? `Pedido recibido parcialmente · ${formatOrderNumber(orders[0])}`
    : `Pedidos recibidos parcialmente (${orders.length})`;
  const message = buildMessage(orders, itemsByOrder);

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
      message: 'EmailJS failed to send some partial-order reminders',
      sent,
      failed: emails.length - sent,
      orders: orders.length
    });
  }

  const { error: updateError } = await supabase
    .from('purchase_orders')
    .update({ partial_notified_at: new Date().toISOString() })
    .in('id', orderIds);

  if (updateError) {
    return res.status(500).json({ ok: false, message: updateError.message, sent });
  }

  return res.status(200).json({ ok: true, sent, orders: orders.length });
};
