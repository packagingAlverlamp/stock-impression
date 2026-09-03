/**
 * STOCK-IMPRESIÓN — Envío de avisos de stock bajo por Gmail
 *
 * Cómo desplegarlo (ver README.md para el detalle paso a paso):
 * 1. Ve a https://script.google.com > Proyecto nuevo
 * 2. Borra el contenido de Code.gs y pega este fichero entero
 * 3. Implementar > Nueva implementación > Tipo: Aplicación web
 *    - Ejecutar como: Yo (tu cuenta de Gmail)
 *    - Quién tiene acceso: Cualquier usuario
 * 4. Autoriza los permisos que pida Google (enviar correo en tu nombre)
 * 5. Copia la URL de la aplicación web y pégala en config.js como APPS_SCRIPT_URL
 */

function doPost(e) {
  var result = { success: false };

  try {
    var data = JSON.parse(e.postData.contents);
    var emails = data.emails || [];
    var subject = data.subject || "Aviso de stock bajo";
    var message = data.message || "";

    var sent = [];
    emails.forEach(function (email) {
      if (email && email.indexOf("@") > -1) {
        MailApp.sendEmail(email, subject, message);
        sent.push(email);
      }
    });

    result.success = true;
    result.sentTo = sent;
  } catch (err) {
    result.error = err.toString();
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Permite comprobar desde el navegador que el despliegue funciona
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "Stock-Impresión: servicio de email activo" }))
    .setMimeType(ContentService.MimeType.JSON);
}
