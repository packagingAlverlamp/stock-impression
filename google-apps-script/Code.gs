/**
 * STOCK-IMPRESIÓN — Envío de avisos por Gmail
 *
 * Seguridad: este script es un web app público. Para que no se pueda usar
 * como relay de correo, SOLO envía a los emails configurados en la propiedad
 * TEAM_EMAILS y aplica un límite de envíos por hora.
 *
 * Configuración (Proyecto > Configuración del proyecto > Propiedades del script):
 * - TEAM_EMAILS: obligatorio. Emails del equipo separados por comas.
 * - MAX_EMAILS_PER_HOUR: opcional. Por defecto 60.
 *
 * No se usa un secreto compartido porque este script se llama desde el
 * navegador: cualquier secreto incluido en el frontend sería público. La
 * protección real es la lista blanca de destinatarios y el límite de envíos.
 *
 * Despliegue: Implementar > Nueva implementación > Aplicación web
 * - Ejecutar como: Yo
 * - Quién tiene acceso: Cualquier usuario
 */

var DEFAULT_MAX_EMAILS_PER_HOUR = 60;

function getConfig_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function parseEmails_(value) {
  var raw = Array.isArray(value) ? value : String(value || '').split(',');
  var seen = {};

  return raw
    .map(function (email) {
      return String(email || '').trim().toLowerCase();
    })
    .filter(function (email) {
      if (!email || email.indexOf('@') === -1 || seen[email]) return false;
      seen[email] = true;
      return true;
    });
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'Petición vacía' });
    }

    var data = JSON.parse(e.postData.contents);

    var teamEmails = parseEmails_(getConfig_('TEAM_EMAILS'));
    if (!teamEmails.length) {
      return jsonResponse_({
        success: false,
        error: 'Configura TEAM_EMAILS en las propiedades del script antes de usarlo.'
      });
    }

    var requested = parseEmails_(data.emails);
    var recipients = requested.filter(function (email) {
      return teamEmails.indexOf(email) !== -1;
    });

    if (!recipients.length) {
      return jsonResponse_({
        success: false,
        error: 'No hay destinatarios autorizados. Revisa TEAM_EMAILS.'
      });
    }

    var maxPerHour = parseInt(getConfig_('MAX_EMAILS_PER_HOUR'), 10);
    if (!isFinite(maxPerHour) || maxPerHour <= 0) maxPerHour = DEFAULT_MAX_EMAILS_PER_HOUR;

    var cache = CacheService.getScriptCache();
    var hourKey = 'sent_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
    var sentThisHour = parseInt(cache.get(hourKey) || '0', 10) || 0;

    if (sentThisHour + recipients.length > maxPerHour) {
      return jsonResponse_({
        success: false,
        error: 'Límite de envíos por hora alcanzado. Inténtalo más tarde.'
      });
    }

    if (MailApp.getRemainingDailyQuota() < recipients.length) {
      return jsonResponse_({ success: false, error: 'Cuota diaria de Gmail agotada.' });
    }

    var subject = String(data.subject || 'Aviso de stock bajo').slice(0, 200);
    var message = String(data.text || data.message || '');
    var html = String(data.html || '');

    if (!message && !html) {
      return jsonResponse_({ success: false, error: 'El mensaje está vacío.' });
    }

    // Adjuntos opcionales: [{ name, mimeType, content (base64) }].
    var attachments = [];
    var attachmentBytes = 0;
    if (Array.isArray(data.attachments)) {
      data.attachments.slice(0, 6).forEach(function (item) {
        if (!item || !item.content) return;
        var content = String(item.content);
        if (attachmentBytes + content.length > 16 * 1024 * 1024) return;
        try {
          var name = String(item.name || 'foto.jpg').slice(0, 120);
          var mimeType = String(item.mimeType || 'image/jpeg');
          attachments.push(Utilities.newBlob(Utilities.base64Decode(content), mimeType, name));
          attachmentBytes += content.length;
        } catch (err) {
          // Ignora adjuntos corruptos sin bloquear el envío del mensaje.
        }
      });
    }

    var sent = [];
    recipients.forEach(function (email) {
      var options = {
        to: email,
        subject: subject,
        body: message || 'Aviso de Stock Impresión'
      };
      if (html) options.htmlBody = html;
      if (attachments.length) options.attachments = attachments;
      MailApp.sendEmail(options);
      sent.push(email);
    });

    cache.put(hourKey, String(sentThisHour + sent.length), 3600);

    return jsonResponse_({ success: true, sentTo: sent });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
  }
}

function doGet() {
  return jsonResponse_({
    status: 'Stock Impresión: servicio de email activo',
    teamConfigured: parseEmails_(getConfig_('TEAM_EMAILS')).length > 0
  });
}
