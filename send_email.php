<?php
// send_email.php
// Endpoint mínimo para enviar emails desde el frontend.
// Uso: POST JSON { emails: ["a@b.com"], subject: "...", message: "..." }
// Nota: necesita un hosting PHP con la función mail() habilitada.

// CORS: permitir solicitudes desde cualquier origen (ajusta en producción)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'JSON inválido']);
    exit;
}

$emails = isset($data['emails']) && is_array($data['emails']) ? $data['emails'] : [];
$subject = isset($data['subject']) ? $data['subject'] : '';
$message = isset($data['message']) ? $data['message'] : '';

if (count($emails) === 0 || $subject === '' || $message === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Faltan campos (emails|subject|message)']);
    exit;
}

// Seguridad: si se define la variable de entorno SEND_EMAIL_API_KEY, la petición
// debe incluir esa clave en el header `X-API-KEY` o en el campo JSON `api_key`.
$api_key_env = getenv('SEND_EMAIL_API_KEY');
if ($api_key_env) {
    $provided = '';
    if (function_exists('getallheaders')) {
        $hdrs = getallheaders();
        foreach ($hdrs as $hk => $hv) {
            if (strtolower($hk) === 'x-api-key') {
                $provided = $hv;
                break;
            }
        }
    }
    if (!$provided && isset($data['api_key'])) {
        $provided = $data['api_key'];
    }
    if ($provided !== $api_key_env) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'No autorizado - API key inválida']);
        exit;
    }
}

// From: cambia esto por una dirección de tu dominio para mejor entregabilidad
$from = 'no-reply@tu-dominio.com';
$headers = "From: " . $from . "\r\n";
$headers .= "Reply-To: " . $from . "\r\n";
$headers .= "Content-Type: text/plain; charset=utf-8\r\n";

$all_ok = true;
$errors = [];
foreach ($emails as $to) {
    $to = filter_var(trim($to), FILTER_SANITIZE_EMAIL);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $all_ok = false;
        $errors[] = "Email inválido: $to";
        continue;
    }
    // mail() devuelve true si envío aceptado por MTA local (no garantiza entrega)
    $ok = mail($to, $subject, $message, $headers);
    if (!$ok) {
        $all_ok = false;
        $errors[] = "No se pudo enviar a: $to";
    }
}

if ($all_ok) {
    echo json_encode(['success' => true]);
} else {
    http_response_code(500);
    echo json_encode(['success' => false, 'errors' => $errors]);
}
